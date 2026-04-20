import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initAuthDatabase, type AuthDatabase } from '../db/auth-db';
import { createAuthService } from './auth-service';
import { createPasswordService } from './password';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Property-Based Tests for Auth Service
 * Feature: auth-user-management
 */

const passwordService = createPasswordService();

function createTempDb(): { authDb: AuthDatabase; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-svc-prop-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const authDb = initAuthDatabase(dbPath);
  return { authDb, tmpDir };
}

function cleanupDb(authDb: AuthDatabase, tmpDir: string): void {
  authDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

let counter = 0;
const uniqueUsername = () =>
  fc.constant(null).map(() => `user_${++counter}_${Date.now()}`);
const uniqueEmail = () =>
  fc.constant(null).map(() => `u${++counter}_${Date.now()}@test.com`);
const validPassword = fc.string({ minLength: 8, maxLength: 32 });
const validRole = fc.constantFrom<'admin' | 'user'>('admin', 'user');

async function seedUser(
  db: import('better-sqlite3').Database,
  opts: { username: string; email: string; password: string; role: 'admin' | 'user' },
) {
  const hash = await passwordService.hash(opts.password);
  const result = db
    .prepare(`INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`)
    .run(opts.username, opts.email, hash, opts.role);
  return { id: result.lastInsertRowid as number, ...opts };
}

describe('Feature: auth-user-management, Property 5: Login erstellt Session mit korrekten Benutzerdaten', () => {
  it('login with username returns correct user data', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueUsername(), uniqueEmail(), validPassword, validRole,
        async (username, email, password, role) => {
          const { authDb, tmpDir } = createTempDb();
          try {
            const user = await seedUser(authDb.db, { username, email, password, role });
            const authService = createAuthService({ db: authDb.db, sessionSecret: 'test-secret' });

            const result = await authService.login(username, password);
            expect(result.success).toBe(true);
            expect(result.user).toBeDefined();
            expect(result.user!.id).toBe(user.id);
            expect(result.user!.username).toBe(username);
            expect(result.user!.role).toBe(role);
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        }),
      { numRuns: 20 },
    );
  }, 120_000);

  it('login with email returns correct user data', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueUsername(), uniqueEmail(), validPassword, validRole,
        async (username, email, password, role) => {
          const { authDb, tmpDir } = createTempDb();
          try {
            const user = await seedUser(authDb.db, { username, email, password, role });
            const authService = createAuthService({ db: authDb.db, sessionSecret: 'test-secret' });

            const result = await authService.login(email, password);
            expect(result.success).toBe(true);
            expect(result.user!.id).toBe(user.id);
            expect(result.user!.username).toBe(username);
            expect(result.user!.role).toBe(role);
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        }),
      { numRuns: 20 },
    );
  }, 120_000);
});

describe('Feature: auth-user-management, Property 6: Generische Fehlermeldung bei ungültigen Credentials', () => {
  it('wrong username and wrong password produce identical error messages', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueUsername(), uniqueEmail(), validPassword, uniqueUsername(), validPassword,
        async (username, email, password, fakeUsername, wrongPassword) => {
          if (wrongPassword === password) return;
          const { authDb, tmpDir } = createTempDb();
          try {
            await seedUser(authDb.db, { username, email, password, role: 'user' });
            const authService = createAuthService({ db: authDb.db, sessionSecret: 'test-secret' });

            const wrongUserResult = await authService.login(fakeUsername, password);
            const wrongPassResult = await authService.login(username, wrongPassword);
            const wrongEmailResult = await authService.login(`nonexistent_${Date.now()}@fake.com`, password);

            expect(wrongUserResult.success).toBe(false);
            expect(wrongPassResult.success).toBe(false);
            expect(wrongEmailResult.success).toBe(false);
            expect(wrongUserResult.error).toBe(wrongPassResult.error);
            expect(wrongPassResult.error).toBe(wrongEmailResult.error);
            expect(wrongUserResult.user).toBeUndefined();
            expect(wrongPassResult.user).toBeUndefined();
            expect(wrongEmailResult.user).toBeUndefined();
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        }),
      { numRuns: 20 },
    );
  }, 120_000);
});
