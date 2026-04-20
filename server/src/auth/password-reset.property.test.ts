import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initAuthDatabase, type AuthDatabase } from '../db/auth-db';
import { createAuthService } from './auth-service';
import { createUserService } from './user-service';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Property-Based Tests for Password Reset Round-Trip
 * Feature: auth-user-management
 */

// Helper: create a fresh temp DB
function createTempDb(): { authDb: AuthDatabase; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-reset-prop-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const authDb = initAuthDatabase(dbPath);
  return { authDb, tmpDir };
}

function cleanupDb(authDb: AuthDatabase, tmpDir: string): void {
  authDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Generators
let counter = 0;
const uniqueUsername = () =>
  fc.constant(null).map(() => `user_${++counter}_${Date.now()}`);

const uniqueEmail = () =>
  fc.constant(null).map(() => `u${++counter}_${Date.now()}@test.com`);

const validPassword = fc.string({ minLength: 8, maxLength: 32 });

// ─────────────────────────────────────────────────────────────────────────────
// Property 14: Passwort-Reset Round-Trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 14: Passwort-Reset Round-Trip', () => {
  /**
   * **Validates: Requirements 11.1, 11.3**
   *
   * After resetPassword(id, newPassword): login with new password succeeds,
   * login with old password fails.
   */
  it('after password reset, login with new password succeeds and old password fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueUsername(),
        uniqueEmail(),
        validPassword,
        validPassword,
        async (username, email, oldPassword, newPassword) => {
          // Ensure passwords are different
          fc.pre(oldPassword !== newPassword);

          const { authDb, tmpDir } = createTempDb();
          try {
            const userService = createUserService(authDb.db);
            const authService = createAuthService({ db: authDb.db, sessionSecret: 'test-secret' });

            // Create user with old password
            const user = await userService.createUser({
              username,
              email,
              password: oldPassword,
              role: 'user',
            });

            // Verify login with old password works
            const loginBefore = await authService.login(username, oldPassword);
            expect(loginBefore.success).toBe(true);

            // Reset password
            await userService.resetPassword(user.id, newPassword);

            // Login with new password should succeed
            const loginWithNew = await authService.login(username, newPassword);
            expect(loginWithNew.success).toBe(true);
            expect(loginWithNew.user).toBeDefined();
            expect(loginWithNew.user!.id).toBe(user.id);

            // Login with old password should fail
            const loginWithOld = await authService.login(username, oldPassword);
            expect(loginWithOld.success).toBe(false);
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        },
      ),
      { numRuns: 10 }, // Low iterations due to argon2 hashing cost
    );
  }, 120_000);
});
