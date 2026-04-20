import type Database from 'better-sqlite3';
import { createPasswordService } from './password';

export interface AuthServiceConfig {
  db: Database.Database;
  sessionSecret: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

export interface LoginResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  is_active: number;
}

export interface AuthService {
  login(identity: string, password: string): Promise<LoginResult>;
  invalidateUserSessions(userId: number): void;
}

export function createAuthService(config: AuthServiceConfig): AuthService {
  const { db } = config;
  const passwordService = createPasswordService();

  const selectUserByIdentity = db.prepare(`
    SELECT id, username, email, password_hash, role, is_active
    FROM users WHERE username = ? OR email = ?
  `);

  return {
    async login(identity: string, password: string): Promise<LoginResult> {
      const row = selectUserByIdentity.get(identity, identity) as UserRow | undefined;

      if (!row) {
        return { success: false, error: 'Ungültige Anmeldedaten' };
      }

      const passwordValid = await passwordService.verify(row.password_hash, password);
      if (!passwordValid) {
        return { success: false, error: 'Ungültige Anmeldedaten' };
      }

      if (row.is_active === 0) {
        return { success: false, error: 'Konto ist deaktiviert' };
      }

      const user: AuthUser = {
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role,
        is_active: true,
      };

      // Session creation is handled by express-session in the route handler
      return { success: true, user };
    },

    invalidateUserSessions(userId: number): void {
      // The sessions table is managed by better-sqlite3-session-store
      // Its schema: (sid TEXT, sess TEXT, expire INTEGER)
      // The sess column contains JSON with user data
      try {
        db.prepare(`DELETE FROM sessions WHERE sess LIKE ?`).run(`%"id":${userId}%`);
      } catch {
        // Sessions table may not exist yet on first startup
      }
    },
  };
}
