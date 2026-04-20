import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createPasswordService } from './password.js';

const service = createPasswordService();

/**
 * Property-Based Tests for Password Service
 * Feature: auth-user-management
 */

describe('Feature: auth-user-management, Property 1: Argon2id-Hash-Format', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * For every valid password (length ≥ 8): hash(password) produces a string
   * starting with `$argon2id` and does NOT contain the plaintext password.
   */
  it('hash produces $argon2id prefix and never contains plaintext', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        async (password) => {
          const hash = await service.hash(password);
          expect(hash).toMatch(/^\$argon2id\$/);
          expect(hash).not.toContain(password);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

describe('Feature: auth-user-management, Property 2: Passwort-Hash/Verify Round-Trip', () => {
  /**
   * **Validates: Requirements 2.7**
   *
   * For every valid password: verify(hash(password), password) returns true.
   */
  it('verify(hash(pw), pw) always returns true', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        async (password) => {
          const hashed = await service.hash(password);
          const result = await service.verify(hashed, password);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

describe('Feature: auth-user-management, Property 3: Passwort-Salt-Einzigartigkeit', () => {
  /**
   * **Validates: Requirements 2.8**
   *
   * For every password: hashing twice produces two different hash strings.
   */
  it('hashing the same password twice yields different hashes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        async (password) => {
          const hash1 = await service.hash(password);
          const hash2 = await service.hash(password);
          expect(hash1).not.toBe(hash2);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

describe('Feature: auth-user-management, Property 4: Passwort-Validierungsregeln', () => {
  /**
   * **Validates: Requirements 2.4, 2.5, 2.6**
   *
   * Strings with length < 8 are rejected, strings with length ≥ 8 are accepted
   * (including Unicode, special chars, 128+ chars).
   */
  it('rejects strings shorter than 8 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 7 }),
        (short) => {
          const result = service.validate(short);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepts strings with length >= 8 (including unicode and special chars)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 200 }),
        (long) => {
          const result = service.validate(long);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepts strings with 128+ characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 128, maxLength: 256 }),
        (veryLong) => {
          const result = service.validate(veryLong);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
