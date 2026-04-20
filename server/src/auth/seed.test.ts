import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { seedInitialAdmin, type SeedConfig } from './seed';
import { createUserService } from './user-service';
import { initAuthDatabase, type AuthDatabase } from '../db/auth-db';
import path from 'path';
import fs from 'fs';
import os from 'os';

function createTempDb(): { authDb: AuthDatabase; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-unit-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const authDb = initAuthDatabase(dbPath);
  return { authDb, tmpDir };
}

function cleanupDb(authDb: AuthDatabase, tmpDir: string): void {
  authDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('seedInitialAdmin', () => {
  let authDb: AuthDatabase;
  let tmpDir: string;

  beforeEach(() => {
    ({ authDb, tmpDir } = createTempDb());
  });

  afterEach(() => {
    cleanupDb(authDb, tmpDir);
  });

  it('creates admin user when DB is empty and env vars are set', async () => {
    const userService = createUserService(authDb.db);
    const config: SeedConfig = {
      username: 'admin',
      email: 'admin@example.com',
      password: 'securepassword123',
    };

    await seedInitialAdmin(userService, config);

    const users = userService.getUsers();
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('admin');
    expect(users[0].email).toBe('admin@example.com');
    expect(users[0].role).toBe('admin');
    expect(users[0].is_active).toBe(true);
  });

  it('logs warning when DB is empty and env vars are not set', async () => {
    const userService = createUserService(authDb.db);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config: SeedConfig = {};

    await seedInitialAdmin(userService, config);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('INITIAL_ADMIN_');
    expect(userService.getUsers()).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it('does not create a new user when DB already has users', async () => {
    const userService = createUserService(authDb.db);

    // Pre-populate with an existing user
    await userService.createUser({
      username: 'existing_admin',
      email: 'existing@example.com',
      password: 'password123',
      role: 'admin',
    });

    const config: SeedConfig = {
      username: 'new_admin',
      email: 'new@example.com',
      password: 'newpassword123',
    };

    await seedInitialAdmin(userService, config);

    const users = userService.getUsers();
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('existing_admin');
  });
});
