import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createUserService, type UserService } from './user-service';
import { initAuthDatabase, type AuthDatabase } from '../db/auth-db';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('UserService', () => {
  let authDb: AuthDatabase;
  let service: UserService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-service-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    authDb = initAuthDatabase(dbPath);
    service = createUserService(authDb.db);
  });

  afterEach(() => {
    authDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createUser', () => {
    it('should create a user with correct fields', async () => {
      const user = await service.createUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        role: 'user',
      });

      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
      expect(user.role).toBe('user');
      expect(user.is_active).toBe(true);
      expect(user.id).toBeGreaterThan(0);
    });

    it('should create an admin user', async () => {
      const user = await service.createUser({
        username: 'admin1',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin',
      });

      expect(user.role).toBe('admin');
    });

    it('should reject duplicate username', async () => {
      await service.createUser({
        username: 'testuser',
        email: 'test1@example.com',
        password: 'password123',
        role: 'user',
      });

      await expect(
        service.createUser({
          username: 'testuser',
          email: 'test2@example.com',
          password: 'password123',
          role: 'user',
        })
      ).rejects.toThrow('Benutzername existiert bereits');
    });

    it('should reject duplicate email', async () => {
      await service.createUser({
        username: 'user1',
        email: 'test@example.com',
        password: 'password123',
        role: 'user',
      });

      await expect(
        service.createUser({
          username: 'user2',
          email: 'test@example.com',
          password: 'password123',
          role: 'user',
        })
      ).rejects.toThrow('E-Mail existiert bereits');
    });

    it('should hash the password (not store plaintext)', async () => {
      await service.createUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        role: 'user',
      });

      const row = authDb.db
        .prepare('SELECT password_hash FROM users WHERE username = ?')
        .get('testuser') as { password_hash: string };

      expect(row.password_hash).not.toBe('password123');
      expect(row.password_hash).toMatch(/^\$argon2id/);
    });
  });

  describe('getUsers', () => {
    it('should return empty array when no users', () => {
      expect(service.getUsers()).toEqual([]);
    });

    it('should return all users', async () => {
      await service.createUser({ username: 'u1', email: 'u1@test.com', password: 'password123', role: 'user' });
      await service.createUser({ username: 'u2', email: 'u2@test.com', password: 'password123', role: 'admin' });

      const users = service.getUsers();
      expect(users).toHaveLength(2);
      expect(users[0].username).toBe('u1');
      expect(users[1].username).toBe('u2');
    });
  });

  describe('getUserById', () => {
    it('should return null for non-existent user', () => {
      expect(service.getUserById(999)).toBeNull();
    });

    it('should return user by id', async () => {
      const created = await service.createUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        role: 'user',
      });

      const user = service.getUserById(created.id);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('testuser');
      expect(user!.is_active).toBe(true);
    });
  });

  describe('deactivateUser', () => {
    it('should set is_active to false', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      service.deactivateUser(user.id, admin.id);

      const updated = service.getUserById(user.id);
      expect(updated!.is_active).toBe(false);
    });

    it('should prevent self-deactivation', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });

      expect(() => service.deactivateUser(admin.id, admin.id)).toThrow(
        'Eigenes Konto kann nicht deaktiviert werden'
      );
    });

    it('should throw for non-existent user', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });

      expect(() => service.deactivateUser(999, admin.id)).toThrow('Benutzer nicht gefunden');
    });
  });

  describe('activateUser', () => {
    it('should set is_active to true', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      service.deactivateUser(user.id, admin.id);
      service.activateUser(user.id);

      const updated = service.getUserById(user.id);
      expect(updated!.is_active).toBe(true);
    });

    it('should throw for non-existent user', () => {
      expect(() => service.activateUser(999)).toThrow('Benutzer nicht gefunden');
    });
  });

  describe('deleteUser', () => {
    it('should delete a user', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      service.deleteUser(user.id, admin.id);

      expect(service.getUserById(user.id)).toBeNull();
    });

    it('should prevent self-deletion', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });

      expect(() => service.deleteUser(admin.id, admin.id)).toThrow(
        'Eigenes Konto kann nicht gelöscht werden'
      );
    });

    it('should prevent deleting the last admin', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      expect(() => service.deleteUser(admin.id, user.id)).toThrow(
        'Letzter Admin kann nicht gelöscht werden'
      );
    });

    it('should allow deleting an admin when another admin exists', async () => {
      const admin1 = await service.createUser({ username: 'admin1', email: 'admin1@test.com', password: 'password123', role: 'admin' });
      const admin2 = await service.createUser({ username: 'admin2', email: 'admin2@test.com', password: 'password123', role: 'admin' });

      service.deleteUser(admin1.id, admin2.id);
      expect(service.getUserById(admin1.id)).toBeNull();
    });

    it('should throw for non-existent user', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });

      expect(() => service.deleteUser(999, admin.id)).toThrow('Benutzer nicht gefunden');
    });
  });

  describe('changeRole', () => {
    it('should change role from user to admin', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      service.changeRole(user.id, 'admin', admin.id);

      const updated = service.getUserById(user.id);
      expect(updated!.role).toBe('admin');
    });

    it('should prevent self-role-change', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });

      expect(() => service.changeRole(admin.id, 'user', admin.id)).toThrow(
        'Eigene Rolle kann nicht geändert werden'
      );
    });

    it('should prevent demoting the last admin', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      expect(() => service.changeRole(admin.id, 'user', user.id)).toThrow(
        'Letzter Admin kann nicht degradiert werden'
      );
    });

    it('should allow demoting an admin when another admin exists', async () => {
      const admin1 = await service.createUser({ username: 'admin1', email: 'admin1@test.com', password: 'password123', role: 'admin' });
      const admin2 = await service.createUser({ username: 'admin2', email: 'admin2@test.com', password: 'password123', role: 'admin' });

      service.changeRole(admin1.id, 'user', admin2.id);

      const updated = service.getUserById(admin1.id);
      expect(updated!.role).toBe('user');
    });

    it('should throw for non-existent user', async () => {
      const admin = await service.createUser({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });

      expect(() => service.changeRole(999, 'admin', admin.id)).toThrow('Benutzer nicht gefunden');
    });
  });

  describe('resetPassword', () => {
    it('should update the password hash', async () => {
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      const oldHash = (authDb.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as any).password_hash;

      await service.resetPassword(user.id, 'newpassword123');

      const newHash = (authDb.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as any).password_hash;
      expect(newHash).not.toBe(oldHash);
      expect(newHash).toMatch(/^\$argon2id/);
    });

    it('should reject short passwords', async () => {
      const user = await service.createUser({ username: 'user1', email: 'user1@test.com', password: 'password123', role: 'user' });

      await expect(service.resetPassword(user.id, 'short')).rejects.toThrow(
        'Passwort muss mindestens 8 Zeichen lang sein'
      );
    });

    it('should throw for non-existent user', async () => {
      await expect(service.resetPassword(999, 'newpassword123')).rejects.toThrow(
        'Benutzer nicht gefunden'
      );
    });
  });

  describe('countAdmins', () => {
    it('should return 0 when no admins', () => {
      expect(service.countAdmins()).toBe(0);
    });

    it('should count admin users', async () => {
      await service.createUser({ username: 'admin1', email: 'a1@test.com', password: 'password123', role: 'admin' });
      await service.createUser({ username: 'admin2', email: 'a2@test.com', password: 'password123', role: 'admin' });
      await service.createUser({ username: 'user1', email: 'u1@test.com', password: 'password123', role: 'user' });

      expect(service.countAdmins()).toBe(2);
    });
  });

  describe('isEmpty', () => {
    it('should return true when no users', () => {
      expect(service.isEmpty()).toBe(true);
    });

    it('should return false when users exist', async () => {
      await service.createUser({ username: 'user1', email: 'u1@test.com', password: 'password123', role: 'user' });

      expect(service.isEmpty()).toBe(false);
    });
  });
});
