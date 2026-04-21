import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import session from 'express-session';
import BetterSqlite3SessionStore from 'better-sqlite3-session-store';
import { loadConfig } from './config.js';
import { initAuthDatabase } from './db/auth-db.js';
import { createAuthService } from './auth/auth-service.js';
import { createUserService } from './auth/user-service.js';
import { createRateLimiter } from './auth/rate-limiter.js';
import { requireAuth, requireAdmin } from './auth/middleware.js';
import { seedInitialAdmin } from './auth/seed.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createBblSocketService } from './bbl-socket/index.js';
import { createBblSocketRouter } from './routes/bbl-socket.js';
import { setupBblWebSocket } from './bbl-socket/ws-handler.js';
import { createPlanningDeskClient } from './planning-desk-client.js';
import { createPlanningDeskRouter } from './routes/planning-desk.js';
import { WebSocketServer, WebSocket } from 'ws';

// Load config — abort if SESSION_SECRET is missing
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  console.error('FATAL:', (err as Error).message);
  process.exit(1);
}

// Initialize auth database
// __dirname resolves to server/src/, go up two levels to reach kommentator-app/
const authDbPath = path.join(__dirname, '..', '..', 'data', 'auth.db');

// Ensure data directory exists
const dataDir = path.dirname(authDbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const authDb = initAuthDatabase(authDbPath);
console.log('Auth DB initialized at:', authDbPath);

// Instantiate auth services
const authService = createAuthService({ db: authDb.db, sessionSecret: config.sessionSecret });
const userService = createUserService(authDb.db);
const rateLimiter = createRateLimiter();

// Configure session middleware with better-sqlite3-session-store
const SqliteStore = BetterSqlite3SessionStore(session);
const sessionMiddleware = session({
  store: new SqliteStore({
    client: authDb.db,
    expired: {
      clear: true,
      intervalMs: 15 * 60 * 1000, // Clear expired sessions every 15 minutes
    },
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Set to true only when behind HTTPS (ALB with SSL)
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
  },
});

const app = express();
app.use(express.json());
app.use(sessionMiddleware);

// Health endpoint (public — no auth required)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth routes (public — login, protected — logout/me)
app.use('/api/auth', createAuthRouter(authService, rateLimiter));

// Auth gate — all routes below require authentication
app.use('/api', requireAuth());

// Admin gate + admin routes
app.use('/api/admin', requireAdmin());
app.use('/api/admin/users', createAdminRouter(userService, authService));

// BBL Socket Service — only register if API key is available
let bblSocket: ReturnType<typeof createBblSocketService> | null = null;
const bblSocketApiKey = config.bblSocketApiKey || process.env.BBL_SOCKET_API_KEY;
if (bblSocketApiKey) {
  bblSocket = createBblSocketService({
    apiUrl: config.bblSocketUrl || process.env.BBL_SOCKET_URL || 'https://api.bbl.scb.world',
    apiKey: bblSocketApiKey,
  });
  app.use('/api/bbl-socket', createBblSocketRouter(bblSocket));
  console.log('BBL Socket service registered');
} else {
  console.warn('BBL_SOCKET_API_KEY not set — BBL Socket service not registered');
}

// Planning Desk Client — only register if API key is available
const planningDeskApiKey = config.planningDeskApiKey || process.env.PLANNING_DESK_API_KEY;
if (planningDeskApiKey) {
  const planningDeskClient = createPlanningDeskClient(
    config.planningDeskApiUrl || process.env.PLANNING_DESK_API_URL || 'https://api.desk.dyn.sport/planning/api',
    planningDeskApiKey,
  );
  app.use('/api/planning-desk', createPlanningDeskRouter(planningDeskClient));
  console.log('Planning Desk service registered');
} else {
  console.warn('PLANNING_DESK_API_KEY not set — Planning Desk service not registered');
}

// Serve static client files in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Create HTTP server
const PORT = config.port || parseInt(process.env.PORT || '3001', 10);
const server = createServer(app);

// WebSocket setup with auth validation
if (bblSocket) {
  const wss = setupBblWebSocket(server, bblSocket);

  // Override the upgrade handler to add session auth
  // Remove the default upgrade listener added by setupBblWebSocket
  server.removeAllListeners('upgrade');

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname !== '/ws/bbl-live') return;

    // Validate session from cookie before accepting WebSocket
    sessionMiddleware(request as any, {} as any, () => {
      const sess = (request as any).session;
      if (!sess?.user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });
  });
}

// Seed initial admin and start server
async function start() {
  await seedInitialAdmin(userService, {
    username: process.env.INITIAL_ADMIN_USERNAME,
    email: process.env.INITIAL_ADMIN_EMAIL,
    password: process.env.INITIAL_ADMIN_PASSWORD,
  });

  server.listen(PORT, () => {
    console.log(`Kommentator Socket App running on port ${PORT}`);
    if (bblSocket) console.log('  BBL Socket: ready');
    if (planningDeskApiKey) console.log('  Planning Desk: ready');
    console.log('  Auth: ready');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
