export interface RateLimiterConfig {
  maxAttempts: number; // Default: 10
  windowMs: number; // Default: 15 * 60 * 1000 (15 minutes)
}

interface RateLimiterEntry {
  count: number;
  firstAttempt: number; // Timestamp
}

export interface RateLimiter {
  check(ip: string): { allowed: boolean; retryAfterMs?: number };
  recordFailure(ip: string): void;
  reset(ip: string): void;
  destroy(): void;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000, // 15 minutes
};

export function createRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  const { maxAttempts, windowMs } = { ...DEFAULT_CONFIG, ...config };
  const entries = new Map<string, RateLimiterEntry>();

  // Periodic cleanup of expired entries every 5 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of entries) {
      if (now - entry.firstAttempt >= windowMs) {
        entries.delete(ip);
      }
    }
  }, 5 * 60 * 1000);

  // Prevent the interval from keeping the process alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return {
    check(ip: string): { allowed: boolean; retryAfterMs?: number } {
      const now = Date.now();
      const entry = entries.get(ip);

      if (!entry) {
        return { allowed: true };
      }

      // If the window has expired, clean up and allow
      if (now - entry.firstAttempt >= windowMs) {
        entries.delete(ip);
        return { allowed: true };
      }

      if (entry.count >= maxAttempts) {
        const retryAfterMs = windowMs - (now - entry.firstAttempt);
        return { allowed: false, retryAfterMs };
      }

      return { allowed: true };
    },

    recordFailure(ip: string): void {
      const now = Date.now();
      const entry = entries.get(ip);

      if (!entry || now - entry.firstAttempt >= windowMs) {
        entries.set(ip, { count: 1, firstAttempt: now });
        return;
      }

      entry.count++;
    },

    reset(ip: string): void {
      entries.delete(ip);
    },

    destroy(): void {
      clearInterval(cleanupInterval);
      entries.clear();
    },
  };
}
