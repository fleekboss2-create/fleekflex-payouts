// src/routes/game.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Get round history
router.get('/history', async (req, res) => {
  try {
    const rounds = await prisma.gameRound.findMany({
      where: { status: 'CRASHED' },
      orderBy: { roundNumber: 'desc' },
      take: 50,
      select: {
        id: true,
        roundNumber: true,
        crashPoint: true,
        clientSeed: true,
        serverSeedHash: true,
        endedAt: true,
      },
    });
    res.json({ rounds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get a specific round (for verification)
router.get('/round/:id', async (req, res) => {
  try {
    const round = await prisma.gameRound.findUnique({
      where: { id: req.params.id },
      include: {
        bets: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
    });
    if (!round) return res.status(404).json({ error: 'Round not found' });

    // Only reveal server seed if round is finished
    if (round.status !== 'CRASHED') {
      round.serverSeed = null;
    }

    res.json({ round });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch round' });
  }
});

// Get player's bet history
router.get('/my-bets', async (req, res) => {
  try {
    const bets = await prisma.bet.findMany({
      where: { userId: req.user.id },
      orderBy: { placedAt: 'desc' },
      take: 50,
      include: {
        round: {
          select: { roundNumber: true, crashPoint: true },
        },
      },
    });
    res.json({ bets });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

// Get player stats
router.get('/my-stats', async (req, res) => {
  try {
    const stats = await prisma.bet.aggregate({
      where: { userId: req.user.id },
      _sum: { betAmount: true, profit: true },
      _count: { id: true },
    });

    const wins = await prisma.bet.count({
      where: { userId: req.user.id, status: 'WON' },
    });

    res.json({
      totalBets: stats._count.id,
      totalWagered: stats._sum.betAmount || 0,
      totalProfit: stats._sum.profit || 0,
      totalWins: wins,
      winRate: stats._count.id > 0 ? ((wins / stats._count.id) * 100).toFixed(1) : 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
