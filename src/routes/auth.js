// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
const prisma = new PrismaClient();

// ==========================================
// REGISTER
// ==========================================
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;

    // Validation
    if (!username || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^(\+254|0)[17]\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid Kenyan phone number' });
    }

    // Check if user exists
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }, { phone }] },
    });
    if (existing) {
      if (existing.email === email) return res.status(400).json({ error: 'Email already registered' });
      if (existing.username === username) return res.status(400).json({ error: 'Username taken' });
      if (existing.phone === phone) return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user + wallet in a transaction
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username,
          email: email.toLowerCase(),
          phone,
          passwordHash,
          role: 'PLAYER',
        },
      });

      // Create wallet with 0 balance
      await tx.wallet.create({
        data: {
          userId: newUser.id,
          balance: 0,
        },
      });

      return newUser;
    });

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        balance: 0,
      },
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed, please try again' });
  }
});

// ==========================================
// LOGIN
// ==========================================
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
      return res.status(400).json({ error: 'Email/phone and password required' });
    }

    // Find user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: emailOrPhone.toLowerCase() },
          { phone: emailOrPhone },
        ],
      },
      include: { wallet: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Account has been suspended. Contact support.' });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        balance: user.wallet?.balance || 0,
      },
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed, please try again' });
  }
});

// ==========================================
// GET CURRENT USER
// ==========================================
router.get('/me', require('../middleware/auth').authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      balance: req.user.wallet?.balance || 0,
    },
  });
});

// ==========================================
// VERIFY CRASH POINT (Provably Fair)
// ==========================================
router.post('/verify', async (req, res) => {
  try {
    const { serverSeed, clientSeed, nonce } = req.body;
    const { generateCrashPoint } = require('../utils/provablyFair');
    const crashPoint = generateCrashPoint(serverSeed, clientSeed, parseInt(nonce));
    res.json({ crashPoint, verified: true });
  } catch (err) {
    res.status(400).json({ error: 'Verification failed' });
  }
});

module.exports = router;
