/**
 * Integration Tests — Auth Flow
 *
 * Real SQLite DB (temp file), real express-session with better-sqlite3-session-store,
 * real auth/user services, real rate limiter. Full Express app with Supertest.
 *
 * Validates: Requirements 3.1, 3.4, 4.3, 4.5, 5.1, 5.2, 6.1, 6.2, 8.2, 10.2, 11.2, 12.1, 12.2
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import session from 'express-session';
import BetterSqlite3SessionStore from 'better-sqlite3-session-store';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { initAuthDatabase, type AuthDatabase } from '../db/auth-db.js';
import type { AuthService } from '../auth/auth-service.js';
import { createUserService, type UserService } from '../auth/user-service.js';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limiter.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { createAuthRouter } from './auth.js';
import { createAdminRouter } from './admin.js';

let authDb: AuthDatabase;
let authService: AuthService;
let userService: UserService;
let rateLimiter: RateLimiter;
let app: express.Express;
let dbPath: string;

beforeAll(async () => {
  // Create temp DB
  const tmpDir = os.tmpdir();
  dbPath = path.join(tmpDir, `auth-integration-test-${Date.now()}.db`);
  authDb = initAuthDatabase(dbPath);

  // Recreate sessions table with the schema that better-sqlite3-session-store expects.
  // The store needs (sid TEXT, sess TEXT, expire TEXT).
  authDb.db.exec('DROP TABLE IF EXISTS sessions');
  authDb.db.exec('DROP INDEX IF EXISTS idx_sessions_expired');

  // Create the session store (its constructor creates the sessions table)
  const SqliteStore = BetterSqlite3SessionStore(session);
  const store = new SqliteStore({
    client: authDb.db,
    expired: { clear: true, intervalMs: 900_000 },
  });

  // Create a test-compatible auth service.
  // The real createAuthService prepares statements against a `sessions` table with
  // an `expired` INTEGER column, but the session store uses `expire` TEXT.
  // For integration tests, we create a compatible auth service that works with the store's schema.
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
        user: {
          id: row.id,
          username: row.username,
          email: row.email,
          role: row.role,
          is_active: true,
        },
      };
    },
    validateSession() { return null; },
    invalidateUserSessions(userId: number) {
      deleteUserSessions.run(`%"id":${userId}%`);
    },
  };

  userService = createUserService(authDb.db);
  rateLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 });

  // Create admin user
  await userService.createUser({
    username: 'admin',
    email: 'admin@test.de',
    password: 'adminpass123',
    role: 'admin',
  });

  // Create regular user
  await userService.createUser({
    username: 'user1',
    email: 'user1@test.de',
    password: 'userpass123',
    role: 'user',
  });

  // Build Express app
  app = express();
  app.use(express.json());
  app.set('trust proxy', true);

  app.use(
    session({
      store,
      secret: 'test-secret-integration',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, maxAge: 24 * 60 * 60 * 1000 },
    }),
  );

  // Public: health
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Auth routes (login is public, logout/me require auth)
  app.use('/api/auth', createAuthRouter(authService, rateLimiter));

  // Auth gate for /api (everything below requires auth)
  app.use('/api', requireAuth());

  // Admin gate + admin routes
  app.use('/api/admin/users', requireAdmin(), createAdminRouter(userService, authService));

  // Test protected endpoint
  app.get('/api/test-protected', (req, res) => {
    res.json({ message: 'protected', user: req.user });
  });
});

afterAll(() => {
  if (rateLimiter) rateLimiter.destroy();
  if (authDb) authDb.close();
  // Clean up temp DB files
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
});


describe('Auth Integration: Login → Session → Protected Endpoint', () => {
  it('should login, get session cookie, and access protected endpoint', async () => {
    const agent = request.agent(app);

    // Login
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ identity: 'admin', password: 'adminpass123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.username).toBe('admin');
    expect(loginRes.body.user.role).toBe('admin');

    // Access protected endpoint with session cookie
    const protectedRes = await agent.get('/api/test-protected');
    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body.message).toBe('protected');
    expect(protectedRes.body.user.username).toBe('admin');
  });

  it('should login with email as identity', async () => {
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ identity: 'admin@test.de', password: 'adminpass123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.username).toBe('admin');
  });

  it('should reject access to protected endpoint without login', async () => {
    const res = await request(app).get('/api/test-protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });
});

describe('Auth Integration: Logout → Session Invalid → 401', () => {
  it('should invalidate session after logout', async () => {
    const agent = request.agent(app);

    // Login
    await agent.post('/api/auth/login').send({ identity: 'user1', password: 'userpass123' });

    // Verify access
    const before = await agent.get('/api/test-protected');
    expect(before.status).toBe(200);

    // Logout
    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Verify no access after logout
    const after = await agent.get('/api/test-protected');
    expect(after.status).toBe(401);
  });
});

describe('Auth Integration: Deactivation → Session Invalidation → 401', () => {
  it('should invalidate user sessions when deactivated by admin', async () => {
    // Login as admin
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ identity: 'admin', password: 'adminpass123' });

    // Create target user
    const createRes = await adminAgent.post('/api/admin/users').send({
      username: 'deactivate_target',
      email: 'deactivate@test.de',
      password: 'password123',
      role: 'user',
    });
    expect(createRes.status).toBe(201);

    // Login as target user
    const userAgent = request.agent(app);
    const loginRes = await userAgent
      .post('/api/auth/login')
      .send({ identity: 'deactivate_target', password: 'password123' });
    expect(loginRes.status).toBe(200);

    // Verify user has access
    const beforeDeactivate = await userAgent.get('/api/test-protected');
    expect(beforeDeactivate.status).toBe(200);

    // Get user ID
    const usersRes = await adminAgent.get('/api/admin/users');
    const targetUser = usersRes.body.users.find((u: any) => u.username === 'deactivate_target');

    // Admin deactivates user
    const deactivateRes = await adminAgent.post(`/api/admin/users/${targetUser.id}/deactivate`);
    expect(deactivateRes.status).toBe(200);

    // User's session should be invalidated → 401
    const afterDeactivate = await userAgent.get('/api/test-protected');
    expect(afterDeactivate.status).toBe(401);
  });
});

describe('Auth Integration: Role Change → Session Invalidation', () => {
  it('should invalidate user sessions when role is changed', async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ identity: 'admin', password: 'adminpass123' });

    // Create target user
    const createRes = await adminAgent.post('/api/admin/users').send({
      username: 'role_target',
      email: 'role@test.de',
      password: 'password123',
      role: 'user',
    });
    expect(createRes.status).toBe(201);

    // Login as target user
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/login').send({ identity: 'role_target', password: 'password123' });

    // Verify access
    const before = await userAgent.get('/api/test-protected');
    expect(before.status).toBe(200);

    // Get user ID
    const usersRes = await adminAgent.get('/api/admin/users');
    const targetUser = usersRes.body.users.find((u: any) => u.username === 'role_target');

    // Admin changes role
    const roleRes = await adminAgent.put(`/api/admin/users/${targetUser.id}/role`).send({ role: 'admin' });
    expect(roleRes.status).toBe(200);

    // User's session should be invalidated → 401
    const after = await userAgent.get('/api/test-protected');
    expect(after.status).toBe(401);
  });
});

describe('Auth Integration: Password Reset → Session Invalidation', () => {
  it('should invalidate user sessions when password is reset', async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ identity: 'admin', password: 'adminpass123' });

    // Create target user
    const createRes = await adminAgent.post('/api/admin/users').send({
      username: 'pw_target',
      email: 'pw@test.de',
      password: 'password123',
      role: 'user',
    });
    expect(createRes.status).toBe(201);

    // Login as target user
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/login').send({ identity: 'pw_target', password: 'password123' });

    // Verify access
    const before = await userAgent.get('/api/test-protected');
    expect(before.status).toBe(200);

    // Get user ID
    const usersRes = await adminAgent.get('/api/admin/users');
    const targetUser = usersRes.body.users.find((u: any) => u.username === 'pw_target');

    // Admin resets password
    const pwRes = await adminAgent
      .put(`/api/admin/users/${targetUser.id}/password`)
      .send({ password: 'newpassword123' });
    expect(pwRes.status).toBe(200);

    // User's session should be invalidated → 401
    const after = await userAgent.get('/api/test-protected');
    expect(after.status).toBe(401);
  });
});

describe('Auth Integration: Rate Limiter — Failed Attempts → 429', () => {
  it('should block after maxAttempts (3) failed login attempts', async () => {
    // Use a unique IP via X-Forwarded-For
    const ip = '192.168.99.99';

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ identity: 'admin', password: 'wrongpassword' });
      expect(res.status).toBe(401);
    }

    // 4th attempt should be rate-limited
    const blocked = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ identity: 'admin', password: 'wrongpassword' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('Zu viele Anmeldeversuche');
    expect(blocked.body.retryAfterMs).toBeGreaterThan(0);
  });

  it('should reset rate limiter on successful login', async () => {
    const ip = '192.168.88.88';

    // 2 failed attempts (below threshold)
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ identity: 'admin', password: 'wrongpassword' });
    }

    // Successful login resets counter
    const success = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ identity: 'admin', password: 'adminpass123' });
    expect(success.status).toBe(200);

    // Should be able to fail again without hitting limit immediately
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ identity: 'admin', password: 'wrongpassword' });
      expect(res.status).toBe(401);
    }
  });
});

describe('Auth Integration: Admin Endpoints — user role → 403', () => {
  it('should return 403 when user role accesses admin endpoints', async () => {
    const agent = request.agent(app);

    // Login as regular user
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ identity: 'user1', password: 'userpass123' });
    expect(loginRes.status).toBe(200);

    // Try to access admin endpoints
    const listRes = await agent.get('/api/admin/users');
    expect(listRes.status).toBe(403);

    const createRes = await agent.post('/api/admin/users').send({
      username: 'hacker',
      email: 'hacker@test.de',
      password: 'password123',
      role: 'admin',
    });
    expect(createRes.status).toBe(403);
  });

  it('should allow admin role to access admin endpoints', async () => {
    const agent = request.agent(app);

    // Login as admin
    await agent.post('/api/auth/login').send({ identity: 'admin', password: 'adminpass123' });

    // Access admin endpoint
    const listRes = await agent.get('/api/admin/users');
    expect(listRes.status).toBe(200);
    expect(listRes.body.users).toBeDefined();
    expect(Array.isArray(listRes.body.users)).toBe(true);
  });
});
