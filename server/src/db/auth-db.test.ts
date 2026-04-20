import { describe, it, expect, afterEach } from 'vitest';
import { initAuthDatabase } from './auth-db.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function createTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-db-test-'));
  return path.join(tmpDir, 'auth-test.db');
}

function cleanupDbPath(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, file));
    }
    fs.rmdirSync(dir);
  }
}

describe('Auth Database Initialization', () => {
  let dbPath: string;

  afterEach(() => {
    if (dbPath) {
      cleanupDbPath(dbPath);
    }
  });

  // Validates: Requirement 1.1 — users table with all required fields
  it('should create users table with all required columns', () => {
    dbPath = createTempDbPath();
    const { db, close } = initAuthDatabase(dbPath);

    const columns = db
      .prepare("PRAGMA table_info('users')")
      .all() as { name: string; type: string; notnull: number }[];

    const columnNames = columns.map(c => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('username');
    expect(columnNames).toContain('email');
    expect(columnNames).toContain('password_hash');
    expect(columnNames).toContain('role');
    expect(columnNames).toContain('is_active');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');

    close();
  });

  // Validates: Requirement 1.6 — WAL mode enabled
  it('should enable WAL journal mode', () => {
    dbPath = createTempDbPath();
    const { db, close } = initAuthDatabase(dbPath);

    const result = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');

    close();
  });

  // Validates: Requirement 1.5 — UNIQUE constraint on username
  it('should enforce UNIQUE constraint on username', () => {
    dbPath = createTempDbPath();
    const { db, close } = initAuthDatabase(dbPath);

    db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('testuser', 'a@example.com', 'hash1', 'user')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ('testuser', 'b@example.com', 'hash2', 'user')
      `).run();
    }).toThrow();

    close();
  });

  // Validates: Requirement 1.5 — UNIQUE constraint on email
  it('should enforce UNIQUE constraint on email', () => {
    dbPath = createTempDbPath();
    const { db, close } = initAuthDatabase(dbPath);

    db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('user1', 'same@example.com', 'hash1', 'user')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ('user2', 'same@example.com', 'hash2', 'user')
      `).run();
    }).toThrow();

    close();
  });

  // Validates: Requirement 1.1 — role CHECK constraint
  it('should enforce CHECK constraint on role (only admin or user)', () => {
    dbPath = createTempDbPath();
    const { db, close } = initAuthDatabase(dbPath);

    expect(() => {
      db.prepare(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ('baduser', 'bad@example.com', 'hash', 'superadmin')
      `).run();
    }).toThrow();

    close();
  });

  // Validates: Requirement 1.1 — defaults for role, is_active, timestamps
  it('should set correct default values for role, is_active, created_at, updated_at', () => {
    dbPath = createTempDbPath();
    const { db, close } = initAuthDatabase(dbPath);

    db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES ('defaultuser', 'default@example.com', 'hash')
    `).run();

    const row = db.prepare('SELECT * FROM users WHERE username = ?').get('defaultuser') as Record<string, unknown>;
    expect(row.role).toBe('user');
    expect(row.is_active).toBe(1);
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();

    close();
  });

  // Validates: Requirement 1.2 — idempotent schema creation
  it('should be idempotent — calling initAuthDatabase twice works without error', () => {
    dbPath = createTempDbPath();

    const first = initAuthDatabase(dbPath);
    first.close();

    const second = initAuthDatabase(dbPath);
    const tables = second.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('users');

    second.close();
  });

  // Validates: Requirement 1.2 — data persists across re-init
  it('should preserve existing data when re-initialized', () => {
    dbPath = createTempDbPath();

    const first = initAuthDatabase(dbPath);
    first.db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('persist', 'persist@example.com', 'hash', 'admin')
    `).run();
    first.close();

    const second = initAuthDatabase(dbPath);
    const row = second.db.prepare('SELECT * FROM users WHERE username = ?').get('persist') as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.username).toBe('persist');
    expect(row.role).toBe('admin');

    second.close();
  });
});
