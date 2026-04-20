import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  mapData,
  QUARTER_MAP,
  TEAMCODE_MAP,
  ACTION_MAP,
  RESULT_MAP,
  ACTIONT_MAP,
  EVENT_TYPE_MAP,
  INFO1_MAP,
  type MappedEvent,
} from './mappings.js';

/**
 * Property 1: Event-Mapping Round-Trip
 *
 * For every valid BBL-API array (type 0–8, 20) with valid values at defined positions,
 * mapData(arr) produces an object whose fields correctly reflect the original array values,
 * with numeric codes translated to the corresponding strings.
 *
 * Tag: "Feature: kommentator-socket-app, Property 1: Event-Mapping Round-Trip"
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 */

// --- Generators ---

const quarterCodeArb = fc.constantFrom(...Object.keys(QUARTER_MAP).map(Number));
const teamCodeArb = fc.constantFrom(1, 2);
const actionCodeArb = fc.constantFrom(...Object.keys(ACTION_MAP).map(Number));
const resultCodeArb = fc.constantFrom(0, 1, 2);
const actionTCodeArb = fc.constantFrom(0, 1, 2);
const posInt = fc.nat({ max: 99999 });
const posSmall = fc.nat({ max: 999 });
const pctArb = fc.float({ min: 0, max: 100, noNaN: true });
const timeArb = fc.nat({ max: 600 });

// Type 0: Scorelist [0, id, quarter, time, scoreA, scoreB]
const scorelistArb = fc.tuple(quarterCodeArb, timeArb, posSmall, posSmall, posInt).map(
  ([quarter, time, scoreA, scoreB, id]) => [0, id, quarter, time, scoreA, scoreB] as unknown[]
);

// Type 1: Action [1, id, quarter, teamCode, playerId, assistPlayerId, time, playerNum, assistNum, action, ?, ?, scoreRef, result, ...]
const actionArb = fc.tuple(
  posInt, quarterCodeArb, teamCodeArb, posInt, posInt, timeArb, posSmall, posSmall, actionCodeArb, posInt, posInt, posInt, resultCodeArb,
).map(([id, quarter, teamCode, playerId, assistPlayerId, time, playerNum, assistNum, action, filler1, filler2, scoreRef, result]) =>
  [1, id, quarter, teamCode, playerId, assistPlayerId, time, playerNum, assistNum, action, filler1, filler2, scoreRef, result] as unknown[]
);

// Type 2: Team [2, teamId, teamCode, FGM, FGA, FG%, 3PM, 3PA, 3P%, FTM, FTA, FT%, REB, AST, STL, BL, TOV, FOUL, EFF, EFF-G, quarter]
const teamArb = fc.tuple(
  posInt, teamCodeArb,
  posSmall, posSmall, pctArb,
  posSmall, posSmall, pctArb,
  posSmall, posSmall, pctArb,
  posSmall, posSmall, posSmall, posSmall,
  posSmall, posSmall, fc.integer(), pctArb, quarterCodeArb,
).map(([teamId, teamCode, fgm, fga, fgPct, tpm, tpa, tpPct, ftm, fta, ftPct, reb, ast, stl, bl, tov, foul, eff, effG, quarter]) =>
  [2, teamId, teamCode, fgm, fga, fgPct, tpm, tpa, tpPct, ftm, fta, ftPct, reb, ast, stl, bl, tov, foul, eff, effG, quarter] as unknown[]
);

// Type 3: Time [3, id, quarter, time, actionType, ?, ?]
const timeEventArb = fc.tuple(posInt, quarterCodeArb, timeArb, actionTCodeArb, posInt, posInt).map(
  ([id, quarter, time, actionType, f1, f2]) => [3, id, quarter, time, actionType, f1, f2] as unknown[]
);

// Type 4: Player [4, id, teamCode, playerId, playCode, number, pts, 2PM, 2PA, 2P%, 3PM, 3PA, 3P%, FTM, FTA, FT%, FGM, FGA, REB, OREB, DREB, AST, EFF, EFF-G, SP, BL, STL, FOUL]
const playerArb = fc.tuple(
  posInt, teamCodeArb, posInt, posInt, posSmall, posSmall,
  posSmall, posSmall, pctArb,
  posSmall, posSmall, pctArb,
  posSmall, posSmall, pctArb,
  posSmall, posSmall,
  posSmall, posSmall, posSmall,
  posSmall, fc.integer(), pctArb, posSmall, posSmall, posSmall, posSmall,
).map(([id, teamCode, playerId, playCode, number, pts, twoPM, twoPA, twoPct, threePM, threePA, threePct, ftm, fta, ftPct, fgm, fga, reb, oreb, dreb, ast, eff, effG, sp, bl, stl, foul]) =>
  [4, id, teamCode, playerId, playCode, number, pts, twoPM, twoPA, twoPct, threePM, threePA, threePct, ftm, fta, ftPct, fgm, fga, reb, oreb, dreb, ast, eff, effG, sp, bl, stl, foul] as unknown[]
);

// Type 5: Scorelist delete [5, scoreId]
const scorelistDeleteArb = posInt.map((scoreId) => [5, scoreId] as unknown[]);

// Type 6: Action delete [6, actionId]
const actionDeleteArb = posInt.map((actionId) => [6, actionId] as unknown[]);

// Type 7: Starting five [7, teamCode, ...playerIds]
const startingFiveArb = fc.tuple(teamCodeArb, fc.array(posInt, { minLength: 0, maxLength: 10 })).map(
  ([teamCode, playerIds]) => [7, teamCode, ...playerIds] as unknown[]
);

// Type 8: Delete player [8, playerId]
const deletePlayerArb = posInt.map((playerId) => [8, playerId] as unknown[]);

// Type 20: History end [20]
const historyEndArb = fc.constant([20] as unknown[]);

// --- Property Tests ---

const NUM_RUNS = 20;

describe('Feature: kommentator-socket-app, Property 1: Event-Mapping Round-Trip', () => {

  it('Type 0 (scorelist): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(scorelistArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(0);
        expect(result.typeName).toBe('scorelist');
        expect(result.raw).toBe(arr);
        expect(result.data.id).toBe(arr[1]);
        expect(result.data.quarter).toBe(QUARTER_MAP[arr[2] as number]);
        expect(result.data.time).toBe(arr[3]);
        expect(result.data.scoreA).toBe(arr[4]);
        expect(result.data.scoreB).toBe(arr[5]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 1 (action): mapped fields reflect original array values with code translations', () => {
    fc.assert(
      fc.property(actionArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(1);
        expect(result.typeName).toBe('action');
        expect(result.raw).toBe(arr);
        expect(result.data.id).toBe(arr[1]);
        expect(result.data.quarter).toBe(QUARTER_MAP[arr[2] as number]);
        expect(result.data.teamCode).toBe(TEAMCODE_MAP[arr[3] as number]);
        expect(result.data.playerId).toBe(arr[4]);
        expect(result.data.assistPlayerId).toBe(arr[5]);
        expect(result.data.time).toBe(arr[6]);
        expect(result.data.playerNum).toBe(arr[7]);
        expect(result.data.assistNum).toBe(arr[8]);
        expect(result.data.action).toBe(ACTION_MAP[arr[9] as number]);
        expect(result.data.scoreRef).toBe(arr[12]);
        expect(result.data.result).toBe(RESULT_MAP[arr[13] as number]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 2 (team): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(teamArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(2);
        expect(result.typeName).toBe('team');
        expect(result.raw).toBe(arr);
        expect(result.data.teamId).toBe(arr[1]);
        expect(result.data.teamCode).toBe(TEAMCODE_MAP[arr[2] as number]);
        expect(result.data.fgm).toBe(arr[3]);
        expect(result.data.fga).toBe(arr[4]);
        expect(result.data.fgPct).toBe(arr[5]);
        expect(result.data.threePM).toBe(arr[6]);
        expect(result.data.threePA).toBe(arr[7]);
        expect(result.data.threePct).toBe(arr[8]);
        expect(result.data.ftm).toBe(arr[9]);
        expect(result.data.fta).toBe(arr[10]);
        expect(result.data.ftPct).toBe(arr[11]);
        expect(result.data.reb).toBe(arr[12]);
        expect(result.data.ast).toBe(arr[13]);
        expect(result.data.stl).toBe(arr[14]);
        expect(result.data.bl).toBe(arr[15]);
        expect(result.data.tov).toBe(arr[16]);
        expect(result.data.foul).toBe(arr[17]);
        expect(result.data.eff).toBe(arr[18]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 3 (time_event): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(timeEventArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(3);
        expect(result.typeName).toBe('time_event');
        expect(result.raw).toBe(arr);
        expect(result.data.id).toBe(arr[1]);
        expect(result.data.quarter).toBe(QUARTER_MAP[arr[2] as number]);
        expect(result.data.time).toBe(arr[3]);
        expect(result.data.actionType).toBe(ACTIONT_MAP[arr[4] as number]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 4 (player_stats): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(playerArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(4);
        expect(result.typeName).toBe('player_stats');
        expect(result.raw).toBe(arr);
        expect(result.data.id).toBe(arr[1]);
        expect(result.data.teamCode).toBe(TEAMCODE_MAP[arr[2] as number]);
        expect(result.data.playerId).toBe(arr[3]);
        expect(result.data.playCode).toBe(arr[4]);
        expect(result.data.number).toBe(arr[5]);
        expect(result.data.pts).toBe(arr[6]);
        expect(result.data.twoPM).toBe(arr[7]);
        expect(result.data.twoPA).toBe(arr[8]);
        expect(result.data.twoPct).toBe(arr[9]);
        expect(result.data.threePM).toBe(arr[10]);
        expect(result.data.threePA).toBe(arr[11]);
        expect(result.data.threePct).toBe(arr[12]);
        expect(result.data.ftm).toBe(arr[13]);
        expect(result.data.fta).toBe(arr[14]);
        expect(result.data.ftPct).toBe(arr[15]);
        expect(result.data.fgm).toBe(arr[16]);
        expect(result.data.fga).toBe(arr[17]);
        expect(result.data.reb).toBe(arr[18]);
        expect(result.data.oreb).toBe(arr[19]);
        expect(result.data.dreb).toBe(arr[20]);
        expect(result.data.ast).toBe(arr[21]);
        expect(result.data.eff).toBe(arr[22]);
        expect(result.data.sp).toBe(arr[24]);
        // bl is hardcoded to 0 because arr[25] in the BBL API contains a second
        // playing-time value, not blocks. See mappings.ts comment.
        expect(result.data.bl).toBe(0);
        expect(result.data.stl).toBe(arr[26]);
        expect(result.data.foul).toBe(arr[27]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 5 (scorelist_delete): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(scorelistDeleteArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(5);
        expect(result.typeName).toBe('scorelist_delete');
        expect(result.raw).toBe(arr);
        expect(result.data.scoreId).toBe(arr[1]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 6 (action_delete): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(actionDeleteArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(6);
        expect(result.typeName).toBe('action_delete');
        expect(result.raw).toBe(arr);
        expect(result.data.actionId).toBe(arr[1]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 7 (starting_five): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(startingFiveArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(7);
        expect(result.typeName).toBe('starting_five');
        expect(result.raw).toBe(arr);
        expect(result.data.teamCode).toBe(TEAMCODE_MAP[arr[1] as number]);
        expect(result.data.playerIds).toEqual(arr.slice(2));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 8 (delete_player): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(deletePlayerArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(8);
        expect(result.typeName).toBe('delete_player');
        expect(result.raw).toBe(arr);
        expect(result.data.playerId).toBe(arr[1]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Type 20 (history_end): mapped fields reflect original array values', () => {
    fc.assert(
      fc.property(historyEndArb, (arr) => {
        const result = mapData(arr);

        expect(result.type).toBe(20);
        expect(result.typeName).toBe('history_end');
        expect(result.raw).toBe(arr);
        expect(result.data).toEqual({});
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('All event types: type and typeName are always consistent', () => {
    const allEventsArb = fc.oneof(
      scorelistArb, actionArb, teamArb, timeEventArb, playerArb,
      scorelistDeleteArb, actionDeleteArb, startingFiveArb, deletePlayerArb, historyEndArb,
    );

    fc.assert(
      fc.property(allEventsArb, (arr) => {
        const result = mapData(arr);
        const expectedType = arr[0] as number;

        expect(result.type).toBe(expectedType);
        expect(result.typeName).toBe(EVENT_TYPE_MAP[expectedType]);
        expect(result.raw).toBe(arr);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
