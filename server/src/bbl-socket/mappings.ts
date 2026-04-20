/**
 * BBL Socket.IO Daten-Mappings — wandelt kompakte Arrays in lesbare Objekte.
 *
 * Feld-Positionen basieren auf der tatsächlichen BBL API Datenstruktur:
 *
 * Scorelist (type 0): [0, id, quarter, time, scoreA, scoreB]
 * Action (type 1):    [1, id, quarter, teamCode, playerId, action, time, info1, info2, info3, ?, ?, result, ?, ?, ?, ?, ?]
 * Team (type 2):      [2, teamId, teamCode, FGM, FGA, FG%, 3PM, 3PA, 3P%, FTM, FTA, FT%, REB, AST, STL, BL, TOV, FOUL, EFF, EFF-G, quarter]
 * Time (type 3):      [3, id, quarter, time, actionType, ?, ?]
 * Player (type 4):    [4, id, teamCode, playerId, playCode, number, pts, 2PM, 2PA, 2P%, 3PM, 3PA, 3P%, FTM, FTA, FT%, FGM, FGA, REB, OREB, DREB, AST, EFF, EFF-G, SP, BL, STL, FOUL]
 */

export const QUARTER_MAP: Record<number, string> = {
  1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4',
  5: 'OT1', 6: 'OT2', 7: 'OT3', 8: 'OT4', 9: 'OT5',
  10: 'OT6', 11: 'OT7', 12: 'OT8', 13: 'OT9', 14: 'OT10',
};

export const TEAMCODE_MAP: Record<number, string> = { 1: 'A', 2: 'B' };

export const ACTION_MAP: Record<number, string> = {
  0: 'JB', 1: 'JS', 2: 'FT', 3: 'P2', 4: 'P3', 5: 'FOUL', 6: 'RFOUL',
  7: 'REB', 8: 'TREB', 9: 'TO', 10: 'ST', 11: 'BL', 12: 'TIMEO',
  13: 'SUBST', 14: 'CFOUL', 15: 'TTO',
};

export const INFO1_MAP: Record<number, string> = {
  0: 'D', 1: 'O', 2: 'P', 3: 'T', 4: 'U', 5: 'Q', 6: 'C', 7: 'P',
  8: '1', 9: '2', 10: '3', 11: 'LB', 12: 'BP', 13: 'OB', 14: 'TR',
  15: 'VI', 16: '5', 17: '8', 18: '24', 19: 'E',
};

export const RESULT_MAP: Record<number, string> = { 0: '-', 1: '+', 2: 'BL' };
export const ACTIONT_MAP: Record<number, string> = { 0: 'start', 1: 'end', 2: 'Game end' };

export const EVENT_TYPE_MAP: Record<number, string> = {
  0: 'scorelist', 1: 'action', 2: 'team', 3: 'time_event',
  4: 'player_stats', 5: 'scorelist_delete', 6: 'action_delete',
  7: 'starting_five', 8: 'delete_player', 20: 'history_end',
};

function lookup(map: Record<number, string>, val: unknown): string | unknown {
  if (typeof val === 'number' && val in map) return map[val];
  return val;
}

export interface MappedEvent {
  type: number;
  typeName: string;
  data: Record<string, unknown>;
  raw: unknown[];
}

export function mapData(arr: unknown[]): MappedEvent {
  const type = arr[0] as number;
  const typeName = EVENT_TYPE_MAP[type] || `unknown_${type}`;

  switch (type) {
    case 0: // scorelist: [0, id, quarter, time, scoreA, scoreB]
      return { type, typeName, raw: arr, data: {
        id: arr[1],
        quarter: lookup(QUARTER_MAP, arr[2]),
        time: arr[3],
        scoreA: arr[4],
        scoreB: arr[5],
      }};

    case 1: // action: [1, id, quarter, teamCode, playerId, assistPlayerId, time, playerNum, assistNum, actionType, ?, ?, scoreRef, result, ...]
      return { type, typeName, raw: arr, data: {
        id: arr[1],
        quarter: lookup(QUARTER_MAP, arr[2]),
        teamCode: lookup(TEAMCODE_MAP, arr[3]),
        playerId: arr[4],
        assistPlayerId: arr[5],
        time: arr[6],
        playerNum: arr[7],
        assistNum: arr[8],
        action: lookup(ACTION_MAP, arr[9]),
        actionRaw: arr[9],
        scoreRef: arr[12],
        result: lookup(RESULT_MAP, arr[13]),
      }};

    case 2: // team: [2, teamId, teamCode, FGM, FGA, FG%, 3PM, 3PA, 3P%, FTM, FTA, FT%, REB, AST, STL, BL, TOV, FOUL, EFF, EFF-G, quarter]
      return { type, typeName, raw: arr, data: {
        teamId: arr[1],
        teamCode: lookup(TEAMCODE_MAP, arr[2]),
        fgm: arr[3], fga: arr[4], fgPct: arr[5],
        threePM: arr[6], threePA: arr[7], threePct: arr[8],
        ftm: arr[9], fta: arr[10], ftPct: arr[11],
        reb: arr[12], ast: arr[13], stl: arr[14], bl: arr[15],
        tov: arr[16], foul: arr[17], eff: arr[18],
      }};

    case 3: // time_event: [3, id, quarter, time, actionType, ?, ?]
      return { type, typeName, raw: arr, data: {
        id: arr[1],
        quarter: lookup(QUARTER_MAP, arr[2]),
        time: arr[3],
        actionType: lookup(ACTIONT_MAP, arr[4]),
      }};

    case 4: // player_stats: [4, id, teamCode, playerId, playCode, number, pts, 2PM, 2PA, 2P%, 3PM, 3PA, 3P%, FTM, FTA, FT%, FGM, FGA, REB, OREB, DREB, AST, EFF, EFF-G, SP, SP2, STL, FOUL]
      // Note: arr[25] was originally mapped as BL (blocks) but BBL API actually sends
      // a second playing-time value there (rounded seconds). Blocks are not reliably
      // available at a known position in the current API version.
      return { type, typeName, raw: arr, data: {
        id: arr[1],
        teamCode: lookup(TEAMCODE_MAP, arr[2]),
        playerId: arr[3],
        playCode: arr[4],
        number: arr[5],
        pts: arr[6],
        twoPM: arr[7], twoPA: arr[8], twoPct: arr[9],
        threePM: arr[10], threePA: arr[11], threePct: arr[12],
        ftm: arr[13], fta: arr[14], ftPct: arr[15],
        fgm: arr[16], fga: arr[17],
        reb: arr[18], oreb: arr[19], dreb: arr[20],
        ast: arr[21],
        eff: arr[22],
        sp: arr[24],
        bl: 0, stl: arr[26], foul: arr[27],
      }};

    case 5: // scorelist_delete
      return { type, typeName, raw: arr, data: { scoreId: arr[1] } };
    case 6: // action_delete
      return { type, typeName, raw: arr, data: { actionId: arr[1] } };
    case 7: // starting_five
      return { type, typeName, raw: arr, data: {
        teamCode: lookup(TEAMCODE_MAP, arr[1]), playerIds: arr.slice(2),
      }};
    case 8: // delete_player
      return { type, typeName, raw: arr, data: { playerId: arr[1] } };
    case 20: // history_end
      return { type, typeName, raw: arr, data: {} };
    default:
      return { type, typeName, raw: arr, data: { values: arr.slice(1) } };
  }
}
