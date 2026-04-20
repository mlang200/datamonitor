import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { seedInitialAdmin, type SeedConfig } from './seed';
import { createUserService } from './user-service';
import { initAuthDatabase, type AuthDatabase } from '../db/auth-db';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Property-Based Tests for Admin Seed
 * Feature: auth-user-management
 */

function createTempDb(): { authDb: AuthDatabase; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-prop-'));
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

// Number of pre-existing users to seed (1..5)
const preExistingCount = fc.integer({ min: 1, max: 5 });

// ─────────────────────────────────────────────────────────────────────────────
// Property 17: Admin-Seed nur bei leerer Tabelle
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 17: Admin-Seed nur bei leerer Tabelle', () => {
  /**
   * **Validates: Requirements 13.5**
   *
   * For every non-empty users table: seedInitialAdmin() creates no new user —
   * the user count remains unchanged.
   */
  it('seedInitialAdmin does not create a user when the table is non-empty', async () => {
    await fc.assert(
      fc.asyncProperty(
        preExistingCount,
        async (count) => {
          const { authDb, tmpDir } = createTempDb();
          try {
            const service = createUserService(authDb.db);

            // Pre-populate the table with `count` users
            for (let i = 0; i < count; i++) {
              await service.createUser({
                username: `existing_${i}_${Date.now()}_${Math.random()}`,
                email: `existing_${i}_${Date.now()}_${Math.random()}@test.com`,
                password: 'password123',
                role: i === 0 ? 'admin' : 'user',
              });
            }

            const usersBefore = service.getUsers().length;
            expect(usersBefore).toBe(count);

            // Call seedInitialAdmin with valid config
            const config: SeedConfig = {
              username: 'seed_admin',
              email: 'seed@admin.com',
              password: 'seedpassword123',
            };

            await seedInitialAdmin(service, config);

            const usersAfter = service.getUsers().length;
            expect(usersAfter).toBe(usersBefore);
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 120_000);
});
