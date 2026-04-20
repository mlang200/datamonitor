import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminRouter } from './admin.js';
import type { UserService } from '../auth/user-service.js';
import type { AuthService } from '../auth/auth-service.js';

function createMockUserService(overrides: Partial<UserService> = {}): UserService {
  return {
    createUser: vi.fn().mockResolvedValue({
      id: 2, username: 'newuser', email: 'new@test.com', role: 'user', is_active: true,
    }),
    getUsers: vi.fn().mockReturnValue([]),
    getUserById: vi.fn().mockReturnValue(null),
    deactivateUser: vi.fn(),
    activateUser: vi.fn(),
    deleteUser: vi.fn(),
    changeRole: vi.fn(),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    countAdmins: vi.fn().mockReturnValue(1),
    isEmpty: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function createMockAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: vi.fn().mockResolvedValue({ success: false }),
    validateSession: vi.fn().mockReturnValue(null),
    invalidateUserSessions: vi.fn(),
    ...overrides,
  };
}

function createApp(
  userService: UserService,
  authService: AuthService,
  sessionUser?: { id: number; username: string; role: 'admin' | 'user' },
) {
  const app = express();
  app.use(express.json());

  // Inject session mock
  app.use((req, _res, next) => {
    (req as any).session = {
      user: sessionUser ?? undefined,
      destroy: (cb: (err?: Error) => void) => cb(),
    };
    next();
  });

  app.use('/api/admin/users', createAdminRouter(userService, authService));
  return app;
}

const adminSession = { id: 1, username: 'admin', role: 'admin' as const };
const userSession = { id: 2, username: 'user', role: 'user' as const };

describe('Admin Routes', () => {
  let userService: UserService;
  let authService: AuthService;

  beforeEach(() => {
    userService = createMockUserService();
    authService = createMockAuthService();
  });

  describe('Auth guards', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createApp(userService, authService);
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 when authenticated as non-admin', async () => {
      const app = createApp(userService, authService, userSession);
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/users', () => {
    it('returns list of users', async () => {
      const mockUsers = [
        { id: 1, username: 'admin', email: 'admin@test.com', role: 'admin' as const, is_active: true },
        { id: 2, username: 'user1', email: 'user1@test.com', role: 'user' as const, is_active: true },
      ];
      userService = createMockUserService({ getUsers: vi.fn().mockReturnValue(mockUsers) });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).get('/api/admin/users');

      expect(res.status).toBe(200);
      expect(res.body.users).toEqual(mockUsers);
    });
  });

  describe('POST /api/admin/users', () => {
    it('creates a new user and returns 201', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser', email: 'new@test.com', password: 'password123', role: 'user' });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(userService.createUser).toHaveBeenCalledWith({
        username: 'newuser', email: 'new@test.com', password: 'password123', role: 'user',
      });
    });

    it('returns 400 when required fields are missing', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when role is invalid', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser', email: 'new@test.com', password: 'password123', role: 'superadmin' });

      expect(res.status).toBe(400);
    });

    it('returns 409 when username already exists', async () => {
      userService = createMockUserService({
        createUser: vi.fn().mockRejectedValue(new Error('Benutzername existiert bereits')),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'existing', email: 'new@test.com', password: 'password123', role: 'user' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Benutzername existiert bereits');
    });

    it('returns 409 when email already exists', async () => {
      userService = createMockUserService({
        createUser: vi.fn().mockRejectedValue(new Error('E-Mail existiert bereits')),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser', email: 'existing@test.com', password: 'password123', role: 'user' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('E-Mail existiert bereits');
    });

    it('returns 400 when password is too short', async () => {
      userService = createMockUserService({
        createUser: vi.fn().mockRejectedValue(new Error('Passwort muss mindestens 8 Zeichen lang sein')),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser', email: 'new@test.com', password: 'short', role: 'user' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Passwort muss mindestens 8 Zeichen lang sein');
    });
  });

  describe('DELETE /api/admin/users/:id', () => {
    it('deletes a user and returns success', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).delete('/api/admin/users/2');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userService.deleteUser).toHaveBeenCalledWith(2, 1);
    });

    it('returns 400 for invalid user ID', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).delete('/api/admin/users/abc');

      expect(res.status).toBe(400);
    });

    it('returns 404 when user not found', async () => {
      userService = createMockUserService({
        deleteUser: vi.fn().mockImplementation(() => { throw new Error('Benutzer nicht gefunden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).delete('/api/admin/users/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Benutzer nicht gefunden');
    });

    it('returns 400 when trying to delete own account', async () => {
      userService = createMockUserService({
        deleteUser: vi.fn().mockImplementation(() => { throw new Error('Eigenes Konto kann nicht gelöscht werden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).delete('/api/admin/users/1');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Eigenes Konto kann nicht gelöscht werden');
    });

    it('returns 400 when trying to delete last admin', async () => {
      userService = createMockUserService({
        deleteUser: vi.fn().mockImplementation(() => { throw new Error('Letzter Admin kann nicht gelöscht werden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).delete('/api/admin/users/1');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Letzter Admin kann nicht gelöscht werden');
    });
  });

  describe('POST /api/admin/users/:id/deactivate', () => {
    it('deactivates user and invalidates sessions', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).post('/api/admin/users/2/deactivate');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userService.deactivateUser).toHaveBeenCalledWith(2, 1);
      expect(authService.invalidateUserSessions).toHaveBeenCalledWith(2);
    });

    it('returns 400 when trying to deactivate own account', async () => {
      userService = createMockUserService({
        deactivateUser: vi.fn().mockImplementation(() => { throw new Error('Eigenes Konto kann nicht deaktiviert werden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).post('/api/admin/users/1/deactivate');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Eigenes Konto kann nicht deaktiviert werden');
    });

    it('returns 404 when user not found', async () => {
      userService = createMockUserService({
        deactivateUser: vi.fn().mockImplementation(() => { throw new Error('Benutzer nicht gefunden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).post('/api/admin/users/999/deactivate');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/admin/users/:id/activate', () => {
    it('activates user and returns success', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).post('/api/admin/users/2/activate');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userService.activateUser).toHaveBeenCalledWith(2);
    });

    it('returns 404 when user not found', async () => {
      userService = createMockUserService({
        activateUser: vi.fn().mockImplementation(() => { throw new Error('Benutzer nicht gefunden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app).post('/api/admin/users/999/activate');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/users/:id/role', () => {
    it('changes role and invalidates sessions', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/2/role')
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userService.changeRole).toHaveBeenCalledWith(2, 'admin', 1);
      expect(authService.invalidateUserSessions).toHaveBeenCalledWith(2);
    });

    it('returns 400 for invalid role', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/2/role')
        .send({ role: 'superadmin' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when trying to change own role', async () => {
      userService = createMockUserService({
        changeRole: vi.fn().mockImplementation(() => { throw new Error('Eigene Rolle kann nicht geändert werden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/1/role')
        .send({ role: 'user' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Eigene Rolle kann nicht geändert werden');
    });

    it('returns 400 when demoting last admin', async () => {
      userService = createMockUserService({
        changeRole: vi.fn().mockImplementation(() => { throw new Error('Letzter Admin kann nicht degradiert werden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/2/role')
        .send({ role: 'user' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Letzter Admin kann nicht degradiert werden');
    });

    it('returns 404 when user not found', async () => {
      userService = createMockUserService({
        changeRole: vi.fn().mockImplementation(() => { throw new Error('Benutzer nicht gefunden'); }),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/999/role')
        .send({ role: 'admin' });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/users/:id/password', () => {
    it('resets password and invalidates sessions', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/2/password')
        .send({ password: 'newpassword123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(userService.resetPassword).toHaveBeenCalledWith(2, 'newpassword123');
      expect(authService.invalidateUserSessions).toHaveBeenCalledWith(2);
    });

    it('returns 400 when password is missing', async () => {
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/2/password')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when password is too short', async () => {
      userService = createMockUserService({
        resetPassword: vi.fn().mockRejectedValue(new Error('Passwort muss mindestens 8 Zeichen lang sein')),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/2/password')
        .send({ password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Passwort muss mindestens 8 Zeichen lang sein');
    });

    it('returns 404 when user not found', async () => {
      userService = createMockUserService({
        resetPassword: vi.fn().mockRejectedValue(new Error('Benutzer nicht gefunden')),
      });
      const app = createApp(userService, authService, adminSession);

      const res = await request(app)
        .put('/api/admin/users/999/password')
        .send({ password: 'newpassword123' });

      expect(res.status).toBe(404);
    });
  });
});
