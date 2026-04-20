import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { createRateLimiter, type RateLimiter } from './rate-limiter';

/**
 * Property-Based Tests for Rate Limiter
 * Feature: auth-user-management
 */

// Generator for IP addresses
const ipAddress = fc.ipV4();

// Generator for maxAttempts (small range for fast tests)
const maxAttempts = fc.integer({ min: 1, max: 50 });

// ─────────────────────────────────────────────────────────────────────────────
// Property 15: Rate-Limiter blockiert nach Schwellenwert
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 15: Rate-Limiter blockiert nach Schwellenwert', () => {
  /**
   * **Validates: Requirements 12.1, 12.2**
   *
   * After N recordFailure(ip) calls: check(ip) returns { allowed: false, retryAfterMs > 0 }
   */
  it('blocks IP after exactly maxAttempts failures', () => {
    fc.assert(
      fc.property(ipAddress, maxAttempts, (ip, max) => {
        const limiter = createRateLimiter({ maxAttempts: max, windowMs: 15 * 60 * 1000 });
        try {
          // Before any failures, should be allowed
          expect(limiter.check(ip).allowed).toBe(true);

          // Record exactly max failures
          for (let i = 0; i < max; i++) {
            limiter.recordFailure(ip);
          }

          // After max failures, should be blocked
          const result = limiter.check(ip);
          expect(result.allowed).toBe(false);
          expect(result.retryAfterMs).toBeDefined();
          expect(result.retryAfterMs!).toBeGreaterThan(0);
        } finally {
          limiter.destroy();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('allows IP with fewer than maxAttempts failures', () => {
    fc.assert(
      fc.property(
        ipAddress,
        fc.integer({ min: 2, max: 50 }),
        (ip, max) => {
          const limiter = createRateLimiter({ maxAttempts: max, windowMs: 15 * 60 * 1000 });
          try {
            // Record fewer than max failures
            for (let i = 0; i < max - 1; i++) {
              limiter.recordFailure(ip);
            }

            // Should still be allowed
            expect(limiter.check(ip).allowed).toBe(true);
          } finally {
            limiter.destroy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('different IPs are tracked independently', () => {
    fc.assert(
      fc.property(
        ipAddress,
        ipAddress,
        maxAttempts,
        (ip1, ip2, max) => {
          // Ensure different IPs
          fc.pre(ip1 !== ip2);

          const limiter = createRateLimiter({ maxAttempts: max, windowMs: 15 * 60 * 1000 });
          try {
            // Block ip1
            for (let i = 0; i < max; i++) {
              limiter.recordFailure(ip1);
            }

            // ip1 blocked, ip2 still allowed
            expect(limiter.check(ip1).allowed).toBe(false);
            expect(limiter.check(ip2).allowed).toBe(true);
          } finally {
            limiter.destroy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 16: Rate-Limiter Reset bei Erfolg
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: auth-user-management, Property 16: Rate-Limiter Reset bei Erfolg', () => {
  /**
   * **Validates: Requirements 12.3**
   *
   * After any number of failures (< max): reset(ip) → check(ip) returns { allowed: true }
   */
  it('reset clears failure count so check returns allowed', () => {
    fc.assert(
      fc.property(
        ipAddress,
        fc.integer({ min: 2, max: 50 }),
        fc.integer({ min: 1, max: 49 }),
        (ip, max, failCount) => {
          // Ensure failCount < max
          const actualFailCount = Math.min(failCount, max - 1);

          const limiter = createRateLimiter({ maxAttempts: max, windowMs: 15 * 60 * 1000 });
          try {
            // Record some failures
            for (let i = 0; i < actualFailCount; i++) {
              limiter.recordFailure(ip);
            }

            // Reset
            limiter.reset(ip);

            // Should be allowed again
            const result = limiter.check(ip);
            expect(result.allowed).toBe(true);
            expect(result.retryAfterMs).toBeUndefined();
          } finally {
            limiter.destroy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reset after being blocked restores access', () => {
    fc.assert(
      fc.property(ipAddress, maxAttempts, (ip, max) => {
        const limiter = createRateLimiter({ maxAttempts: max, windowMs: 15 * 60 * 1000 });
        try {
          // Block the IP
          for (let i = 0; i < max; i++) {
            limiter.recordFailure(ip);
          }
          expect(limiter.check(ip).allowed).toBe(false);

          // Reset
          limiter.reset(ip);

          // Should be allowed again
          const result = limiter.check(ip);
          expect(result.allowed).toBe(true);
        } finally {
          limiter.destroy();
        }
      }),
      { numRuns: 100 },
    );
  });
});
