import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  getProductionWindow,
  getWindowStatus,
  msUntilWindowStart,
  msUntilWindowEnd,
  type ProductionWindow,
} from './useProductionWindow';

const WINDOW_BEFORE_MS = 15 * 60 * 1000;
const WINDOW_AFTER_MS = 165 * 60 * 1000;

describe('getProductionWindow', () => {
  it('returns null for invalid date', () => {
    expect(getProductionWindow('not-a-date')).toBeNull();
    expect(getProductionWindow('')).toBeNull();
  });

  it('computes correct window for a valid date', () => {
    const scheduled = '2026-04-20T15:00:00Z';
    const w = getProductionWindow(scheduled)!;
    expect(w).not.toBeNull();
    expect(w.scheduledAt.toISOString()).toBe('2026-04-20T15:00:00.000Z');
    expect(w.start.toISOString()).toBe('2026-04-20T14:45:00.000Z'); // -15min
    expect(w.end.toISOString()).toBe('2026-04-20T17:45:00.000Z');   // +2h45min
  });

  it('property: window.start is always 15min before scheduledAt', () => {
    fc.assert(fc.property(
      fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
      (date) => {
        const w = getProductionWindow(date.toISOString())!;
        expect(w.start.getTime()).toBe(date.getTime() - WINDOW_BEFORE_MS);
      }
    ), { numRuns: 100 });
  });

  it('property: window.end is always 2h45min after scheduledAt', () => {
    fc.assert(fc.property(
      fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
      (date) => {
        const w = getProductionWindow(date.toISOString())!;
        expect(w.end.getTime()).toBe(date.getTime() + WINDOW_AFTER_MS);
      }
    ), { numRuns: 100 });
  });
});

describe('getWindowStatus', () => {
  const w: ProductionWindow = {
    scheduledAt: new Date('2026-04-20T15:00:00Z'),
    start: new Date('2026-04-20T14:45:00Z'),
    end: new Date('2026-04-20T17:45:00Z'),
  };

  it('returns "before" when now is before window start', () => {
    expect(getWindowStatus(w, new Date('2026-04-20T14:00:00Z'))).toBe('before');
    expect(getWindowStatus(w, new Date('2026-04-20T14:44:59Z'))).toBe('before');
  });

  it('returns "active" when now is within the window', () => {
    expect(getWindowStatus(w, new Date('2026-04-20T14:45:00Z'))).toBe('active');
    expect(getWindowStatus(w, new Date('2026-04-20T15:00:00Z'))).toBe('active');
    expect(getWindowStatus(w, new Date('2026-04-20T16:30:00Z'))).toBe('active');
    expect(getWindowStatus(w, new Date('2026-04-20T17:45:00Z'))).toBe('active');
  });

  it('returns "after" when now is after window end', () => {
    expect(getWindowStatus(w, new Date('2026-04-20T17:45:01Z'))).toBe('after');
    expect(getWindowStatus(w, new Date('2026-04-20T20:00:00Z'))).toBe('after');
  });

  it('property: status is always one of before/active/after', () => {
    fc.assert(fc.property(
      fc.date({ min: new Date('2026-04-20T10:00:00Z'), max: new Date('2026-04-20T22:00:00Z') }),
      (now) => {
        const s = getWindowStatus(w, now);
        expect(['before', 'active', 'after']).toContain(s);
      }
    ), { numRuns: 100 });
  });
});

describe('msUntilWindowStart / msUntilWindowEnd', () => {
  const w: ProductionWindow = {
    scheduledAt: new Date('2026-04-20T15:00:00Z'),
    start: new Date('2026-04-20T14:45:00Z'),
    end: new Date('2026-04-20T17:45:00Z'),
  };

  it('msUntilWindowStart returns positive value before window', () => {
    const ms = msUntilWindowStart(w, new Date('2026-04-20T14:30:00Z'));
    expect(ms).toBe(15 * 60 * 1000); // 15 minutes
  });

  it('msUntilWindowStart returns 0 during or after window', () => {
    expect(msUntilWindowStart(w, new Date('2026-04-20T15:00:00Z'))).toBe(0);
    expect(msUntilWindowStart(w, new Date('2026-04-20T18:00:00Z'))).toBe(0);
  });

  it('msUntilWindowEnd returns positive value during window', () => {
    const ms = msUntilWindowEnd(w, new Date('2026-04-20T16:45:00Z'));
    expect(ms).toBe(60 * 60 * 1000); // 1 hour
  });

  it('msUntilWindowEnd returns 0 after window', () => {
    expect(msUntilWindowEnd(w, new Date('2026-04-20T18:00:00Z'))).toBe(0);
  });

  it('property: msUntilWindowStart is never negative', () => {
    fc.assert(fc.property(
      fc.date({ min: new Date('2026-04-20T10:00:00Z'), max: new Date('2026-04-20T22:00:00Z') }),
      (now) => {
        expect(msUntilWindowStart(w, now)).toBeGreaterThanOrEqual(0);
      }
    ), { numRuns: 100 });
  });

  it('property: msUntilWindowEnd is never negative', () => {
    fc.assert(fc.property(
      fc.date({ min: new Date('2026-04-20T10:00:00Z'), max: new Date('2026-04-20T22:00:00Z') }),
      (now) => {
        expect(msUntilWindowEnd(w, now)).toBeGreaterThanOrEqual(0);
      }
    ), { numRuns: 100 });
  });
});
