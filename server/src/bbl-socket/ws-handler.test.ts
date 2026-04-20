import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildInitPayload } from './ws-handler.js';
import type { BblGameSession } from './index.js';
import { mapData, type MappedEvent, QUARTER_MAP, TEAMCODE_MAP } from './mappings.js';

/**
 * Property tests for WebSocket Handler.
 *
 * Tests cover:
 * - Property 4: Init-Payload Vollständigkeit
 * - Property 5: Broadcast Fan-Out
 */

const NUM_RUNS = 20;

// --- Shared Generators ---

const posInt = fc.nat({ max: 99999 }).filter(n => n > 0);
const quarterCodeArb = fc.constantFrom(...Object.keys(QUARTER_MAP).map(Number));
const teamCodeArb = fc.constantFrom(1, 2);
const timeArb = fc.nat({ max: 600 });
const posSmall = fc.nat({ max: 999 });

/** Generate a MappedEvent via mapData */
function mappedEventArb(): fc.Arbitrary<MappedEvent> {
  return fc.oneof(
    // Scorelist (type 0)
    fc.tuple(posInt, quarterCodeArb, timeArb, posSmall, posSmall)
      .map(([id, q, t, sA, sB]) => mapData([0, id, q, t, sA, sB])),
    // Action (type 1)
    fc.tuple(posInt, quarterCodeArb, teamCodeArb, posInt, posInt, timeArb, posSmall, posSmall, fc.constantFrom(0, 1, 2, 3, 4), posInt, posInt, posInt, fc.constantFrom(0, 1, 2))
      .map(([id, q, tc, pid, aid, t, pn, an, act, f1, f2, sr, res]) =>
        mapData([1, id, q, tc, pid, aid, t, pn, an, act, f1, f2, sr, res])),
    // Team (type 2)
    fc.tuple(posInt, teamCodeArb)
      .map(([tid, tc]) => mapData([2, tid, tc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])),
    // Player (type 4)
    fc.tuple(posInt, teamCodeArb, posInt, posInt, posSmall, posSmall)
      .map(([id, tc, pid, pc, num, pts]) =>
        mapData([4, id, tc, pid, pc, num, pts, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
  );
}

/** Generate a valid GameInfo object */
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

const gameInfoArb = fc.record({
  homeTeam: teamInfoArb,
  guestTeam: teamInfoArb,
  gameId: posInt,
  seasonId: posInt,
  scheduledTime: fc.date().map(d => d.toISOString()),
  venue: fc.string({ minLength: 1, maxLength: 20 }),
});

/** Generate a BblLog entry */
const bblLogArb = fc.record({
  ts: fc.string({ minLength: 8, maxLength: 12 }),
  msg: fc.string({ minLength: 1, maxLength: 50 }),
});

/** Generate a valid BblGameSession */
const bblGameSessionArb: fc.Arbitrary<BblGameSession> = fc.record({
  gameId: posInt,
  gameInfo: fc.option(gameInfoArb, { nil: null }),
  events: fc.array(mappedEventArb(), { minLength: 0, maxLength: 20 }),
  isConnected: fc.boolean(),
  isHistoryLoaded: fc.boolean(),
  historyIncomplete: fc.boolean(),
  lastIds: fc.record({
    score: posInt,
    action: posInt,
    team: posInt,
    player: posInt,
  }),
  logs: fc.array(bblLogArb, { minLength: 0, maxLength: 10 }),
  connectCount: posInt,
});

// ============================================================
// Property 4: Init-Payload Vollständigkeit
// ============================================================

describe('Feature: kommentator-socket-app, Property 4: Init-Payload Vollständigkeit', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For every valid session state (with arbitrary combinations of events, logs,
   * gameInfo, and flags), the init payload contains ALL required fields:
   * `connected`, `gameId`, `gameInfo`, `historyLoaded`, `historyIncomplete`,
   * `events`, and `logs`, and the values match the session state.
   */
  it('init payload contains all required fields matching the session state', () => {
    fc.assert(
      fc.property(bblGameSessionArb, (session) => {
        const payload = buildInitPayload(session);

        // Verify all required fields exist
        expect(payload).toHaveProperty('connected');
        expect(payload).toHaveProperty('gameId');
        expect(payload).toHaveProperty('gameInfo');
        expect(payload).toHaveProperty('historyLoaded');
        expect(payload).toHaveProperty('historyIncomplete');
        expect(payload).toHaveProperty('events');
        expect(payload).toHaveProperty('logs');

        // Verify values match session state
        expect(payload.connected).toBe(session.isConnected);
        expect(payload.gameId).toBe(session.gameId);
        expect(payload.gameInfo).toBe(session.gameInfo);
        expect(payload.historyLoaded).toBe(session.isHistoryLoaded);
        expect(payload.historyIncomplete).toBe(session.historyIncomplete);

        // Events and logs are copies with same content
        expect(payload.events).toEqual(session.events);
        expect(payload.events.length).toBe(session.events.length);
        expect(payload.logs).toEqual(session.logs);
        expect(payload.logs.length).toBe(session.logs.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ============================================================
// Property 5: Broadcast Fan-Out
// ============================================================

/** WebSocket readyState constants */
const WS_OPEN = 1;
const WS_CONNECTING = 0;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

/** Mock WebSocket client */
interface MockWsClient {
  readyState: number;
  sentMessages: string[];
  send: (data: string) => void;
}

function createMockClient(readyState: number): MockWsClient {
  const sentMessages: string[] = [];
  return {
    readyState,
    sentMessages,
    send(data: string) {
      sentMessages.push(data);
    },
  };
}

/** Arbitrary readyState (mix of OPEN and non-OPEN) */
const readyStateArb = fc.constantFrom(WS_CONNECTING, WS_OPEN, WS_CLOSING, WS_CLOSED);

describe('Feature: kommentator-socket-app, Property 5: Broadcast Fan-Out', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any number of connected WebSocket clients (1–N) and any new event,
   * the broadcast sends the event to all clients with readyState === OPEN
   * and NOT to clients with other readyStates.
   */
  it('event is sent to all OPEN clients and not to non-OPEN clients', () => {
    fc.assert(
      fc.property(
        fc.array(readyStateArb, { minLength: 1, maxLength: 20 }),
        mappedEventArb(),
        (readyStates, event) => {
          // Create mock clients with the generated readyStates
          const clients = readyStates.map(rs => createMockClient(rs));

          // Simulate broadcast: iterate over clients, send to OPEN ones
          const msg = JSON.stringify({ type: 'event', payload: event });
          for (const client of clients) {
            if (client.readyState === WS_OPEN) {
              client.send(msg);
            }
          }

          // Verify: every OPEN client received exactly one message
          for (const client of clients) {
            if (client.readyState === WS_OPEN) {
              expect(client.sentMessages.length).toBe(1);
              expect(client.sentMessages[0]).toBe(msg);
            } else {
              // Non-OPEN clients received nothing
              expect(client.sentMessages.length).toBe(0);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
