// src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { WebSocketServer } = require('ws');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const { authenticate } = require('./middleware/auth');
const GameEngine = require('./services/GameEngine');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiLimiter);

// Serve frontend static files
app.use(express.static('public'));

// ==========================================
// ROUTES
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/game', authenticate, gameRoutes);
app.use('/api/wallet', authenticate, walletRoutes);
app.use('/api/admin', authenticate, adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    game: 'FleekFlex Payouts',
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// WEBSOCKET SERVER
// ==========================================
const wss = new WebSocketServer({ server });
const gameEngine = new GameEngine(wss, prisma);

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection');

  // Send current game state to new connection
  ws.send(JSON.stringify({
    type: 'GAME_STATE',
    data: gameEngine.getCurrentState(),
  }));

  ws.on('message', async (message) => {
    try {
      const parsed = JSON.parse(message);
      await gameEngine.handleMessage(ws, parsed);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message' }));
    }
  });

  ws.on('close', () => {
    gameEngine.removePlayer(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║      FLEEKFLEX PAYOUTS SERVER         ║
  ║      Running on port ${PORT}              ║
  ╚═══════════════════════════════════════╝
  `);

  // Start the game engine
  await gameEngine.start();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  server.close();
});
