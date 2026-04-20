import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { processInitMessage, processEventMessage } from './useBblSocket';
import type { BblWsState, GameInfo, BblLog } from './useBblSocket';
import type { BblMappedEvent } from '../api';

/**
 * Property tests for useBblSocket pure functions.
 *
 * Tests cover:
 * - Property 14: Init-State-Synchronisation
 * - Property 15: Event-Append-Invariante
 */

const NUM_RUNS = 20;

// --- Shared Generators ---

const posInt = fc.nat({ max: 99999 }).filter(n => n > 0);

const rosterEntryArb = fc.record({
  id: posInt,
  firstName: fc.string({ minLength: 1, maxLength: 10 }),
  lastName: fc.string({ minLength: 1, maxLength: 10 }),
  playerId: posInt,
  NUM: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 2 }),
});

const teamInfoArb = fc.record({
  id: posInt,
  name: fc.string({ minLength: 1, maxLength: 20 }),
  shortname: fc.string({ minLength: 1, maxLength: 10 }),
  TLC: fc.string({ minLength: 3, maxLength: 3 }),
  roster: fc.array(rosterEntryArb, { minLength: 0, maxLength: 5 }),
});

const gameInfoArb: fc.Arbitrary<GameInfo> = fc.record({
  homeTeam: teamInfoArb,
  guestTeam: teamInfoArb,
  gameId: posInt,
  seasonId: posInt,
  scheduledTime: fc.date().map(d => d.toISOString()),
  venue: fc.string({ minLength: 1, maxLength: 20 }),
});

const bblLogArb: fc.Arbitrary<BblLog> = fc.record({
  ts: fc.string({ minLength: 8, maxLength: 12 }),
  msg: fc.string({ minLength: 1, maxLength: 50 }),
});

const bblMappedEventArb: fc.Arbitrary<BblMappedEvent> = fc.record({
  type: fc.constantFrom(0, 1, 2, 3, 4, 5, 6, 7, 8, 20),
  typeName: fc.string({ minLength: 1, maxLength: 15 }),
  data: fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.oneof(fc.integer(), fc.string({ maxLength: 10 }), fc.boolean())),
  raw: fc.array(fc.oneof(fc.integer(), fc.string({ maxLength: 10 })), { minLength: 1, maxLength: 10 }),
});

/** Generate a valid BblWsState (used as previous state) */
const bblWsStateArb: fc.Arbitrary<BblWsState> = fc.record({
  connected: fc.boolean(),
  gameId: fc.option(posInt, { nil: null }),
  gameInfo: fc.option(gameInfoArb, { nil: null }),
  events: fc.array(bblMappedEventArb, { minLength: 0, maxLength: 10 }),
  logs: fc.array(bblLogArb, { minLength: 0, maxLength: 10 }),
  historyLoaded: fc.boolean(),
  historyIncomplete: fc.boolean(),
  wsReady: fc.boolean(),
});

// ============================================================
// Property 14: Init-State-Synchronisation
// ============================================================

describe('Feature: kommentator-socket-app, Property 14: Init-State-Synchronisation', () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * For every valid init message payload, the resulting state after
   * processInitMessage exactly matches the payload values for connected,
   * gameId, gameInfo, historyLoaded, historyIncomplete, events, and logs.
   */
  it('processInitMessage synchronises state to match init payload values', () => {
    const initPayloadArb = fc.record({
      connected: fc.boolean(),
      gameId: fc.option(posInt, { nil: null }),
      gameInfo: fc.option(gameInfoArb, { nil: null }),
      historyLoaded: fc.boolean(),
      historyIncomplete: fc.boolean(),
      events: fc.array(bblMappedEventArb, { minLength: 0, maxLength: 15 }),
      logs: fc.array(bblLogArb, { minLength: 0, maxLength: 10 }),
    });

    fc.assert(
      fc.property(bblWsStateArb, initPayloadArb, (prevState, payload) => {
        const result = processInitMessage(prevState, payload);

        // Core fields must exactly match payload
        expect(result.connected).toBe(payload.connected);
        expect(result.gameId).toBe(payload.gameId);
        expect(result.gameInfo).toBe(payload.gameInfo);
        expect(result.historyLoaded).toBe(payload.historyLoaded);
        expect(result.historyIncomplete).toBe(payload.historyIncomplete);
        expect(result.events).toEqual(payload.events);

        // Logs: if payload has logs, they replace prev; otherwise prev logs are kept
        if (payload.logs && payload.logs.length > 0) {
          expect(result.logs).toEqual(payload.logs);
        } else {
          expect(result.logs).toEqual(prevState.logs);
        }

        // wsReady is preserved from previous state (not part of init payload)
        expect(result.wsReady).toBe(prevState.wsReady);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ============================================================
// Property 15: Event-Append-Invariante
// ============================================================

describe('Feature: kommentator-socket-app, Property 15: Event-Append-Invariante', () => {
  /**
   * **Validates: Requirements 8.4, 12.5**
   *
   * For any existing state with N events and any new BblMappedEvent,
   * processEventMessage produces a state with N+1 events where:
   * - The new event is at the end
   * - All previous events are preserved in order
   */
  it('processEventMessage appends new event at end, preserving existing events', () => {
    fc.assert(
      fc.property(bblWsStateArb, bblMappedEventArb, (prevState, newEvent) => {
        const N = prevState.events.length;
        const result = processEventMessage(prevState, newEvent);

        // Result has exactly N+1 events
        expect(result.events.length).toBe(N + 1);

        // New event is at the end
        expect(result.events[N]).toEqual(newEvent);

        // All previous events are preserved in order
        for (let i = 0; i < N; i++) {
          expect(result.events[i]).toEqual(prevState.events[i]);
        }

        // Other state fields are unchanged
        expect(result.connected).toBe(prevState.connected);
        expect(result.gameId).toBe(prevState.gameId);
        expect(result.gameInfo).toBe(prevState.gameInfo);
        expect(result.logs).toBe(prevState.logs);
        expect(result.historyLoaded).toBe(prevState.historyLoaded);
        expect(result.historyIncomplete).toBe(prevState.historyIncomplete);
        expect(result.wsReady).toBe(prevState.wsReady);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
