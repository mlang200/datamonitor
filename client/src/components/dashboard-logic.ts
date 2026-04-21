/**
 * Pure functions and types for the BblSocketDashboard.
 * Extracted into a separate module so property tests can import them
 * without pulling in React or browser-dependent code.
 */

// Inline type to avoid import chain issues in tests
export interface BblMappedEvent {
  type: number;
  typeName: string;
  data: Record<string, unknown>;
  raw: unknown[];
}

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface RosterPlayer {
  id: number;
  firstName: string;
  lastName: string;
  playerId: number;
  NUM: string;
}

interface GameInfoTeam {
  id: number;
  name: string;
  shortname?: string;
  short?: string;
  TLC: string;
  roster: RosterPlayer[];
}

export interface PlayerStats {
  playerId: number;
  firstName: string;
  lastName: string;
  number: string;
  teamCode: string;
  pts: number;
  twoPM: number; twoPA: number;
  threePM: number; threePA: number;
  fgm: number; fga: number;
  ftm: number; fta: number;
  oreb: number; dreb: number; reb: number;
  ast: number; stl: number; tov: number; bl: number;
  foul: number; eff: number; pm: number; sp: number;
}

export interface PlayEvent {
  id: number;
  quarter: string;
  clock: string;
  teamCode: string;
  playerName: string;
  playerNum: string;
  action: string;
  detail: string;
  result: string;
  scoreA: number | null;
  scoreB: number | null;
  icon: string;
  isScoring: boolean;
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

export function pct(made: number, att: number): string {
  if (att === 0) return '-';
  return `${Math.round((made / att) * 100)}%`;
}

export function shotStr(made: number, att: number): string { return `${made}/${att}`; }

export function formatClock(seconds: number | undefined | null): string {
  if (seconds == null || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════
// Pure functions
// ═══════════════════════════════════════════════

export function buildRosterMap(
  gameInfo: { homeTeam: GameInfoTeam; guestTeam: GameInfoTeam } | null
): Map<number, { firstName: string; lastName: string; num: string; teamCode: string }> {
  const map = new Map<number, { firstName: string; lastName: string; num: string; teamCode: string }>();
  if (!gameInfo) return map;
  for (const p of gameInfo.homeTeam.roster || []) {
    map.set(p.id, { firstName: p.firstName, lastName: p.lastName, num: p.NUM, teamCode: 'A' });
    map.set(p.playerId, { firstName: p.firstName, lastName: p.lastName, num: p.NUM, teamCode: 'A' });
  }
  for (const p of gameInfo.guestTeam.roster || []) {
    map.set(p.id, { firstName: p.firstName, lastName: p.lastName, num: p.NUM, teamCode: 'B' });
    map.set(p.playerId, { firstName: p.firstName, lastName: p.lastName, num: p.NUM, teamCode: 'B' });
  }
  return map;
}

export function getPlayEvents(events: BblMappedEvent[]): BblMappedEvent[] {
  let afterHistoryEnd = false;
  const result: BblMappedEvent[] = [];
  for (const ev of events) {
    if (ev.type === 20) { afterHistoryEnd = true; continue; }
    if (afterHistoryEnd && ev.type === 1) {
      result.push(ev);
    }
  }
  return result;
}

export function getLeaders(
  players: PlayerStats[]
): { pts: PlayerStats | null; reb: PlayerStats | null; ast: PlayerStats | null; stl: PlayerStats | null; bl: PlayerStats | null } {
  if (players.length === 0) return { pts: null, reb: null, ast: null, stl: null, bl: null };
  const best = (f: keyof PlayerStats) =>
    players.reduce((a, b) => ((b[f] as number) > (a[f] as number) ? b : a), players[0]);
  return { pts: best('pts'), reb: best('reb'), ast: best('ast'), stl: best('stl'), bl: best('bl') };
}

export function buildStateFromEvents(
  events: BblMappedEvent[],
  rosterMap: Map<number, { firstName: string; lastName: string; num: string; teamCode: string }>
) {
  const players = new Map<number, PlayerStats>();
  let scoreA = 0, scoreB = 0;
  const deletedActionIds = new Set<number>();
  const deletedScoreIds = new Set<number>();
  let currentQuarter = '';

  const scoreAtTime = new Map<string, { a: number; b: number }>();

  // First pass: collect ALL deletions
  for (const ev of events) {
    if (ev.type === 5) deletedScoreIds.add(ev.data.scoreId as number);
    if (ev.type === 6) deletedActionIds.add(ev.data.actionId as number);
  }

  // Second pass: process scores (now all deletions are known)
  for (const ev of events) {
    if (ev.type === 0 && !deletedScoreIds.has(ev.data.id as number)) {
      const sa = Number(ev.data.scoreA);
      const sb = Number(ev.data.scoreB);
      if (!isNaN(sa) && !isNaN(sb)) {
        scoreA = sa; scoreB = sb;
        const q = ev.data.quarter;
        const id = ev.data.id as number;
        // Only set currentQuarter from real events (positive ID), not synthetic gamecenter-sync events
        if (id > 0 && typeof q === 'string' && (q.startsWith('Q') || q.startsWith('OT'))) currentQuarter = q;
        const t = Number(ev.data.time) || 0;
        scoreAtTime.set(`${q}:${t}`, { a: sa, b: sb });
      }
    }
  }

  const playEvents: PlayEvent[] = [];
  let afterHistoryEnd = false;

  for (const ev of events) {
    const d = ev.data;
    if (ev.type === 20) { afterHistoryEnd = true; continue; }

    if (ev.type === 4) {
      const pid = d.playerId as number || d.id as number;
      const roster = rosterMap.get(pid);
      const tc = String(d.teamCode || roster?.teamCode || '');
      players.set(pid, {
        playerId: pid, firstName: roster?.firstName || '', lastName: roster?.lastName || '',
        number: roster?.num || String(d.number ?? ''), teamCode: tc,
        pts: Number(d.pts) || 0, twoPM: Number(d.twoPM) || 0, twoPA: Number(d.twoPA) || 0,
        threePM: Number(d.threePM) || 0, threePA: Number(d.threePA) || 0,
        fgm: Number(d.fgm) || 0, fga: Number(d.fga) || 0, ftm: Number(d.ftm) || 0, fta: Number(d.fta) || 0,
        oreb: Number(d.oreb) || 0, dreb: Number(d.dreb) || 0, reb: Number(d.reb) || 0,
        ast: Number(d.ast) || 0, stl: Number(d.stl) || 0, tov: 0, bl: Number(d.bl) || 0,
        foul: Number(d.foul) || 0, eff: Math.round((Number(d.eff) || 0) * 100) / 100, pm: 0, sp: Number(d.sp) || 0,
      });
    }

    if (ev.type === 3) {
      const tq = d.quarter;
      if (typeof tq === 'string' && (tq.startsWith('Q') || tq.startsWith('OT'))) currentQuarter = tq;
    }

    if (ev.type === 1 && !deletedActionIds.has(d.id as number)) {
      const actionCode = String(d.action || '');
      const resultStr = String(d.result || '');
      const pid = d.playerId as number;
      const roster = rosterMap.get(pid);
      const tc = String(d.teamCode || '');
      const q = d.quarter;
      const quarter = typeof q === 'string' && (q.startsWith('Q') || q.startsWith('OT')) ? q : '';
      const time = Number(d.time) || 0;
      if (quarter) currentQuarter = quarter;
      if (!afterHistoryEnd) continue;
      const isRelevant = ['P2', 'P3', 'FT', 'FOUL', 'CFOUL', 'RFOUL', 'REB', 'TO', 'ST', 'BL', 'TIMEO', 'TTO', 'JB', 'JS', 'SUBST'].includes(actionCode);
      if (!isRelevant) continue;
      const isMade = resultStr === '+';
      const isBlocked = resultStr === 'BL';
      const isScoring = (actionCode === 'P2' || actionCode === 'P3' || actionCode === 'FT') && isMade;
      let snapA: number | null = null, snapB: number | null = null;
      const scoreSnap = scoreAtTime.get(`${quarter}:${time}`);
      if (scoreSnap) { snapA = scoreSnap.a; snapB = scoreSnap.b; }
      const assistId = d.assistPlayerId as number;
      const assistRoster = assistId && assistId > 0 ? rosterMap.get(assistId) : null;
      const assistStr = assistRoster ? ` (Ast: ${assistRoster.firstName} ${assistRoster.lastName})` : '';
      const icon = actionCode === 'P2' || actionCode === 'P3' || actionCode === 'FT'
        ? (isMade ? '🏀' : isBlocked ? '🛡' : '❌')
        : actionCode === 'FOUL' || actionCode === 'CFOUL' ? '🟨' : actionCode === 'RFOUL' ? '🟨'
        : actionCode === 'REB' ? '🔄' : actionCode === 'TO' ? '💨' : actionCode === 'ST' ? '🤏'
        : actionCode === 'BL' ? '🛡' : actionCode === 'TIMEO' || actionCode === 'TTO' ? '⏸'
        : actionCode === 'SUBST' ? '🔁' : actionCode === 'JB' ? '⬆' : actionCode === 'JS' ? '🏁' : '•';
      let detail = actionCode;
      if (actionCode === 'P2') detail = isMade ? `2PT ✓${assistStr}` : isBlocked ? '2PT blocked' : '2PT miss';
      else if (actionCode === 'P3') detail = isMade ? `3PT ✓${assistStr}` : isBlocked ? '3PT blocked' : '3PT miss';
      else if (actionCode === 'FT') detail = isMade ? 'Freiwurf ✓' : 'Freiwurf miss';
      else if (actionCode === 'FOUL' || actionCode === 'CFOUL') detail = 'Foul';
      else if (actionCode === 'RFOUL') detail = 'Foul erhalten';
      else if (actionCode === 'REB') detail = 'Rebound';
      else if (actionCode === 'TO') detail = 'Turnover';
      else if (actionCode === 'ST') detail = 'Steal';
      else if (actionCode === 'BL') detail = 'Block';
      else if (actionCode === 'TIMEO') detail = 'Timeout';
      else if (actionCode === 'TTO') detail = 'TV-Timeout';
      else if (actionCode === 'SUBST') detail = 'Einwechslung';
      else if (actionCode === 'JB') detail = 'Jump Ball';
      else if (actionCode === 'JS') detail = 'Jump Ball gewonnen';
      playEvents.push({
        id: d.id as number, quarter, clock: formatClock(time), teamCode: tc,
        playerName: roster ? `${roster.firstName} ${roster.lastName}` : pid ? `#${d.playerNum || pid}` : '',
        playerNum: roster?.num || String(d.playerNum || ''), action: actionCode, detail, result: resultStr,
        scoreA: snapA, scoreB: snapB, icon, isScoring,
      });
    }
  }

  const playersA = [...players.values()].filter(p => p.teamCode === 'A').sort((a, b) => b.pts - a.pts);
  const playersB = [...players.values()].filter(p => p.teamCode === 'B').sort((a, b) => b.pts - a.pts);
  return { playersA, playersB, scoreA, scoreB, playEvents, currentQuarter };
}

/**
 * Checks whether player statistics are ready for display.
 * Stats are considered ready when at least one player has actual game data
 * (sp > 0, meaning they have played minutes). After a reconnect with incomplete
 * history, the roster may be populated from GameInfo but all stats are zero
 * until the next player-stats event arrives.
 */
export function areStatsReady(
  playersA: PlayerStats[],
  playersB: PlayerStats[],
): boolean {
  return [...playersA, ...playersB].some(p => p.sp > 0);
}


// ═══════════════════════════════════════════════
// Live Insights
// ═══════════════════════════════════════════════

export interface LiveInsight {
  icon: string;
  headline: string;   // max 4 words
  detail: string;     // max ~12 words
}

/**
 * Generates max 3 live insights from play events and player stats.
 * Focuses on: team runs, hot players, scoring droughts, momentum shifts.
 */
export function generateInsights(
  playEvents: PlayEvent[],
  playersA: PlayerStats[],
  playersB: PlayerStats[],
  teamNameA: string,
  teamNameB: string,
): LiveInsight[] {
  const insights: LiveInsight[] = [];
  if (playEvents.length < 3) return insights;

  // --- 1. Team Runs (consecutive scoring by one team) ---
  const scoringEvents = playEvents.filter(e => e.isScoring);
  if (scoringEvents.length >= 3) {
    const recent = scoringEvents.slice(-15); // look at last 15 scoring events
    let runTeam = '';
    let runPoints = 0;
    let runCount = 0;

    // Walk backwards from the most recent scoring event
    for (let i = recent.length - 1; i >= 0; i--) {
      const ev = recent[i];
      if (runTeam === '') {
        runTeam = ev.teamCode;
        runPoints += pointsFromAction(ev);
        runCount++;
      } else if (ev.teamCode === runTeam) {
        runPoints += pointsFromAction(ev);
        runCount++;
      } else {
        break;
      }
    }

    if (runCount >= 3 && runPoints >= 6) {
      const name = runTeam === 'A' ? teamNameA : teamNameB;
      insights.push({
        icon: '🔥',
        headline: `${name}-Run!`,
        detail: `${runPoints}:0-Lauf mit ${runCount} Scores in Folge.`,
      });
    }
  }

  // --- 2. Hot Player (most points in last N events) ---
  const recentActions = playEvents.slice(-20);
  const recentScoring = recentActions.filter(e => e.isScoring);
  if (recentScoring.length >= 3) {
    const playerPoints = new Map<string, { name: string; pts: number; team: string }>();
    for (const ev of recentScoring) {
      const key = ev.playerNum + ev.teamCode;
      const existing = playerPoints.get(key);
      const pts = pointsFromAction(ev);
      if (existing) {
        existing.pts += pts;
      } else {
        const lastName = ev.playerName.split(' ').pop() || ev.playerName;
        playerPoints.set(key, { name: lastName, pts, team: ev.teamCode });
      }
    }
    const hottest = [...playerPoints.values()].sort((a, b) => b.pts - a.pts)[0];
    if (hottest && hottest.pts >= 6) {
      insights.push({
        icon: '⭐',
        headline: `${hottest.name} on Fire`,
        detail: `${hottest.pts} Punkte in den letzten ${recentScoring.length} Scores.`,
      });
    }
  }

  // --- 3. Scoring Drought (team without points for many events) ---
  if (scoringEvents.length >= 5) {
    const lastA = findLastScoringIndex(scoringEvents, 'A');
    const lastB = findLastScoringIndex(scoringEvents, 'B');
    const totalScoring = scoringEvents.length;

    const droughtA = lastA === -1 ? totalScoring : totalScoring - 1 - lastA;
    const droughtB = lastB === -1 ? totalScoring : totalScoring - 1 - lastB;

    const droughtThreshold = 4; // opponent scored 4+ times without answer
    if (droughtA >= droughtThreshold && droughtA > droughtB) {
      insights.push({
        icon: '🧊',
        headline: `${teamNameA} kalt`,
        detail: `Seit ${droughtA} gegnerischen Scores ohne eigene Punkte.`,
      });
    } else if (droughtB >= droughtThreshold && droughtB > droughtA) {
      insights.push({
        icon: '🧊',
        headline: `${teamNameB} kalt`,
        detail: `Seit ${droughtB} gegnerischen Scores ohne eigene Punkte.`,
      });
    }
  }

  return insights.slice(0, 3);
}

function pointsFromAction(ev: PlayEvent): number {
  if (!ev.isScoring) return 0;
  if (ev.action === 'P3') return 3;
  if (ev.action === 'FT') return 1;
  return 2; // P2
}

function findLastScoringIndex(scoringEvents: PlayEvent[], teamCode: string): number {
  for (let i = scoringEvents.length - 1; i >= 0; i--) {
    if (scoringEvents[i].teamCode === teamCode) return i;
  }
  return -1;
}
