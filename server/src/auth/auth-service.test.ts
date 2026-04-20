import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initAuthDatabase, type AuthDatabase } from '../db/auth-db';
import { createAuthService, type AuthService } from './auth-service';
import { createPasswordService } from './password';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('AuthService', () => {
  let authDb: AuthDatabase;
  let authService: AuthService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-service-test-'));
    const dbPath = path.join(tmpDir, 'test-auth.db');
    authDb = initAuthDatabase(dbPath);

    authService = createAuthService({
      db: authDb.db,
      sessionSecret: 'test-secret',
    });

    // Seed a test user
    const pw = createPasswordService();
    const hash = await pw.hash('validpass123');
    authDb.db.prepare(`
      INSERT INTO users (username, email, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run('testuser', 'test@example.com', hash, 'admin', 1);
  });

  afterEach(() => {
    authDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('login()', () => {
    it('should login with valid username and password', async () => {
      const result = await authService.login('testuser', 'validpass123');
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user!.username).toBe('testuser');
      expect(result.user!.email).toBe('test@example.com');
      expect(result.user!.role).toBe('admin');
    });

    it('should login with valid email and password', async () => {
      const result = await authService.login('test@example.com', 'validpass123');
      expect(result.success).toBe(true);
      expect(result.user!.username).toBe('testuser');
    });

    it('should return generic error for non-existent user', async () => {
      const result = await authService.login('nonexistent', 'validpass123');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Ungültige Anmeldedaten');
      expect(result.user).toBeUndefined();
    });

    it('should return generic error for wrong password', async () => {
      const result = await authService.login('testuser', 'wrongpassword');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Ungültige Anmeldedaten');
    });

    it('should return same error message for wrong username and wrong password', async () => {
      const wrongUser = await authService.login('nonexistent', 'validpass123');
      const wrongPass = await authService.login('testuser', 'wrongpassword');
      expect(wrongUser.error).toBe(wrongPass.error);
    });

    it('should reject login for deactivated account with specific message', async () => {
      authDb.db.prepare('UPDATE users SET is_active = 0 WHERE username = ?').run('testuser');

      const result = await authService.login('testuser', 'validpass123');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Konto ist deaktiviert');
    });
  });

  describe('invalidateUserSessions()', () => {
    it('should not throw when sessions table does not exist', () => {
      const userId = (authDb.db.prepare('SELECT id FROM users WHERE username = ?')
        .get('testuser') as { id: number }).id;

      // Should not throw even without a sessions table
      expect(() => authService.invalidateUserSessions(userId)).not.toThrow();
    });

    it('should delete matching sessions when table exists', async () => {
      // Create a sessions table like the store would
      authDb.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL
        )
      `);

      const userId = (authDb.db.prepare('SELECT id FROM users WHERE username = ?')
        .get('testuser') as { id: number }).id;

      // Insert fake sessions
      authDb.db.prepare(`INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)`)
        .run('s1', JSON.stringify({ user: { id: userId, username: 'testuser', role: 'admin' } }), Date.now() + 100000);
      authDb.db.prepare(`INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)`)
        .run('s2', JSON.stringify({ user: { id: 999, username: 'other', role: 'user' } }), Date.now() + 100000);

      authService.invalidateUserSessions(userId);

      const count = (authDb.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
      expect(count).toBe(1); // Only the other user's session remains
    });
  });
});
