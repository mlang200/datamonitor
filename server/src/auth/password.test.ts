import { describe, it, expect } from 'vitest';
import { createPasswordService } from './password.js';

describe('createPasswordService', () => {
  const service = createPasswordService();

  describe('hash()', () => {
    it('produces an argon2id hash', async () => {
      const hash = await service.hash('securepass');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('does not contain the plaintext password', async () => {
      const password = 'my-secret-password-123';
      const hash = await service.hash(password);
      expect(hash).not.toContain(password);
    });

    it('produces unique hashes for the same password', async () => {
      const a = await service.hash('samepassword');
      const b = await service.hash('samepassword');
      expect(a).not.toBe(b);
    });
  });

  describe('verify()', () => {
    it('returns true for matching password', async () => {
      const hash = await service.hash('testpass1');
      expect(await service.verify(hash, 'testpass1')).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const hash = await service.hash('testpass1');
      expect(await service.verify(hash, 'wrongpass')).toBe(false);
    });
  });

  describe('validate()', () => {
    it('rejects passwords shorter than 8 characters', () => {
      expect(service.validate('1234567')).toEqual({
        valid: false,
        error: 'Passwort muss mindestens 8 Zeichen lang sein',
      });
    });

    it('accepts passwords with exactly 8 characters', () => {
      expect(service.validate('12345678')).toEqual({ valid: true });
    });

    it('accepts passwords with 128+ characters', () => {
      const long = 'a'.repeat(200);
      expect(service.validate(long)).toEqual({ valid: true });
    });

    it('accepts unicode and special characters', () => {
      expect(service.validate('über🎉✓§')).toEqual({ valid: true });
    });

    it('rejects empty string', () => {
      expect(service.validate('')).toEqual({
        valid: false,
        error: 'Passwort muss mindestens 8 Zeichen lang sein',
      });
    });
  });
});
