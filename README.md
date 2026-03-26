# FleekFlex Payouts 🚀
## Crash Game Backend - Full Setup & Deployment Guide

---

## PROJECT STRUCTURE

```
fleekflex/
├── src/
│   ├── index.js              ← Main server entry point
│   ├── routes/
│   │   ├── auth.js           ← Register, Login, Verify
│   │   ├── game.js           ← Game history, stats
│   │   ├── wallet.js         ← Balance, deposits, withdrawals
│   │   └── admin.js          ← Admin dashboard, user management
│   ├── middleware/
│   │   ├── auth.js           ← JWT authentication
│   │   └── rateLimiter.js    ← Prevent abuse
│   ├── services/
│   │   └── GameEngine.js     ← Core crash game logic
│   └── utils/
│       ├── provablyFair.js   ← Crash point algorithm
│       └── seedAdmin.js      ← Create admin account
├── prisma/
│   └── schema.prisma         ← Database structure
├── .env.example              ← Environment variables template
├── render.yaml               ← Render deployment config
└── package.json
```

---

## API ENDPOINTS

### AUTH
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Create new account |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Get current user |
| POST | /api/auth/verify | Verify crash point (provably fair) |

### GAME
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/game/history | Last 50 rounds |
| GET | /api/game/round/:id | Single round details |
| GET | /api/game/my-bets | Player's bet history |
| GET | /api/game/my-stats | Player stats |

### WALLET
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/wallet/balance | Get balance |
| GET | /api/wallet/transactions | Transaction history |
| POST | /api/wallet/withdraw | Request withdrawal |
| POST | /api/wallet/deposit | Deposit (M-Pesa Phase 4) |

### ADMIN (requires admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/admin/dashboard | Overview stats |
| GET | /api/admin/users | All players |
| PATCH | /api/admin/users/:id/ban | Ban/unban player |
| POST | /api/admin/users/:id/adjust-balance | Add/remove funds |
| GET | /api/admin/bets | All bets |
| GET | /api/admin/withdrawals | All withdrawals |
| PATCH | /api/admin/withdrawals/:id/approve | Approve withdrawal |
| PATCH | /api/admin/withdrawals/:id/reject | Reject & refund |
| GET | /api/admin/rounds | All game rounds |

### WEBSOCKET EVENTS
| Event (Client → Server) | Description |
|--------------------------|-------------|
| AUTH { token } | Authenticate WebSocket |
| BET { betAmount, autoCashout } | Place a bet |
| CASHOUT | Cash out current bet |

| Event (Server → Client) | Description |
|--------------------------|-------------|
| WAITING { roundNumber, countdown } | New round starting |
| COUNTDOWN { countdown } | Countdown tick |
| FLYING { multiplier } | Round started |
| TICK { multiplier } | Multiplier update |
| CRASHED { crashPoint, serverSeed } | Round crashed |
| BET_PLACED { betId, balance } | Bet confirmed |
| CASHED_OUT { cashoutAt, winAmount } | Cashout confirmed |
| PLAYER_BET { username, betAmount } | Someone placed a bet |
| PLAYER_CASHOUT { username, cashoutAt } | Someone cashed out |

---

## DEPLOYMENT ON RENDER (Step by Step)

### STEP 1 — Push to GitHub
1. Create a free account on github.com
2. Create a new repository called "fleekflex-payouts"
3. Upload all these files to that repository

### STEP 2 — Create Render Account
1. Go to render.com
2. Sign up with your GitHub account

### STEP 3 — Create PostgreSQL Database
1. In Render dashboard → click "New" → "PostgreSQL"
2. Name: fleekflex-db
3. Plan: Free
4. Click "Create Database"
5. Copy the "Internal Database URL" — you'll need it

### STEP 4 — Deploy the Server
1. In Render → "New" → "Web Service"
2. Connect your GitHub repo
3. Settings:
   - Name: fleekflex-payouts
   - Environment: Node
   - Build Command: `npm install && npx prisma generate && npx prisma migrate deploy`
   - Start Command: `npm start`
4. Add Environment Variables:
   - DATABASE_URL → paste the URL from Step 3
   - JWT_SECRET → type any long random string (e.g. "fleekflex2024supersecretkey123xyz")
   - NODE_ENV → production
   - HOUSE_EDGE → 0.03
   - FRONTEND_URL → https://your-app.onrender.com
5. Click "Create Web Service"

### STEP 5 — Create Admin Account
After deployment, open Render's Shell tab and run:
```
node src/utils/seedAdmin.js
```

### STEP 6 — Test Your API
Visit: https://your-app.onrender.com/api/health
You should see: {"status":"ok","game":"FleekFlex Payouts"}

---

## IMPORTANT NOTES

- NEVER share your .env file or JWT_SECRET with anyone
- The free Render plan sleeps after 15 min of inactivity
- House edge is set to 3% by default (can change in .env)
- M-Pesa integration will be added in Phase 4

---

Built with ❤️ for FleekFlex Payouts
