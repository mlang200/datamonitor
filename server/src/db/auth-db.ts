import Database from 'better-sqlite3';

export interface AuthDatabase {
  db: Database.Database;
  close(): void;
}

export function initAuthDatabase(dbPath: string): AuthDatabase {
  const db = new Database(dbPath);

  // Enable WAL mode for concurrent read access
  db.pragma('journal_mode = WAL');

  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Note: sessions table is created by better-sqlite3-session-store at runtime.
  // Do NOT create it here — the store manages its own schema.

  return {
    db,
    close() {
      db.close();
    },
  };
}
