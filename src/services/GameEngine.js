// src/services/GameEngine.js
const {
  generateServerSeed,
  generateClientSeed,
  hashServerSeed,
  generateCrashPoint,
} = require('../utils/provablyFair');

const TICK_RATE = 100; // ms between multiplier updates
const BETTING_PHASE_DURATION = 5000; // 5 seconds to place bets
const CRASH_DELAY = 3000; // 3 seconds after crash before next round

class GameEngine {
  constructor(wss, prisma) {
    this.wss = wss;
    this.prisma = prisma;

    this.phase = 'WAITING'; // WAITING | FLYING | CRASHED
    this.currentRound = null;
    this.multiplier = 1.0;
    this.elapsed = 0;
    this.activeBets = new Map(); // ws → { userId, betAmount, autoCashout, cashedOut }
    this.playerSockets = new Map(); // userId → ws
    this.roundHistory = [];
    this.tickInterval = null;
  }

  // ==========================================
  // START ENGINE
  // ==========================================
  async start() {
    console.log('Game engine starting...');

    // Load last 20 rounds for history
    const history = await this.prisma.gameRound.findMany({
      orderBy: { roundNumber: 'desc' },
      take: 20,
    });
    this.roundHistory = history.map(r => r.crashPoint);

    await this.startWaitingPhase();
  }

  // ==========================================
  // WAITING PHASE (5 second countdown)
  // ==========================================
  async startWaitingPhase() {
    this.phase = 'WAITING';
    this.multiplier = 1.0;
    this.elapsed = 0;
    this.activeBets.clear();

    // Generate seeds for this round
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const serverSeedHash = hashServerSeed(serverSeed);

    // Get next round number
    const lastRound = await this.prisma.gameRound.findFirst({
      orderBy: { roundNumber: 'desc' },
    });
    const nextRoundNumber = lastRound ? lastRound.roundNumber + 1 : 1;

    // Generate crash point
    const crashPoint = generateCrashPoint(serverSeed, clientSeed, nextRoundNumber);

    // Create round in database
    this.currentRound = await this.prisma.gameRound.create({
      data: {
        roundNumber: nextRoundNumber,
        serverSeed,
        serverSeedHash,
        clientSeed,
        nonce: nextRoundNumber,
        crashPoint,
        status: 'PENDING',
      },
    });

    console.log(`Round #${nextRoundNumber} | Crash will be at: ${crashPoint}x`);

    // Broadcast waiting phase to all players
    this.broadcast({
      type: 'WAITING',
      data: {
        roundId: this.currentRound.id,
        roundNumber: nextRoundNumber,
        serverSeedHash, // Published so players can verify later
        clientSeed,
        countdown: BETTING_PHASE_DURATION / 1000,
        history: this.roundHistory.slice(0, 20),
      },
    });

    // Start countdown
    let countdown = BETTING_PHASE_DURATION / 1000;
    const countdownInterval = setInterval(() => {
      countdown--;
      this.broadcast({ type: 'COUNTDOWN', data: { countdown } });
      if (countdown <= 0) {
        clearInterval(countdownInterval);
        this.startFlyingPhase();
      }
    }, 1000);
  }

  // ==========================================
  // FLYING PHASE (multiplier climbing)
  // ==========================================
  async startFlyingPhase() {
    this.phase = 'FLYING';
    this.elapsed = 0;
    this.multiplier = 1.0;

    // Update round status
    await this.prisma.gameRound.update({
      where: { id: this.currentRound.id },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });

    // Activate all pending bets
    await this.prisma.bet.updateMany({
      where: { roundId: this.currentRound.id, status: 'PENDING' },
      data: { status: 'ACTIVE' },
    });

    this.broadcast({ type: 'FLYING', data: { multiplier: 1.0 } });

    // Tick every 100ms
    this.tickInterval = setInterval(async () => {
      this.elapsed += TICK_RATE / 1000;

      // Exponential growth formula
      this.multiplier = Math.pow(Math.E, 0.00006 * this.elapsed * 1000);
      this.multiplier = Math.round(this.multiplier * 100) / 100;

      // Check auto cashouts
      for (const [ws, betData] of this.activeBets.entries()) {
        if (!betData.cashedOut && betData.autoCashout && this.multiplier >= betData.autoCashout) {
          await this.processCashout(ws, betData, this.multiplier);
        }
      }

      // Broadcast multiplier
      this.broadcast({
        type: 'TICK',
        data: { multiplier: this.multiplier },
      });

      // Check crash
      if (this.multiplier >= this.currentRound.crashPoint) {
        clearInterval(this.tickInterval);
        await this.startCrashedPhase();
      }
    }, TICK_RATE);
  }

  // ==========================================
  // CRASHED PHASE
  // ==========================================
  async startCrashedPhase() {
    this.phase = 'CRASHED';
    const crashPoint = this.currentRound.crashPoint;

    // Mark all remaining active bets as LOST
    const activeBetIds = await this.prisma.bet.findMany({
      where: { roundId: this.currentRound.id, status: 'ACTIVE' },
    });

    for (const bet of activeBetIds) {
      await this.prisma.bet.update({
        where: { id: bet.id },
        data: { status: 'LOST', profit: -bet.betAmount },
      });
    }

    // Update round
    await this.prisma.gameRound.update({
      where: { id: this.currentRound.id },
      data: { status: 'CRASHED', endedAt: new Date() },
    });

    // Add to history
    this.roundHistory.unshift(crashPoint);
    if (this.roundHistory.length > 20) this.roundHistory.pop();

    // Broadcast crash
    this.broadcast({
      type: 'CRASHED',
      data: {
        crashPoint,
        roundId: this.currentRound.id,
        serverSeed: this.currentRound.serverSeed, // Reveal seed after crash
        clientSeed: this.currentRound.clientSeed,
        nonce: this.currentRound.nonce,
        history: this.roundHistory,
      },
    });

    console.log(`Round #${this.currentRound.roundNumber} CRASHED at ${crashPoint}x`);

    // Next round after delay
    setTimeout(() => this.startWaitingPhase(), CRASH_DELAY);
  }

  // ==========================================
  // HANDLE PLAYER MESSAGES
  // ==========================================
  async handleMessage(ws, message) {
    const { type, data } = message;

    switch (type) {
      case 'AUTH':
        await this.handleAuth(ws, data);
        break;
      case 'BET':
        await this.handleBet(ws, data);
        break;
      case 'CASHOUT':
        await this.handleCashout(ws);
        break;
    }
  }

  async handleAuth(ws, { token }) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      ws.userId = decoded.userId;
      ws.username = decoded.username;
      this.playerSockets.set(decoded.userId, ws);

      // Send current wallet balance
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId: decoded.userId },
      });

      ws.send(JSON.stringify({
        type: 'AUTHENTICATED',
        data: { balance: wallet?.balance || 0 },
      }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid token' }));
    }
  }

  async handleBet(ws, { betAmount, autoCashout }) {
    if (this.phase !== 'WAITING') {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Betting is closed' }));
    }
    if (!ws.userId) {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated' }));
    }

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount < 10) {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Minimum bet is KES 10' }));
    }

    // Check balance
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: ws.userId } });
    if (!wallet || wallet.balance < amount) {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Insufficient balance' }));
    }

    // Deduct from wallet
    await this.prisma.wallet.update({
      where: { userId: ws.userId },
      data: { balance: { decrement: amount } },
    });

    // Record transaction
    await this.prisma.transaction.create({
      data: {
        userId: ws.userId,
        type: 'BET',
        amount: -amount,
        status: 'COMPLETED',
        description: `Bet on round #${this.currentRound.roundNumber}`,
      },
    });

    // Create bet record
    const bet = await this.prisma.bet.create({
      data: {
        userId: ws.userId,
        roundId: this.currentRound.id,
        betAmount: amount,
        autoCashout: autoCashout || null,
        status: 'PENDING',
      },
    });

    // Track active bet
    this.activeBets.set(ws, {
      betId: bet.id,
      userId: ws.userId,
      betAmount: amount,
      autoCashout: autoCashout || null,
      cashedOut: false,
    });

    // Get updated balance
    const updatedWallet = await this.prisma.wallet.findUnique({ where: { userId: ws.userId } });

    ws.send(JSON.stringify({
      type: 'BET_PLACED',
      data: {
        betId: bet.id,
        betAmount: amount,
        balance: updatedWallet.balance,
      },
    }));

    // Broadcast to all that a new bet was placed (anonymized)
    this.broadcast({
      type: 'PLAYER_BET',
      data: {
        username: ws.username,
        betAmount: amount,
      },
    });
  }

  async handleCashout(ws) {
    if (this.phase !== 'FLYING') {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Round not active' }));
    }

    const betData = this.activeBets.get(ws);
    if (!betData || betData.cashedOut) return;

    await this.processCashout(ws, betData, this.multiplier);
  }

  async processCashout(ws, betData, cashoutMultiplier) {
    if (betData.cashedOut) return;
    betData.cashedOut = true;

    const winAmount = betData.betAmount * cashoutMultiplier;
    const profit = winAmount - betData.betAmount;

    // Update wallet
    await this.prisma.wallet.update({
      where: { userId: betData.userId },
      data: { balance: { increment: winAmount } },
    });

    // Update bet
    await this.prisma.bet.update({
      where: { id: betData.betId },
      data: {
        status: 'WON',
        cashoutAt: cashoutMultiplier,
        profit,
        cashedOutAt: new Date(),
      },
    });

    // Record win transaction
    await this.prisma.transaction.create({
      data: {
        userId: betData.userId,
        type: 'WIN',
        amount: winAmount,
        status: 'COMPLETED',
        description: `Won at ${cashoutMultiplier}x`,
      },
    });

    const updatedWallet = await this.prisma.wallet.findUnique({ where: { userId: betData.userId } });

    ws.send(JSON.stringify({
      type: 'CASHED_OUT',
      data: {
        cashoutAt: cashoutMultiplier,
        winAmount,
        profit,
        balance: updatedWallet.balance,
      },
    }));

    // Broadcast cashout to all players
    this.broadcast({
      type: 'PLAYER_CASHOUT',
      data: {
        username: ws.username,
        cashoutAt: cashoutMultiplier,
        winAmount,
      },
    });
  }

  // ==========================================
  // HELPERS
  // ==========================================
  broadcast(message) {
    const data = JSON.stringify(message);
    this.wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(data);
      }
    });
  }

  removePlayer(ws) {
    if (ws.userId) {
      this.playerSockets.delete(ws.userId);
    }
    this.activeBets.delete(ws);
  }

  getCurrentState() {
    return {
      phase: this.phase,
      multiplier: this.multiplier,
      roundId: this.currentRound?.id,
      roundNumber: this.currentRound?.roundNumber,
      history: this.roundHistory,
    };
  }
}

module.exports = GameEngine;
