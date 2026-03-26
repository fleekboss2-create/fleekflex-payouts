// src/routes/admin.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All admin routes require admin role
router.use(requireAdmin);

// ==========================================
// DASHBOARD OVERVIEW
// ==========================================
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      totalBets,
      totalRounds,
      pendingWithdrawals,
      betStats,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'PLAYER' } }),
      prisma.bet.count(),
      prisma.gameRound.count({ where: { status: 'CRASHED' } }),
      prisma.transaction.count({ where: { type: 'WITHDRAWAL', status: 'PENDING' } }),
      prisma.bet.aggregate({
        _sum: { betAmount: true, profit: true },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { username: true, email: true, createdAt: true },
      }),
    ]);

    const totalWagered = betStats._sum.betAmount || 0;
    const totalPaidOut = (betStats._sum.profit || 0) + totalWagered;
    const houseProfit = totalWagered - totalPaidOut;

    res.json({
      overview: {
        totalUsers,
        totalBets,
        totalRounds,
        pendingWithdrawals,
        totalWagered,
        houseProfit,
      },
      recentUsers,
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ==========================================
// USER MANAGEMENT
// ==========================================
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = search ? {
      OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          wallet: { select: { balance: true } },
          _count: { select: { bets: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        phone: u.phone,
        balance: u.wallet?.balance || 0,
        totalBets: u._count.bets,
        isActive: u.isActive,
        isBanned: u.isBanned,
        createdAt: u.createdAt,
      })),
      pagination: { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Ban / Unban user
router.patch('/users/:id/ban', async (req, res) => {
  try {
    const { ban } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned: ban },
    });
    res.json({ message: `User ${ban ? 'banned' : 'unbanned'} successfully`, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Manually adjust user balance (for testing / bonuses)
router.post('/users/:id/adjust-balance', async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const adjustAmount = parseFloat(amount);

    await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: req.params.id },
        data: { balance: { increment: adjustAmount } },
      });
      await tx.transaction.create({
        data: {
          userId: req.params.id,
          type: 'BONUS',
          amount: adjustAmount,
          status: 'COMPLETED',
          description: reason || `Admin balance adjustment`,
        },
      });
    });

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.params.id } });
    res.json({ message: 'Balance adjusted', newBalance: wallet.balance });
  } catch (err) {
    res.status(500).json({ error: 'Failed to adjust balance' });
  }
});

// ==========================================
// ALL BETS
// ==========================================
router.get('/bets', async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bets, total] = await Promise.all([
      prisma.bet.findMany({
        skip,
        take: parseInt(limit),
        orderBy: { placedAt: 'desc' },
        include: {
          user: { select: { username: true, phone: true } },
          round: { select: { roundNumber: true, crashPoint: true } },
        },
      }),
      prisma.bet.count(),
    ]);

    res.json({ bets, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

// ==========================================
// WITHDRAWALS MANAGEMENT
// ==========================================
router.get('/withdrawals', async (req, res) => {
  try {
    const withdrawals = await prisma.transaction.findMany({
      where: { type: 'WITHDRAWAL' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { username: true, phone: true } },
      },
    });
    res.json({ withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// Approve withdrawal
router.patch('/withdrawals/:id/approve', async (req, res) => {
  try {
    const transaction = await prisma.transaction.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED' },
    });
    res.json({ message: 'Withdrawal approved', transaction });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve withdrawal' });
  }
});

// Reject withdrawal (refund player)
router.patch('/withdrawals/:id/reject', async (req, res) => {
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: req.params.id },
    });

    if (!transaction || transaction.status !== 'PENDING') {
      return res.status(400).json({ error: 'Transaction not found or already processed' });
    }

    await prisma.$transaction(async (tx) => {
      // Refund player
      await tx.wallet.update({
        where: { userId: transaction.userId },
        data: { balance: { increment: Math.abs(transaction.amount) } },
      });
      // Mark as cancelled
      await tx.transaction.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED' },
      });
    });

    res.json({ message: 'Withdrawal rejected and refunded' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject withdrawal' });
  }
});

// ==========================================
// GAME ROUNDS
// ==========================================
router.get('/rounds', async (req, res) => {
  try {
    const rounds = await prisma.gameRound.findMany({
      orderBy: { roundNumber: 'desc' },
      take: 50,
      include: {
        _count: { select: { bets: true } },
      },
    });
    res.json({ rounds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rounds' });
  }
});

module.exports = router;
