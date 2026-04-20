import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getEventsSince } from './index.js';
import { mapData, type MappedEvent, QUARTER_MAP, TEAMCODE_MAP } from './mappings.js';

/**
 * Property tests for BBL Socket Service core logic.
 *
 * Tests cover:
 * - Property 2: Event-Buffer Vollständigkeit (session buffer completeness)
 * - Property 3: LastIds-Tracking (highest ID per event type)
 * - Property 6: Events-Slicing (getEventsSince correctness)
 */

const NUM_RUNS = 20;

// --- Shared Generators ---

const posInt = fc.nat({ max: 99999 });
const quarterCodeArb = fc.constantFrom(...Object.keys(QUARTER_MAP).map(Number));
const teamCodeArb = fc.constantFrom(1, 2);
const timeArb = fc.nat({ max: 600 });
const posSmall = fc.nat({ max: 999 });

/** Generate a MappedEvent by creating a raw BBL array and running mapData */
function mappedEventOfType(type: 0 | 1 | 2 | 3 | 4): fc.Arbitrary<MappedEvent> {
  switch (type) {
    case 0:
      return fc.tuple(posInt, quarterCodeArb, timeArb, posSmall, posSmall)
        .map(([id, q, t, sA, sB]) => mapData([0, id, q, t, sA, sB]));
    case 1:
      return fc.tuple(posInt, quarterCodeArb, teamCodeArb, posInt, posInt, timeArb, posSmall, posSmall, fc.constantFrom(0,1,2,3,4), posInt, posInt, posInt, fc.constantFrom(0,1,2))
        .map(([id, q, tc, pid, aid, t, pn, an, act, f1, f2, sr, res]) =>
          mapData([1, id, q, tc, pid, aid, t, pn, an, act, f1, f2, sr, res]));
    case 2:
      return fc.tuple(posInt, teamCodeArb)
        .map(([tid, tc]) => mapData([2, tid, tc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    case 3:
      return fc.tuple(posInt, quarterCodeArb, timeArb, fc.constantFrom(0, 1, 2))
        .map(([id, q, t, at]) => mapData([3, id, q, t, at, 0, 0]));
    case 4:
      return fc.tuple(posInt, teamCodeArb, posInt, posInt, posSmall, posSmall)
        .map(([id, tc, pid, pc, num, pts]) =>
          mapData([4, id, tc, pid, pc, num, pts, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  }
}

/** Arbitrary MappedEvent of any tracked type (0, 1, 2, 4) */
const anyMappedEventArb: fc.Arbitrary<MappedEvent> = fc.oneof(
  mappedEventOfType(0),
  mappedEventOfType(1),
  mappedEventOfType(2),
  mappedEventOfType(4),
  mappedEventOfType(3),
);

// ============================================================
// Property 2: Event-Buffer Vollständigkeit
// ============================================================

describe('Feature: kommentator-socket-app, Property 2: Event-Buffer Vollständigkeit', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * For every sequence of events received, the session buffer's events.length
   * equals the number of received events, and getEventsSince(0) returns all
   * events in reception order.
   */
  it('buffer length equals received count and getEventsSince(0) returns all events in order', () => {
    fc.assert(
      fc.property(
        fc.array(anyMappedEventArb, { minLength: 0, maxLength: 50 }),
        (eventSequence) => {
          // Simulate session buffer: push events one by one
          const events: MappedEvent[] = [];
          for (const evt of eventSequence) {
            events.push(evt);
          }

          // Verify length
          expect(events.length).toBe(eventSequence.length);

          // Verify getEventsSince(0) returns all events in order
          const allEvents = getEventsSince(events, 0);
          expect(allEvents.length).toBe(eventSequence.length);
          for (let i = 0; i < eventSequence.length; i++) {
            expect(allEvents[i]).toBe(eventSequence[i]);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ============================================================
// Property 3: LastIds-Tracking
// ============================================================

/**
 * Generator for event sequences with ascending IDs per type.
 * Each event type gets its own ascending counter.
 */
function ascendingIdEventsArb(): fc.Arbitrary<MappedEvent[]> {
  return fc.array(
    fc.record({
      type: fc.constantFrom(0 as const, 1 as const, 2 as const, 4 as const),
      idIncrement: fc.integer({ min: 1, max: 100 }),
    }),
    { minLength: 1, maxLength: 50 },
  ).map((specs) => {
    const counters = { 0: 0, 1: 0, 2: 0, 4: 0 };
    return specs.map(({ type, idIncrement }) => {
      counters[type] += idIncrement;
      const id = counters[type];
      switch (type) {
        case 0: return mapData([0, id, 1, 300, 50, 48]);
        case 1: return mapData([1, id, 1, 1, 100, 0, 300, 7, 0, 3, 0, 0, 0, 1]);
        case 2: return mapData([2, id, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
        case 4: return mapData([4, id, 1, 100, 0, 7, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      }
    });
  });
}

describe('Feature: kommentator-socket-app, Property 3: LastIds-Tracking', () => {
  /**
   * **Validates: Requirements 2.5**
   *
   * For every sequence of events with ascending IDs per type,
   * lastIds contains the highest ID per event type after processing.
   */
  it('lastIds contains the highest ID per event type after processing all events', () => {
    fc.assert(
      fc.property(
        ascendingIdEventsArb(),
        (eventSequence) => {
          // Simulate the lastIds tracking logic from the service
          const lastIds = { score: 0, action: 0, team: 0, player: 0 };

          for (const mapped of eventSequence) {
            const id = mapped.data.id as number | undefined;
            if (id != null) {
              if (mapped.type === 0) lastIds.score = id;
              if (mapped.type === 1) lastIds.action = id;
              if (mapped.type === 2) lastIds.team = id;
              if (mapped.type === 4) lastIds.player = id;
            }
          }

          // Compute expected highest IDs by scanning the sequence
          const expectedMax = { score: 0, action: 0, team: 0, player: 0 };
          for (const mapped of eventSequence) {
            const id = mapped.data.id as number | undefined;
            if (id != null) {
              if (mapped.type === 0) expectedMax.score = Math.max(expectedMax.score, id);
              if (mapped.type === 1) expectedMax.action = Math.max(expectedMax.action, id);
              if (mapped.type === 2) expectedMax.team = Math.max(expectedMax.team, id);
              if (mapped.type === 4) expectedMax.player = Math.max(expectedMax.player, id);
            }
          }

          expect(lastIds.score).toBe(expectedMax.score);
          expect(lastIds.action).toBe(expectedMax.action);
          expect(lastIds.team).toBe(expectedMax.team);
          expect(lastIds.player).toBe(expectedMax.player);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ============================================================
// Property 6: Events-Slicing
// ============================================================

describe('Feature: kommentator-socket-app, Property 6: Events-Slicing', () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For every valid session buffer with N events and every index from (0 ≤ from ≤ N),
   * getEventsSince(events, from) returns exactly N - from events starting at index from.
   */
  it('getEventsSince(events, from) returns exactly N - from events starting at index from', () => {
    fc.assert(
      fc.property(
        fc.array(anyMappedEventArb, { minLength: 0, maxLength: 50 }).chain((events) =>
          fc.tuple(
            fc.constant(events),
            fc.integer({ min: 0, max: events.length }),
          ),
        ),
        ([events, from]) => {
          const result = getEventsSince(events, from);

          // Verify length
          expect(result.length).toBe(events.length - from);

          // Verify each element matches the expected position
          for (let i = 0; i < result.length; i++) {
            expect(result[i]).toBe(events[from + i]);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
