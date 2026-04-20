import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createUserService, type UserService } from './user-service';
import { initAuthDatabase, type AuthDatabase } from '../db/auth-db';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Property-Based Tests for User Service
 * Feature: auth-user-management
 */

// Helper: create a fresh temp DB for each test
function createTempDb(): { authDb: AuthDatabase; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-svc-prop-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const authDb = initAuthDatabase(dbPath);
  return { authDb, tmpDir };
}

function cleanupDb(authDb: AuthDatabase, tmpDir: string): void {
  authDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Generators
let usernameCounter = 0;
const uniqueUsername = () =>
  fc.constant(null).map(() => `user_${++usernameCounter}_${Date.now()}`);

const uniqueEmail = () =>
  fc.constant(null).map(() => `u${++usernameCounter}_${Date.now()}@test.com`);

const validPassword = fc.string({ minLength: 8, maxLength: 32 });

const validRole = fc.constantFrom<'admin' | 'user'>('admin', 'user');

// ─────────────────────────────────────────────────────────────────────────────
// Property 9: Benutzererstellung speichert alle Felder korrekt
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 9: Benutzererstellung speichert alle Felder korrekt', () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.4**
   *
   * For every valid combination of username, email, password, and role:
   * stored fields match input values, is_active = true, password stored as Argon2id hash.
   */
  it('createUser stores all fields correctly with Argon2id hash and is_active=true', async () => {
    const { authDb, tmpDir } = createTempDb();
    try {
      const service = createUserService(authDb.db);

      await fc.assert(
        fc.asyncProperty(
          uniqueUsername(),
          uniqueEmail(),
          validPassword,
          validRole,
          async (username, email, password, role) => {
            const user = await service.createUser({ username, email, password, role });

            // Returned fields match input
            expect(user.username).toBe(username);
            expect(user.email).toBe(email);
            expect(user.role).toBe(role);
            expect(user.is_active).toBe(true);
            expect(user.id).toBeGreaterThan(0);

            // Check DB row directly for password hash
            const row = authDb.db
              .prepare('SELECT password_hash FROM users WHERE id = ?')
              .get(user.id) as { password_hash: string };

            expect(row.password_hash).toMatch(/^\$argon2id\$/);
            expect(row.password_hash).not.toBe(password);
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      cleanupDb(authDb, tmpDir);
    }
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 10: Deaktivierung/Aktivierung Round-Trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 10: Deaktivierung/Aktivierung Round-Trip', () => {
  /**
   * **Validates: Requirements 8.1, 8.4**
   *
   * For every active user: deactivateUser() → is_active = false,
   * then activateUser() → is_active = true.
   */
  it('deactivate then activate restores is_active to true', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueUsername(),
        uniqueEmail(),
        validRole,
        async (username, email, role) => {
          const { authDb, tmpDir } = createTempDb();
          try {
            const service = createUserService(authDb.db);

            // Create an admin to perform the operations
            const admin = await service.createUser({
              username: `admin_${Date.now()}_${Math.random()}`,
              email: `admin_${Date.now()}_${Math.random()}@test.com`,
              password: 'adminpass123',
              role: 'admin',
            });

            // Create the target user
            const user = await service.createUser({
              username,
              email,
              password: 'password123',
              role,
            });

            // Deactivate
            service.deactivateUser(user.id, admin.id);
            const afterDeactivate = service.getUserById(user.id);
            expect(afterDeactivate!.is_active).toBe(false);

            // Activate
            service.activateUser(user.id);
            const afterActivate = service.getUserById(user.id);
            expect(afterActivate!.is_active).toBe(true);
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 11: Selbstmodifikations-Schutz
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 11: Selbstmodifikations-Schutz', () => {
  /**
   * **Validates: Requirements 8.6, 9.2, 10.3**
   *
   * For every admin: deactivateUser(ownId), deleteUser(ownId), changeRole(ownId)
   * are all rejected with an error.
   */
  it('admin cannot deactivate, delete, or change role of themselves', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueUsername(),
        uniqueEmail(),
        async (username, email) => {
          const { authDb, tmpDir } = createTempDb();
          try {
            const service = createUserService(authDb.db);

            const admin = await service.createUser({
              username,
              email,
              password: 'password123',
              role: 'admin',
            });

            // Self-deactivation rejected
            expect(() => service.deactivateUser(admin.id, admin.id)).toThrow();

            // Self-deletion rejected
            expect(() => service.deleteUser(admin.id, admin.id)).toThrow();

            // Self-role-change rejected
            expect(() => service.changeRole(admin.id, 'user', admin.id)).toThrow();
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 12: Letzter-Admin-Schutz
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 12: Letzter-Admin-Schutz', () => {
  /**
   * **Validates: Requirements 9.4, 10.4**
   *
   * With exactly one admin: deleteUser(adminId) and changeRole(adminId, 'user')
   * are rejected.
   */
  it('last admin cannot be deleted or demoted', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueUsername(),
        uniqueEmail(),
        uniqueUsername(),
        uniqueEmail(),
        async (adminUsername, adminEmail, userUsername, userEmail) => {
          const { authDb, tmpDir } = createTempDb();
          try {
            const service = createUserService(authDb.db);

            // Create exactly one admin
            const admin = await service.createUser({
              username: adminUsername,
              email: adminEmail,
              password: 'password123',
              role: 'admin',
            });

            // Create a regular user (to act as requestingAdminId for non-self operations)
            const regularUser = await service.createUser({
              username: userUsername,
              email: userEmail,
              password: 'password123',
              role: 'user',
            });

            expect(service.countAdmins()).toBe(1);

            // Deleting the last admin is rejected (requested by the regular user)
            expect(() => service.deleteUser(admin.id, regularUser.id)).toThrow(
              'Letzter Admin kann nicht gelöscht werden',
            );

            // Demoting the last admin is rejected
            expect(() => service.changeRole(admin.id, 'user', regularUser.id)).toThrow(
              'Letzter Admin kann nicht degradiert werden',
            );

            // Admin still exists and is still admin
            const stillAdmin = service.getUserById(admin.id);
            expect(stillAdmin).not.toBeNull();
            expect(stillAdmin!.role).toBe('admin');
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 13: Rollenänderung aktualisiert Rolle und Zeitstempel
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 13: Rollenänderung aktualisiert Rolle und Zeitstempel', () => {
  /**
   * **Validates: Requirements 10.1**
   *
   * For every valid role change: role is updated, updated_at >= previous value.
   */
  it('changeRole updates role and updated_at timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueUsername(),
        uniqueEmail(),
        async (username, email) => {
          const { authDb, tmpDir } = createTempDb();
          try {
            const service = createUserService(authDb.db);

            // Create an admin to perform the operation
            const admin = await service.createUser({
              username: `admin_${Date.now()}_${Math.random()}`,
              email: `admin_${Date.now()}_${Math.random()}@test.com`,
              password: 'adminpass123',
              role: 'admin',
            });

            // Create a user to change role on
            const user = await service.createUser({
              username,
              email,
              password: 'password123',
              role: 'user',
            });

            // Read the original updated_at
            const beforeRow = authDb.db
              .prepare('SELECT updated_at FROM users WHERE id = ?')
              .get(user.id) as { updated_at: string };

            // Change role from user → admin
            service.changeRole(user.id, 'admin', admin.id);

            const afterRow = authDb.db
              .prepare('SELECT role, updated_at FROM users WHERE id = ?')
              .get(user.id) as { role: string; updated_at: string };

            expect(afterRow.role).toBe('admin');
            expect(afterRow.updated_at >= beforeRow.updated_at).toBe(true);
          } finally {
            cleanupDb(authDb, tmpDir);
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 120_000);
});
