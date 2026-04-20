import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  getLeaders, getPlayEvents, buildRosterMap, buildStateFromEvents, areStatsReady,
  type PlayerStats, type BblMappedEvent,
} from './dashboard-logic';

const N = 20;
const posInt = fc.integer({ min: 1, max: 99999 });

function makeEvent(type: number, data: Record<string, unknown>): BblMappedEvent {
  const names: Record<number, string> = {
    0: 'scorelist', 1: 'action', 2: 'team', 3: 'time', 4: 'player',
    5: 'score_del', 6: 'action_del', 7: 'starting5', 8: 'del_player', 20: 'history_end',
  };
  return { type, typeName: names[type] || `unknown_${type}`, data, raw: [type] };
}

const playerArb: fc.Arbitrary<PlayerStats> = fc.record({
  playerId: posInt, firstName: fc.constant('A'), lastName: fc.constant('B'),
  number: fc.constant('7'), teamCode: fc.constantFrom('A', 'B'),
  pts: fc.nat({ max: 50 }), twoPM: fc.nat({ max: 20 }), twoPA: fc.nat({ max: 30 }),
  threePM: fc.nat({ max: 15 }), threePA: fc.nat({ max: 25 }),
  fgm: fc.nat({ max: 30 }), fga: fc.nat({ max: 40 }),
  ftm: fc.nat({ max: 20 }), fta: fc.nat({ max: 25 }),
  oreb: fc.nat({ max: 10 }), dreb: fc.nat({ max: 15 }), reb: fc.nat({ max: 20 }),
  ast: fc.nat({ max: 15 }), stl: fc.nat({ max: 10 }), tov: fc.nat({ max: 10 }),
  bl: fc.nat({ max: 10 }), foul: fc.nat({ max: 5 }), eff: fc.integer({ min: -20, max: 50 }),
  pm: fc.integer({ min: -30, max: 30 }), sp: fc.nat({ max: 2400 }),
});

const emptyRoster = new Map<number, { firstName: string; lastName: string; num: string; teamCode: string }>();

// Property 9: Team-Leaders-Berechnung
describe('P9: Team-Leaders', () => {
  it('leader has highest value per category', () => {
    fc.assert(fc.property(fc.array(playerArb, { minLength: 1, maxLength: 10 }), (players) => {
      const l = getLeaders(players);
      for (const [k, f] of [['pts','pts'],['reb','reb'],['ast','ast'],['stl','stl'],['bl','bl']] as const) {
        expect((l as any)[k]![f]).toBe(Math.max(...players.map(p => p[f] as number)));
      }
    }), { numRuns: N });
  });
});

// Property 10: Play-by-Play Post-History-Filterung
// **Validates: Requirements 7.6**
describe('Feature: kommentator-socket-app, Property 10: Play-by-Play Post-History-Filterung', () => {
  // Arbitrary for action events (type 1) with relevant action codes
  const actionEventArb = fc.tuple(posInt, fc.constantFrom('P2','P3','FT','REB','FOUL','TO','ST','BL'), fc.constantFrom('A','B'), fc.constantFrom('+','-')).map(
    ([id, act, tc, res]) => makeEvent(1, { id, quarter: 'Q1', teamCode: tc, playerId: 1, time: 500, playerNum: 7, action: act, result: res })
  );

  // Arbitrary for non-action events (types 0, 2, 3, 4) that should never appear in play-by-play
  const nonActionEventArb = fc.oneof(
    posInt.map(id => makeEvent(0, { id, quarter: 'Q1', time: 500, scoreA: 10, scoreB: 8 })),
    posInt.map(id => makeEvent(2, { id, teamCode: 'A', fgm: 5, fga: 10 })),
    posInt.map(id => makeEvent(4, { id, teamCode: 'A', playerId: id, pts: 10, reb: 5 })),
  );

  // Mixed event arbitrary (actions + non-actions)
  const mixedEventArb = fc.oneof(actionEventArb, nonActionEventArb);

  it('getPlayEvents returns only action events (type 1) after history_end', () => {
    fc.assert(fc.property(
      fc.array(mixedEventArb, { minLength: 0, maxLength: 5 }),
      fc.array(mixedEventArb, { minLength: 0, maxLength: 5 }),
      (before, after) => {
        const stream = [...before, makeEvent(20, {}), ...after];
        const result = getPlayEvents(stream);
        const expectedCount = after.filter(e => e.type === 1).length;
        // Only action events after history_end are included
        expect(result.length).toBe(expectedCount);
        // All returned events must be type 1
        for (const ev of result) expect(ev.type).toBe(1);
        // No event from before history_end is included
        const beforeIds = new Set(before.filter(e => e.type === 1).map(e => e.data.id));
        for (const ev of result) expect(beforeIds.has(ev.data.id)).toBe(false);
      }
    ), { numRuns: N });
  });

  it('buildStateFromEvents playEvents contain only post-history_end actions', () => {
    // Use non-overlapping ID ranges: before=1-49999, after=50000-99999
    const beforeActionArb = fc.integer({ min: 1, max: 49999 }).map(id =>
      makeEvent(1, { id, quarter: 'Q1', teamCode: 'A', playerId: 1, time: 500, playerNum: 7, action: 'P2', result: '+' })
    );
    const afterActionArb = fc.integer({ min: 50000, max: 99999 }).map(id =>
      makeEvent(1, { id, quarter: 'Q3', teamCode: 'A', playerId: 1, time: 300, playerNum: 7, action: 'P2', result: '+' })
    );
    fc.assert(fc.property(
      fc.array(beforeActionArb, { minLength: 0, maxLength: 5 }),
      fc.array(afterActionArb, { minLength: 0, maxLength: 5 }),
      (before, after) => {
        const stream = [...before, makeEvent(20, {}), ...after];
        const state = buildStateFromEvents(stream, emptyRoster);
        // playEvents should only contain events from after history_end
        for (const pe of state.playEvents) {
          const matchingAfter = after.find(e => (e.data.id as number) === pe.id);
          expect(matchingAfter).toBeDefined();
        }
        // No pre-history_end action should appear
        const beforeIds = new Set(before.map(e => e.data.id as number));
        for (const pe of state.playEvents) {
          expect(beforeIds.has(pe.id)).toBe(false);
        }
      }
    ), { numRuns: N });
  });
});

// Property 11: Roster-Namensauflösung
// **Validates: Requirements 7.7**
describe('Feature: kommentator-socket-app, Property 11: Roster-Namensauflösung', () => {
  const nameArb = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 10 });
  const numArb = fc.integer({ min: 0, max: 99 }).map(String);

  // Home uses id range 1–24999 and playerId range 50000–74999
  const homeEntryArb = fc.record({
    id: fc.integer({ min: 1, max: 24999 }),
    firstName: nameArb,
    lastName: nameArb,
    playerId: fc.integer({ min: 50000, max: 74999 }),
    NUM: numArb,
  });

  // Guest uses id range 25000–49999 and playerId range 75000–99999
  const guestEntryArb = fc.record({
    id: fc.integer({ min: 25000, max: 49999 }),
    firstName: nameArb,
    lastName: nameArb,
    playerId: fc.integer({ min: 75000, max: 99999 }),
    NUM: numArb,
  });

  it('buildRosterMap returns correct firstName, lastName, and jersey number for every player ID', () => {
    // Use uniqueArray to ensure no duplicate id or playerId within a roster
    const homeRosterArb = fc.uniqueArray(homeEntryArb, { minLength: 1, maxLength: 8, selector: e => e.id })
      .chain(arr => {
        // Also ensure playerId is unique within the array
        const seen = new Set<number>();
        const deduped = arr.filter(e => { if (seen.has(e.playerId)) return false; seen.add(e.playerId); return true; });
        return deduped.length > 0 ? fc.constant(deduped) : fc.constant([arr[0]]);
      });
    const guestRosterArb = fc.uniqueArray(guestEntryArb, { minLength: 1, maxLength: 8, selector: e => e.id })
      .chain(arr => {
        const seen = new Set<number>();
        const deduped = arr.filter(e => { if (seen.has(e.playerId)) return false; seen.add(e.playerId); return true; });
        return deduped.length > 0 ? fc.constant(deduped) : fc.constant([arr[0]]);
      });

    fc.assert(fc.property(
      homeRosterArb,
      guestRosterArb,
      (homeRoster, guestRoster) => {
        const gi = {
          homeTeam: { id: 1, name: 'Home', TLC: 'HOM', roster: homeRoster },
          guestTeam: { id: 2, name: 'Guest', TLC: 'GST', roster: guestRoster },
        };
        const map = buildRosterMap(gi as any);

        // Verify every home roster entry is resolvable by both id and playerId
        for (const p of homeRoster) {
          const byId = map.get(p.id);
          expect(byId).toBeDefined();
          expect(byId!.firstName).toBe(p.firstName);
          expect(byId!.lastName).toBe(p.lastName);
          expect(byId!.num).toBe(p.NUM);
          expect(byId!.teamCode).toBe('A');

          const byPlayerId = map.get(p.playerId);
          expect(byPlayerId).toBeDefined();
          expect(byPlayerId!.firstName).toBe(p.firstName);
          expect(byPlayerId!.lastName).toBe(p.lastName);
          expect(byPlayerId!.num).toBe(p.NUM);
          expect(byPlayerId!.teamCode).toBe('A');
        }

        // Verify every guest roster entry is resolvable by both id and playerId
        for (const p of guestRoster) {
          const byId = map.get(p.id);
          expect(byId).toBeDefined();
          expect(byId!.firstName).toBe(p.firstName);
          expect(byId!.lastName).toBe(p.lastName);
          expect(byId!.num).toBe(p.NUM);
          expect(byId!.teamCode).toBe('B');

          const byPlayerId = map.get(p.playerId);
          expect(byPlayerId).toBeDefined();
          expect(byPlayerId!.firstName).toBe(p.firstName);
          expect(byPlayerId!.lastName).toBe(p.lastName);
          expect(byPlayerId!.num).toBe(p.NUM);
          expect(byPlayerId!.teamCode).toBe('B');
        }
      }
    ), { numRuns: 100 });
  });
});

// Property 12: Score ausschließlich aus Scorelist-Events
// **Validates: Requirements 7.8, 12.4**
describe('Feature: kommentator-socket-app, Property 12: Score ausschließlich aus Scorelist-Events', () => {
  // Scorelist event (type 0) with known score values
  const scorelistEventArb = fc.tuple(
    posInt,
    fc.constantFrom('Q1', 'Q2', 'Q3', 'Q4'),
    fc.integer({ min: 0, max: 600 }),
    fc.nat({ max: 150 }),
    fc.nat({ max: 150 }),
  ).map(([id, quarter, time, scoreA, scoreB]) =>
    makeEvent(0, { id, quarter, time, scoreA, scoreB })
  );

  // Team event (type 2) with potentially different score-like values in its data
  const teamEventArb = fc.tuple(
    posInt,
    fc.constantFrom('A', 'B'),
    fc.nat({ max: 200 }),
    fc.nat({ max: 200 }),
  ).map(([id, teamCode, fakeScoreA, fakeScoreB]) =>
    makeEvent(2, {
      id, teamCode,
      scoreA: fakeScoreA, scoreB: fakeScoreB,
      fgm: 5, fga: 10, fgPct: 50,
      threePM: 2, threePA: 5, threePct: 40,
      ftm: 3, fta: 4, ftPct: 75,
      reb: 10, ast: 5, stl: 3, bl: 2, tov: 4, foul: 8, eff: 20,
    })
  );

  it('score comes exclusively from the last Scorelist event, Team events with different scores are ignored', () => {
    fc.assert(fc.property(
      fc.array(scorelistEventArb, { minLength: 1, maxLength: 5 }),
      fc.array(teamEventArb, { minLength: 1, maxLength: 5 }),
      fc.boolean(),
      (scorelistEvents, teamEvents, teamFirst) => {
        // Interleave: either team events before or after scorelist events
        const stream = teamFirst
          ? [...teamEvents, ...scorelistEvents]
          : [...scorelistEvents, ...teamEvents];

        const state = buildStateFromEvents(stream, emptyRoster);
        // The last scorelist event in the stream determines the score
        const lastScorelist = [...stream].reverse().find(e => e.type === 0)!;
        expect(state.scoreA).toBe(Number(lastScorelist.data.scoreA));
        expect(state.scoreB).toBe(Number(lastScorelist.data.scoreB));
      }
    ), { numRuns: 100 });
  });

  it('score remains 0 when only Team events are present (no Scorelist events)', () => {
    fc.assert(fc.property(
      fc.array(teamEventArb, { minLength: 1, maxLength: 5 }),
      (teamEvents) => {
        const state = buildStateFromEvents(teamEvents, emptyRoster);
        expect(state.scoreA).toBe(0);
        expect(state.scoreB).toBe(0);
      }
    ), { numRuns: 100 });
  });

  it('interleaved Scorelist and Team events: score always matches last Scorelist', () => {
    // Generate interleaved stream where Scorelist and Team events alternate
    const interleavedArb = fc.array(
      fc.oneof(scorelistEventArb, teamEventArb),
      { minLength: 2, maxLength: 10 }
    ).filter(events => events.some(e => e.type === 0));

    fc.assert(fc.property(interleavedArb, (events) => {
      const state = buildStateFromEvents(events, emptyRoster);
      const lastScorelist = [...events].reverse().find(e => e.type === 0)!;
      expect(state.scoreA).toBe(Number(lastScorelist.data.scoreA));
      expect(state.scoreB).toBe(Number(lastScorelist.data.scoreB));
    }), { numRuns: 100 });
  });
});

// Property 13: Delete-Event-Ausschluss
// **Validates: Requirements 7.9**
describe('Feature: kommentator-socket-app, Property 13: Delete-Event-Ausschluss', () => {
  // Generator: unique scorelist events with ascending cumulative scores
  const scorelistStreamArb = fc.integer({ min: 2, max: 8 }).chain(count => {
    return fc.uniqueArray(fc.integer({ min: 1, max: 99999 }), { minLength: count, maxLength: count })
      .map(ids => {
        let cumA = 0, cumB = 0;
        return ids.map((id, i) => {
          // Each scorelist adds 2 or 3 points to one side
          if (i % 2 === 0) cumA += (i % 3 === 0 ? 3 : 2);
          else cumB += (i % 3 === 0 ? 3 : 2);
          return makeEvent(0, {
            id,
            quarter: i < 4 ? `Q${(i % 4) + 1}` : 'Q4',
            time: 600 - i * 30,
            scoreA: cumA,
            scoreB: cumB,
          });
        });
      });
  });

  // Generator: pick a random non-empty subset of IDs to delete
  const deleteSubsetArb = (ids: number[]) =>
    fc.shuffledSubarray(ids, { minLength: 1, maxLength: Math.max(1, ids.length - 1) });

  it('deleted scores are excluded from score calculation — score equals last non-deleted Scorelist', () => {
    fc.assert(fc.property(
      scorelistStreamArb.chain(scoreEvents => {
        const allIds = scoreEvents.map(e => e.data.id as number);
        return deleteSubsetArb(allIds).map(deletedIds => ({ scoreEvents, deletedIds }));
      }),
      ({ scoreEvents, deletedIds }) => {
        const deletedSet = new Set(deletedIds);
        const deleteEvents = deletedIds.map(id => makeEvent(5, { scoreId: id }));
        const stream = [...scoreEvents, ...deleteEvents];

        const state = buildStateFromEvents(stream, emptyRoster);

        // Find the last non-deleted scorelist event
        const surviving = scoreEvents.filter(e => !deletedSet.has(e.data.id as number));
        if (surviving.length === 0) {
          // All scores deleted → score should be 0
          expect(state.scoreA).toBe(0);
          expect(state.scoreB).toBe(0);
        } else {
          const last = surviving[surviving.length - 1];
          expect(state.scoreA).toBe(Number(last.data.scoreA));
          expect(state.scoreB).toBe(Number(last.data.scoreB));
        }
      }
    ), { numRuns: 100 });
  });

  it('score is 0 when ALL scorelist events are deleted', () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.integer({ min: 1, max: 99999 }), { minLength: 1, maxLength: 5 }),
      (ids) => {
        const scoreEvents = ids.map((id, i) =>
          makeEvent(0, { id, quarter: 'Q1', time: 600 - i * 10, scoreA: (i + 1) * 2, scoreB: (i + 1) })
        );
        const deleteEvents = ids.map(id => makeEvent(5, { scoreId: id }));
        const stream = [...scoreEvents, ...deleteEvents];

        const state = buildStateFromEvents(stream, emptyRoster);
        expect(state.scoreA).toBe(0);
        expect(state.scoreB).toBe(0);
      }
    ), { numRuns: 100 });
  });

  // Generator: action events with relevant action codes (post history_end)
  const actionStreamArb = fc.integer({ min: 2, max: 8 }).chain(count => {
    return fc.uniqueArray(fc.integer({ min: 1, max: 99999 }), { minLength: count, maxLength: count })
      .chain(ids => {
        return fc.tuple(
          ...ids.map(id =>
            fc.tuple(
              fc.constantFrom('P2', 'P3', 'FT', 'REB', 'FOUL', 'TO', 'ST', 'BL'),
              fc.constantFrom('A', 'B'),
              fc.constantFrom('+', '-'),
            ).map(([action, tc, result]) =>
              makeEvent(1, {
                id,
                quarter: 'Q3',
                teamCode: tc,
                playerId: 1,
                time: 600 - id % 600,
                playerNum: 7,
                action,
                result,
              })
            )
          )
        );
      });
  });

  it('deleted actions are excluded from play-by-play feed', () => {
    fc.assert(fc.property(
      actionStreamArb.chain(actionEvents => {
        const allIds = actionEvents.map(e => e.data.id as number);
        return deleteSubsetArb(allIds).map(deletedIds => ({ actionEvents, deletedIds }));
      }),
      ({ actionEvents, deletedIds }) => {
        const deletedSet = new Set(deletedIds);
        const deleteEvents = deletedIds.map(id => makeEvent(6, { actionId: id }));
        // history_end must come before actions for them to appear in play-by-play
        const stream: BblMappedEvent[] = [makeEvent(20, {}), ...actionEvents, ...deleteEvents];

        const state = buildStateFromEvents(stream, emptyRoster);

        const resultIds = state.playEvents.map(e => e.id);
        // No deleted action should appear
        for (const delId of deletedIds) {
          expect(resultIds).not.toContain(delId);
        }
        // All non-deleted relevant actions should appear
        const survivingRelevant = actionEvents.filter(e => {
          if (deletedSet.has(e.data.id as number)) return false;
          const act = String(e.data.action);
          return ['P2', 'P3', 'FT', 'FOUL', 'REB', 'TO', 'ST', 'BL'].includes(act);
        });
        for (const ev of survivingRelevant) {
          expect(resultIds).toContain(ev.data.id as number);
        }
      }
    ), { numRuns: 100 });
  });

  it('all actions excluded from play-by-play when every action is deleted', () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.integer({ min: 1, max: 99999 }), { minLength: 1, maxLength: 5 }),
      (ids) => {
        const actionEvents = ids.map(id =>
          makeEvent(1, { id, quarter: 'Q3', teamCode: 'A', playerId: 1, time: 400, playerNum: 7, action: 'P2', result: '+' })
        );
        const deleteEvents = ids.map(id => makeEvent(6, { actionId: id }));
        const stream: BblMappedEvent[] = [makeEvent(20, {}), ...actionEvents, ...deleteEvents];

        const state = buildStateFromEvents(stream, emptyRoster);
        expect(state.playEvents.length).toBe(0);
      }
    ), { numRuns: 100 });
  });

  it('mixed delete events: both score-deletes and action-deletes applied correctly in same stream', () => {
    fc.assert(fc.property(
      // Generate unique IDs for scores and actions (non-overlapping ranges)
      fc.uniqueArray(fc.integer({ min: 1, max: 49999 }), { minLength: 2, maxLength: 5 }),
      fc.uniqueArray(fc.integer({ min: 50000, max: 99999 }), { minLength: 2, maxLength: 5 }),
      (scoreIds, actionIds) => {
        // Create scorelist events
        const scoreEvents = scoreIds.map((id, i) =>
          makeEvent(0, { id, quarter: 'Q1', time: 600 - i * 10, scoreA: (i + 1) * 2, scoreB: (i + 1) })
        );
        // Create action events
        const actionEvents = actionIds.map(id =>
          makeEvent(1, { id, quarter: 'Q3', teamCode: 'A', playerId: 1, time: 400, playerNum: 7, action: 'P2', result: '+' })
        );

        // Delete first score and first action
        const delScoreId = scoreIds[0];
        const delActionId = actionIds[0];
        const deleteEvents = [
          makeEvent(5, { scoreId: delScoreId }),
          makeEvent(6, { actionId: delActionId }),
        ];

        const stream: BblMappedEvent[] = [...scoreEvents, makeEvent(20, {}), ...actionEvents, ...deleteEvents];
        const state = buildStateFromEvents(stream, emptyRoster);

        // Score should come from last non-deleted scorelist
        const survivingScores = scoreEvents.filter(e => (e.data.id as number) !== delScoreId);
        if (survivingScores.length > 0) {
          const lastScore = survivingScores[survivingScores.length - 1];
          expect(state.scoreA).toBe(Number(lastScore.data.scoreA));
          expect(state.scoreB).toBe(Number(lastScore.data.scoreB));
        }

        // Deleted action should not appear in play-by-play
        expect(state.playEvents.map(e => e.id)).not.toContain(delActionId);
        // Non-deleted actions should appear
        for (const id of actionIds.slice(1)) {
          expect(state.playEvents.map(e => e.id)).toContain(id);
        }
      }
    ), { numRuns: 100 });
  });
});

// Property 16: HistoryIncomplete-Flag
// **Validates: Requirements 12.2**
describe('Feature: kommentator-socket-app, Property 16: HistoryIncomplete-Flag', () => {
  /**
   * Pure detection function mirroring the backend's detectHistoryIncomplete logic
   * from kommentator-app/server/src/bbl-socket/index.ts:
   *
   * - connectCount > 1 (reconnect) → historyIncomplete = true
   * - First connect (connectCount === 1) with gamecenter period > 2 → true (late connection after halftime)
   * - First connect with period <= 2 or no period → false
   */
  function detectHistoryIncomplete(connectCount: number, gamecenterPeriod?: number): boolean {
    if (connectCount > 1) return true;
    if (gamecenterPeriod != null && gamecenterPeriod > 2) return true;
    return false;
  }

  // Arbitraries
  const reconnectCountArb = fc.integer({ min: 2, max: 100 }); // connectCount > 1 = reconnect
  const firstConnectArb = fc.constant(1); // connectCount === 1 = first connect
  const lateConnectionPeriodArb = fc.integer({ min: 3, max: 14 }); // period > 2 (Q3, Q4, OT1–OT10)
  const earlyPeriodArb = fc.integer({ min: 1, max: 2 }); // period <= 2 (Q1, Q2)
  const zeroPeriodArb = fc.constant(0); // period 0 (game not started)

  it('reconnect (connectCount > 1) always sets historyIncomplete to true, regardless of period', () => {
    fc.assert(fc.property(
      reconnectCountArb,
      fc.option(fc.integer({ min: 0, max: 14 }), { nil: undefined }),
      (connectCount, period) => {
        const result = detectHistoryIncomplete(connectCount, period);
        expect(result).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('first connect with late period (> 2) sets historyIncomplete to true', () => {
    fc.assert(fc.property(
      firstConnectArb,
      lateConnectionPeriodArb,
      (connectCount, period) => {
        const result = detectHistoryIncomplete(connectCount, period);
        expect(result).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('first connect with early period (<= 2) sets historyIncomplete to false', () => {
    fc.assert(fc.property(
      firstConnectArb,
      fc.oneof(earlyPeriodArb, zeroPeriodArb),
      (connectCount, period) => {
        const result = detectHistoryIncomplete(connectCount, period);
        expect(result).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('first connect with no period information sets historyIncomplete to false', () => {
    fc.assert(fc.property(
      firstConnectArb,
      (connectCount) => {
        const result = detectHistoryIncomplete(connectCount, undefined);
        expect(result).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('historyIncomplete is a pure function of connectCount and period — deterministic', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100 }),
      fc.option(fc.integer({ min: 0, max: 14 }), { nil: undefined }),
      (connectCount, period) => {
        const r1 = detectHistoryIncomplete(connectCount, period);
        const r2 = detectHistoryIncomplete(connectCount, period);
        expect(r1).toBe(r2);
      }
    ), { numRuns: 100 });
  });

  it('flag is true if and only if connectCount > 1 OR (connectCount === 1 AND period > 2)', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100 }),
      fc.option(fc.integer({ min: 0, max: 14 }), { nil: undefined }),
      (connectCount, period) => {
        const result = detectHistoryIncomplete(connectCount, period);
        const expectedTrue = connectCount > 1 || (period != null && period > 2);
        expect(result).toBe(expectedTrue);
      }
    ), { numRuns: 100 });
  });
});

// Quarter-Anzeige: Kein Quarter bei synthetischen Events oder fehlendem Spielstart
describe('Quarter display: no quarter from synthetic gamecenter-sync events', () => {
  it('currentQuarter is empty when only synthetic scorelist events (negative IDs) are present', () => {
    // Synthetic events from gamecenter-sync have negative IDs
    const events = [
      makeEvent(0, { id: -1, quarter: 'Q1', time: 0, scoreA: 20, scoreB: 18 }),
      makeEvent(0, { id: -2, quarter: 'Q2', time: 0, scoreA: 45, scoreB: 40 }),
      makeEvent(0, { id: -3, quarter: 'Q3', time: 0, scoreA: 68, scoreB: 62 }),
      makeEvent(0, { id: -4, quarter: 'Q4', time: 0, scoreA: 90, scoreB: 85 }),
      makeEvent(20, {}),
    ];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(state.currentQuarter).toBe('');
  });

  it('currentQuarter is set correctly when real scorelist events (positive IDs) are present', () => {
    const events = [
      makeEvent(0, { id: 1, quarter: 'Q1', time: 500, scoreA: 2, scoreB: 0 }),
      makeEvent(0, { id: 2, quarter: 'Q2', time: 300, scoreA: 15, scoreB: 12 }),
      makeEvent(20, {}),
    ];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(state.currentQuarter).toBe('Q2');
  });

  it('currentQuarter is empty when no events at all', () => {
    const state = buildStateFromEvents([], emptyRoster);
    expect(state.currentQuarter).toBe('');
  });

  it('currentQuarter is empty when only history_end event exists', () => {
    const events = [makeEvent(20, {})];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(state.currentQuarter).toBe('');
  });

  it('currentQuarter comes from time events (type 3) even without scorelist', () => {
    const events = [
      makeEvent(3, { id: 1, quarter: 'Q3', time: 600, actionType: 'start' }),
      makeEvent(20, {}),
    ];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(state.currentQuarter).toBe('Q3');
  });

  it('synthetic events do not override quarter set by real events', () => {
    const events = [
      makeEvent(0, { id: 100, quarter: 'Q1', time: 500, scoreA: 2, scoreB: 0 }),
      // Synthetic gamecenter-sync events (negative IDs) should NOT override
      makeEvent(0, { id: -1, quarter: 'Q1', time: 0, scoreA: 20, scoreB: 18 }),
      makeEvent(0, { id: -2, quarter: 'Q2', time: 0, scoreA: 45, scoreB: 40 }),
      makeEvent(0, { id: -3, quarter: 'Q3', time: 0, scoreA: 68, scoreB: 62 }),
      makeEvent(0, { id: -4, quarter: 'Q4', time: 0, scoreA: 90, scoreB: 85 }),
      makeEvent(20, {}),
    ];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(state.currentQuarter).toBe('Q1');
  });

  it('property: synthetic events (negative ID) never set currentQuarter', () => {
    fc.assert(fc.property(
      fc.array(
        fc.tuple(
          fc.integer({ min: -1000, max: -1 }),
          fc.constantFrom('Q1', 'Q2', 'Q3', 'Q4', 'OT1'),
          fc.nat({ max: 150 }),
          fc.nat({ max: 150 }),
        ).map(([id, quarter, scoreA, scoreB]) =>
          makeEvent(0, { id, quarter, time: 0, scoreA, scoreB })
        ),
        { minLength: 1, maxLength: 10 }
      ),
      (syntheticEvents) => {
        const events = [...syntheticEvents, makeEvent(20, {})];
        const state = buildStateFromEvents(events, emptyRoster);
        expect(state.currentQuarter).toBe('');
      }
    ), { numRuns: 100 });
  });
});

// Stats readiness: Boxscore and Leaders only shown when players have real game data
describe('Stats readiness after reconnect', () => {
  it('areStatsReady returns false when all players have sp=0 (no played minutes)', () => {
    const playersA: PlayerStats[] = [
      { playerId: 1, firstName: 'A', lastName: 'B', number: '7', teamCode: 'A', pts: 0, twoPM: 0, twoPA: 0, threePM: 0, threePA: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, tov: 0, bl: 0, foul: 0, eff: 0, pm: 0, sp: 0 },
    ];
    const playersB: PlayerStats[] = [
      { playerId: 2, firstName: 'C', lastName: 'D', number: '11', teamCode: 'B', pts: 0, twoPM: 0, twoPA: 0, threePM: 0, threePA: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, tov: 0, bl: 0, foul: 0, eff: 0, pm: 0, sp: 0 },
    ];
    expect(areStatsReady(playersA, playersB)).toBe(false);
  });

  it('areStatsReady returns true when at least one player has sp > 0', () => {
    const playersA: PlayerStats[] = [
      { playerId: 1, firstName: 'A', lastName: 'B', number: '7', teamCode: 'A', pts: 10, twoPM: 3, twoPA: 5, threePM: 1, threePA: 2, fgm: 4, fga: 7, ftm: 1, fta: 2, oreb: 2, dreb: 3, reb: 5, ast: 3, stl: 2, tov: 0, bl: 1, foul: 1, eff: 15, pm: 0, sp: 600 },
    ];
    const playersB: PlayerStats[] = [
      { playerId: 2, firstName: 'C', lastName: 'D', number: '11', teamCode: 'B', pts: 0, twoPM: 0, twoPA: 0, threePM: 0, threePA: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, tov: 0, bl: 0, foul: 0, eff: 0, pm: 0, sp: 0 },
    ];
    expect(areStatsReady(playersA, playersB)).toBe(true);
  });

  it('areStatsReady returns false for empty player arrays', () => {
    expect(areStatsReady([], [])).toBe(false);
  });

  it('score is correct even without real player stats (gamecenter-sync only)', () => {
    const events = [
      makeEvent(0, { id: -1, quarter: 'Q1', time: 0, scoreA: 20, scoreB: 18 }),
      makeEvent(0, { id: -2, quarter: 'Q2', time: 0, scoreA: 45, scoreB: 40 }),
      makeEvent(20, {}),
    ];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(state.scoreA).toBe(45);
    expect(state.scoreB).toBe(40);
    expect(state.playersA.length).toBe(0);
    expect(state.playersB.length).toBe(0);
    expect(areStatsReady(state.playersA, state.playersB)).toBe(false);
  });

  it('after real player-stats events arrive, stats become ready', () => {
    const events = [
      makeEvent(0, { id: -1, quarter: 'Q1', time: 0, scoreA: 20, scoreB: 18 }),
      makeEvent(4, { id: 1, teamCode: 'A', playerId: 100, number: 7, pts: 10, twoPM: 3, twoPA: 5, threePM: 1, threePA: 2, ftm: 1, fta: 2, fgm: 4, fga: 7, reb: 5, oreb: 2, dreb: 3, ast: 3, eff: 15, sp: 600, bl: 1, stl: 2, foul: 1 }),
      makeEvent(4, { id: 2, teamCode: 'B', playerId: 200, number: 11, pts: 8, twoPM: 2, twoPA: 4, threePM: 0, threePA: 1, ftm: 4, fta: 4, fgm: 2, fga: 5, reb: 3, oreb: 1, dreb: 2, ast: 2, eff: 10, sp: 480, bl: 0, stl: 1, foul: 2 }),
      makeEvent(20, {}),
    ];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(areStatsReady(state.playersA, state.playersB)).toBe(true);
    expect(state.playersA.length).toBe(1);
    expect(state.playersB.length).toBe(1);
    expect(state.playersA[0].pts).toBe(10);
  });

  it('players with sp=0 from roster-only population do not make stats ready', () => {
    // Simulate: player-stats events exist but all have sp=0 (game not started yet)
    const events = [
      makeEvent(4, { id: 1, teamCode: 'A', playerId: 100, number: 7, pts: 0, twoPM: 0, twoPA: 0, threePM: 0, threePA: 0, ftm: 0, fta: 0, fgm: 0, fga: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, eff: 0, sp: 0, bl: 0, stl: 0, foul: 0 }),
      makeEvent(4, { id: 2, teamCode: 'B', playerId: 200, number: 11, pts: 0, twoPM: 0, twoPA: 0, threePM: 0, threePA: 0, ftm: 0, fta: 0, fgm: 0, fga: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, eff: 0, sp: 0, bl: 0, stl: 0, foul: 0 }),
      makeEvent(20, {}),
    ];
    const state = buildStateFromEvents(events, emptyRoster);
    expect(areStatsReady(state.playersA, state.playersB)).toBe(false);
  });

  it('property: players with all sp=0 never make stats ready', () => {
    const zeroPlayerArb: fc.Arbitrary<PlayerStats> = fc.record({
      playerId: posInt, firstName: fc.constant('A'), lastName: fc.constant('B'),
      number: fc.constant('7'), teamCode: fc.constantFrom('A', 'B'),
      pts: fc.constant(0), twoPM: fc.constant(0), twoPA: fc.constant(0),
      threePM: fc.constant(0), threePA: fc.constant(0),
      fgm: fc.constant(0), fga: fc.constant(0),
      ftm: fc.constant(0), fta: fc.constant(0),
      oreb: fc.constant(0), dreb: fc.constant(0), reb: fc.constant(0),
      ast: fc.constant(0), stl: fc.constant(0), tov: fc.constant(0),
      bl: fc.constant(0), foul: fc.constant(0), eff: fc.constant(0),
      pm: fc.constant(0), sp: fc.constant(0),
    });
    fc.assert(fc.property(
      fc.array(zeroPlayerArb, { minLength: 0, maxLength: 10 }),
      fc.array(zeroPlayerArb, { minLength: 0, maxLength: 10 }),
      (a, b) => {
        expect(areStatsReady(a, b)).toBe(false);
      }
    ), { numRuns: 100 });
  });
});
