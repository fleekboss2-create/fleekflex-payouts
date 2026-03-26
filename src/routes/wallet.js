// src/routes/wallet.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Get wallet balance
router.get('/balance', async (req, res) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id },
    });
    res.json({ balance: wallet?.balance || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Get transaction history
router.get('/transactions', async (req, res) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Request withdrawal (M-Pesa - Phase 4)
router.post('/withdraw', async (req, res) => {
  try {
    const { amount, phone } = req.body;
    const withdrawAmount = parseFloat(amount);

    if (!withdrawAmount || withdrawAmount < 100) {
      return res.status(400).json({ error: 'Minimum withdrawal is KES 100' });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id },
    });

    if (!wallet || wallet.balance < withdrawAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create pending withdrawal transaction
    const transaction = await prisma.transaction.create({
      data: {
        userId: req.user.id,
        type: 'WITHDRAWAL',
        amount: -withdrawAmount,
        status: 'PENDING',
        phone: phone || req.user.phone,
        description: `Withdrawal request - KES ${withdrawAmount}`,
      },
    });

    // Deduct from wallet (hold funds)
    await prisma.wallet.update({
      where: { userId: req.user.id },
      data: { balance: { decrement: withdrawAmount } },
    });

    res.json({
      message: 'Withdrawal request submitted. Will be processed within 24 hours.',
      transactionId: transaction.id,
      amount: withdrawAmount,
    });

  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ error: 'Withdrawal request failed' });
  }
});

// Manual deposit (admin adds funds - placeholder until M-Pesa)
router.post('/deposit', async (req, res) => {
  try {
    const { amount } = req.body;
    const depositAmount = parseFloat(amount);

    if (!depositAmount || depositAmount < 10) {
      return res.status(400).json({ error: 'Minimum deposit is KES 10' });
    }

    // This will be replaced by M-Pesa STK push in Phase 4
    // For now returns instructions
    res.json({
      message: 'M-Pesa integration coming soon. Contact admin to deposit funds for testing.',
      instructions: {
        step1: 'Go to M-Pesa',
        step2: 'Send money to: [Your till/paybill number]',
        step3: 'Use your username as reference',
        step4: 'Balance will be updated within 5 minutes',
      },
    });

  } catch (err) {
    res.status(500).json({ error: 'Deposit failed' });
  }
});

module.exports = router;
