import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthRouter } from './auth.js';
import type { AuthService } from '../auth/auth-service.js';
import type { RateLimiter } from '../auth/rate-limiter.js';

function createMockAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: vi.fn().mockResolvedValue({ success: false, error: 'Ungültige Anmeldedaten' }),
    validateSession: vi.fn().mockReturnValue(null),
    invalidateUserSessions: vi.fn(),
    ...overrides,
  };
}

function createMockRateLimiter(overrides: Partial<RateLimiter> = {}): RateLimiter {
  return {
    check: vi.fn().mockReturnValue({ allowed: true }),
    recordFailure: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
}

function createApp(authService: AuthService, rateLimiter: RateLimiter) {
  const app = express();
  app.use(express.json());

  // Minimal session mock
  app.use((req, _res, next) => {
    if (!(req as any).session) {
      (req as any).session = {
        destroy: (cb: (err?: Error) => void) => cb(),
      };
    }
    next();
  });

  app.use('/api/auth', createAuthRouter(authService, rateLimiter));
  return app;
}

function createAppWithSession(authService: AuthService, rateLimiter: RateLimiter, sessionUser: any) {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    (req as any).session = {
      user: sessionUser,
      destroy: (cb: (err?: Error) => void) => cb(),
    };
    next();
  });

  app.use('/api/auth', createAuthRouter(authService, rateLimiter));
  return app;
}

describe('Auth Routes', () => {
  let authService: AuthService;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    authService = createMockAuthService();
    rateLimiter = createMockRateLimiter();
  });

  describe('POST /api/auth/login', () => {
    it('returns 429 when rate limited', async () => {
      rateLimiter = createMockRateLimiter({
        check: vi.fn().mockReturnValue({ allowed: false, retryAfterMs: 60000 }),
      });
      const app = createApp(authService, rateLimiter);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identity: 'user', password: 'pass' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Zu viele Anmeldeversuche');
      expect(res.body.retryAfterMs).toBe(60000);
    });

    it('returns 400 when identity or password missing', async () => {
      const app = createApp(authService, rateLimiter);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identity: 'user' });

      expect(res.status).toBe(400);
    });

    it('returns 401 on failed login and records failure', async () => {
      const app = createApp(authService, rateLimiter);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identity: 'user', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Ungültige Anmeldedaten');
      expect(rateLimiter.recordFailure).toHaveBeenCalled();
    });

    it('returns 200 on successful login, sets session, and resets rate limiter', async () => {
      const mockUser = { id: 1, username: 'admin', email: 'a@b.com', role: 'admin' as const, is_active: true };
      authService = createMockAuthService({
        login: vi.fn().mockResolvedValue({ success: true, user: mockUser }),
      });
      const app = createApp(authService, rateLimiter);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identity: 'admin', password: 'correct' });

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(mockUser);
      expect(rateLimiter.reset).toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createApp(authService, rateLimiter);

      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(401);
    });

    it('returns 200 and destroys session when authenticated', async () => {
      const sessionUser = { id: 1, username: 'admin', role: 'admin' };
      const app = createAppWithSession(authService, rateLimiter, sessionUser);

      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 500 when session destroy fails', async () => {
      const sessionUser = { id: 1, username: 'admin', role: 'admin' };
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).session = {
          user: sessionUser,
          destroy: (cb: (err?: Error) => void) => cb(new Error('destroy failed')),
        };
        next();
      });
      app.use('/api/auth', createAuthRouter(authService, rateLimiter));

      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Logout fehlgeschlagen');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createApp(authService, rateLimiter);

      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
    });

    it('returns current user when authenticated', async () => {
      const sessionUser = { id: 1, username: 'admin', role: 'admin' };
      const app = createAppWithSession(authService, rateLimiter, sessionUser);

      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(sessionUser);
    });
  });
});
