import type Database from 'better-sqlite3';
import { createPasswordService, type PasswordService } from './password';

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface UserService {
  createUser(input: CreateUserInput): Promise<AuthUser>;
  getUsers(): AuthUser[];
  getUserById(id: number): AuthUser | null;
  deactivateUser(id: number, requestingAdminId: number): void;
  activateUser(id: number): void;
  deleteUser(id: number, requestingAdminId: number): void;
  changeRole(id: number, newRole: 'admin' | 'user', requestingAdminId: number): void;
  resetPassword(id: number, newPassword: string): Promise<void>;
  countAdmins(): number;
  isEmpty(): boolean;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    is_active: row.is_active === 1,
  };
}

export function createUserService(db: Database.Database): UserService {
  const passwordService: PasswordService = createPasswordService();

  // Prepared statements
  const insertUser = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, is_active)
    VALUES (@username, @email, @password_hash, @role, 1)
  `);

  const selectAllUsers = db.prepare(`
    SELECT id, username, email, password_hash, role, is_active, created_at, updated_at
    FROM users ORDER BY id
  `);

  const selectUserById = db.prepare(`
    SELECT id, username, email, password_hash, role, is_active, created_at, updated_at
    FROM users WHERE id = ?
  `);

  const updateIsActive = db.prepare(`
    UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const deleteUserStmt = db.prepare(`DELETE FROM users WHERE id = ?`);

  const updateRole = db.prepare(`
    UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const updatePasswordHash = db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const countAdminStmt = db.prepare(`
    SELECT COUNT(*) as count FROM users WHERE role = 'admin'
  `);

  const countUsersStmt = db.prepare(`
    SELECT COUNT(*) as count FROM users
  `);

  return {
    async createUser(input: CreateUserInput): Promise<AuthUser> {
      const hash = await passwordService.hash(input.password);

      try {
        const result = insertUser.run({
          username: input.username,
          email: input.email,
          password_hash: hash,
          role: input.role,
        });

        return {
          id: result.lastInsertRowid as number,
          username: input.username,
          email: input.email,
          role: input.role,
          is_active: true,
        };
      } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          if (err.message.includes('username')) {
            throw new Error('Benutzername existiert bereits');
          }
          if (err.message.includes('email')) {
            throw new Error('E-Mail existiert bereits');
          }
        }
        throw err;
      }
    },

    getUsers(): AuthUser[] {
      const rows = selectAllUsers.all() as UserRow[];
      return rows.map(toAuthUser);
    },

    getUserById(id: number): AuthUser | null {
      const row = selectUserById.get(id) as UserRow | undefined;
      return row ? toAuthUser(row) : null;
    },

    deactivateUser(id: number, requestingAdminId: number): void {
      if (id === requestingAdminId) {
        throw new Error('Eigenes Konto kann nicht deaktiviert werden');
      }

      const row = selectUserById.get(id) as UserRow | undefined;
      if (!row) {
        throw new Error('Benutzer nicht gefunden');
      }

      updateIsActive.run(0, id);
    },

    activateUser(id: number): void {
      const row = selectUserById.get(id) as UserRow | undefined;
      if (!row) {
        throw new Error('Benutzer nicht gefunden');
      }

      updateIsActive.run(1, id);
    },

    deleteUser(id: number, requestingAdminId: number): void {
      if (id === requestingAdminId) {
        throw new Error('Eigenes Konto kann nicht gelöscht werden');
      }

      const row = selectUserById.get(id) as UserRow | undefined;
      if (!row) {
        throw new Error('Benutzer nicht gefunden');
      }

      if (row.role === 'admin') {
        const { count } = countAdminStmt.get() as { count: number };
        if (count <= 1) {
          throw new Error('Letzter Admin kann nicht gelöscht werden');
        }
      }

      // Delete user sessions (sessions store user id in the sess JSON)
      try {
        db.prepare(`DELETE FROM sessions WHERE sess LIKE ?`).run(`%"id":${id}%`);
      } catch {
        // Sessions table may not exist yet
      }
      deleteUserStmt.run(id);
    },

    changeRole(id: number, newRole: 'admin' | 'user', requestingAdminId: number): void {
      if (id === requestingAdminId) {
        throw new Error('Eigene Rolle kann nicht geändert werden');
      }

      const row = selectUserById.get(id) as UserRow | undefined;
      if (!row) {
        throw new Error('Benutzer nicht gefunden');
      }

      // If demoting an admin, check last-admin constraint
      if (row.role === 'admin' && newRole === 'user') {
        const { count } = countAdminStmt.get() as { count: number };
        if (count <= 1) {
          throw new Error('Letzter Admin kann nicht degradiert werden');
        }
      }

      updateRole.run(newRole, id);
    },

    async resetPassword(id: number, newPassword: string): Promise<void> {
      const validation = passwordService.validate(newPassword);
      if (!validation.valid) {
        throw new Error(validation.error!);
      }

      const row = selectUserById.get(id) as UserRow | undefined;
      if (!row) {
        throw new Error('Benutzer nicht gefunden');
      }

      const hash = await passwordService.hash(newPassword);
      updatePasswordHash.run(hash, id);
    },

    countAdmins(): number {
      const { count } = countAdminStmt.get() as { count: number };
      return count;
    },

    isEmpty(): boolean {
      const { count } = countUsersStmt.get() as { count: number };
      return count === 0;
    },
  };
}
