/**
 * Integration Tests — WebSocket Auth
 *
 * Real HTTP server on random port, real session middleware,
 * ws package for WebSocket connections, cookie-based auth.
 *
 * Validates: Requirements 5.5
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import session from 'express-session';
import BetterSqlite3SessionStore from 'better-sqlite3-session-store';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { initAuthDatabase, type AuthDatabase } from '../db/auth-db.js';
import type { AuthService } from '../auth/auth-service.js';
import { createUserService, type UserService } from '../auth/user-service.js';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limiter.js';
import { createAuthRouter } from './auth.js';

let authDb: AuthDatabase;
let authService: AuthService;
let userService: UserService;
let rateLimiter: RateLimiter;
let app: express.Express;
let server: Server;
let wss: WebSocketServer;
let dbPath: string;
let serverPort: number;
let sessionMiddleware: express.RequestHandler;

beforeAll(async () => {
  // Create temp DB
  const tmpDir = os.tmpdir();
  dbPath = path.join(tmpDir, `ws-auth-integration-test-${Date.now()}.db`);
  authDb = initAuthDatabase(dbPath);

  // Recreate sessions table with the schema that better-sqlite3-session-store expects.
  authDb.db.exec('DROP TABLE IF EXISTS sessions');
  authDb.db.exec('DROP INDEX IF EXISTS idx_sessions_expired');

  // Create the session store
  const SqliteStore = BetterSqlite3SessionStore(session);
  const store = new SqliteStore({
    client: authDb.db,
    expired: { clear: true, intervalMs: 900_000 },
  });

  // Create a test-compatible auth service (avoids schema conflict with session store)
  const { createPasswordService } = await import('../auth/password.js');
  const passwordService = createPasswordService();

  const selectUserByIdentity = authDb.db.prepare(`
    SELECT id, username, email, password_hash, role, is_active
    FROM users WHERE username = ? OR email = ?
  `);
  const deleteUserSessions = authDb.db.prepare(`
    DELETE FROM sessions WHERE sess LIKE ?
  `);

  authService = {
    async login(identity: string, password: string) {
      const row = selectUserByIdentity.get(identity, identity) as any;
      if (!row) return { success: false, error: 'Ungültige Anmeldedaten' };
      const valid = await passwordService.verify(row.password_hash, password);
      if (!valid) return { success: false, error: 'Ungültige Anmeldedaten' };
      if (row.is_active === 0) return { success: false, error: 'Konto ist deaktiviert' };
      return {
        success: true,
        user: { id: row.id, username: row.username, email: row.email, role: row.role, is_active: true },
      };
    },
    validateSession() { return null; },
    invalidateUserSessions(userId: number) {
      deleteUserSessions.run(`%"id":${userId}%`);
    },
  };

  userService = createUserService(authDb.db);
  rateLimiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000 });

  // Create test user
  await userService.createUser({
    username: 'wsuser',
    email: 'wsuser@test.de',
    password: 'wspassword123',
    role: 'user',
  });

  // Build Express app
  app = express();
  app.use(express.json());

  sessionMiddleware = session({
    store,
    secret: 'ws-test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 24 * 60 * 60 * 1000 },
  });

  app.use(sessionMiddleware);

  // Auth routes
  app.use('/api/auth', createAuthRouter(authService, rateLimiter));

  // Create HTTP server
  server = createServer(app);

  // WebSocket server with auth (mirrors production setup)
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', payload: 'ok' }));
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/bbl-live') {
      socket.destroy();
      return;
    }

    // Validate session from cookie before accepting WebSocket
    sessionMiddleware(req as any, {} as any, () => {
      const sess = (req as any).session;
      if (!sess?.user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  });

  // Start server on random port
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      serverPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  // Close WebSocket server
  wss.close();

  // Close HTTP server
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  rateLimiter.destroy();
  authDb.close();

  // Clean up temp DB files
  try {
    fs.unlinkSync(dbPath);
  } catch { /* ignore */ }
  try {
    fs.unlinkSync(dbPath + '-wal');
  } catch { /* ignore */ }
  try {
    fs.unlinkSync(dbPath + '-shm');
  } catch { /* ignore */ }
});

/**
 * Helper: Login via supertest and extract the session cookie string.
 */
async function getSessionCookie(): Promise<string> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .send({ identity: 'wsuser', password: 'wspassword123' });

  expect(res.status).toBe(200);

  // Extract Set-Cookie header
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error('No Set-Cookie header in login response');

  // Return the cookie string (first cookie which contains connect.sid)
  const cookieArr = Array.isArray(cookies) ? cookies : [cookies];
  const sidCookie = cookieArr.find((c: string) => c.includes('connect.sid'));
  if (!sidCookie) throw new Error('No connect.sid cookie found');

  // Extract just the cookie name=value part
  return sidCookie.split(';')[0];
}

describe('WebSocket Auth Integration: Valid Session Cookie → Connection Accepted', () => {
  it('should accept WebSocket upgrade with valid session cookie', async () => {
    const cookie = await getSessionCookie();

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/bbl-live`, {
      headers: { Cookie: cookie },
    });

    const message = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS connection timeout')), 5000);
      ws.on('message', (data) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const parsed = JSON.parse(message);
    expect(parsed.type).toBe('connected');
    expect(parsed.payload).toBe('ok');

    ws.close();
  });
});

describe('WebSocket Auth Integration: No Cookie → 401, Socket Closed', () => {
  it('should reject WebSocket upgrade without cookie', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/bbl-live`);

    const result = await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve('timeout'), 5000);
      ws.on('open', () => {
        clearTimeout(timeout);
        resolve('open');
      });
      ws.on('error', () => {
        clearTimeout(timeout);
        resolve('error');
      });
      ws.on('close', () => {
        clearTimeout(timeout);
        resolve('closed');
      });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timeout);
        resolve(`unexpected-response:${res.statusCode}`);
      });
    });

    // Should get 401 or connection closed/error
    expect(result === 'unexpected-response:401' || result === 'error' || result === 'closed').toBe(true);
  });
});

describe('WebSocket Auth Integration: Invalid/Expired Session → 401, Socket Closed', () => {
  it('should reject WebSocket upgrade with invalid session cookie', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/bbl-live`, {
      headers: { Cookie: 'connect.sid=s%3Ainvalid-session-id.fakesignature' },
    });

    const result = await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve('timeout'), 5000);
      ws.on('open', () => {
        clearTimeout(timeout);
        resolve('open');
      });
      ws.on('error', () => {
        clearTimeout(timeout);
        resolve('error');
      });
      ws.on('close', () => {
        clearTimeout(timeout);
        resolve('closed');
      });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timeout);
        resolve(`unexpected-response:${res.statusCode}`);
      });
    });

    // Should get 401 or connection closed/error
    expect(result === 'unexpected-response:401' || result === 'error' || result === 'closed').toBe(true);
  });

  it('should reject WebSocket upgrade after session is destroyed (logout)', async () => {
    // Login and get cookie
    const cookie = await getSessionCookie();

    // Verify WS works with this cookie
    const ws1 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/bbl-live`, {
      headers: { Cookie: cookie },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS timeout')), 5000);
      ws1.on('message', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws1.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    ws1.close();

    // Logout (destroy session) using the same cookie
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);

    // Now try WS with the same (now-invalid) cookie
    const ws2 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/bbl-live`, {
      headers: { Cookie: cookie },
    });

    const result = await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve('timeout'), 5000);
      ws2.on('open', () => {
        clearTimeout(timeout);
        resolve('open');
      });
      ws2.on('error', () => {
        clearTimeout(timeout);
        resolve('error');
      });
      ws2.on('close', () => {
        clearTimeout(timeout);
        resolve('closed');
      });
      ws2.on('unexpected-response', (_req, res) => {
        clearTimeout(timeout);
        resolve(`unexpected-response:${res.statusCode}`);
      });
    });

    expect(result === 'unexpected-response:401' || result === 'error' || result === 'closed').toBe(true);
  });
});
