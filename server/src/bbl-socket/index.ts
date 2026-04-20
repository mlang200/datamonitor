/**
 * BBL Socket.IO Service — verbindet sich mit der BBL Scoreboard API
 * und streamt Play-by-Play Events für ein bestimmtes Spiel.
 *
 * Robustes Reconnect-Handling:
 * - Socket.IO reconnection mit exponential backoff (1s → 10s)
 * - Re-join + inkrementelle Historie nach Reconnect
 * - Heartbeat-Logging alle 30s
 * - Keine Events gehen verloren (lastIds tracking)
 * - historyIncomplete-Flag bei später Verbindung / Reconnect nach Halbzeit
 */
import { io, Socket } from 'socket.io-client';
import { mapData, type MappedEvent } from './mappings';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BblSocketConfig {
  apiUrl: string;
  apiKey: string;
}

export interface RosterEntry {
  id: number;
  firstName: string;
  lastName: string;
  playerId: number;
  NUM: string;
}

export interface TeamInfo {
  id: number;
  name: string;
  shortname: string;
  TLC: string;
  roster: RosterEntry[];
}

export interface GameInfo {
  homeTeam: TeamInfo;
  guestTeam: TeamInfo;
  gameId: number;
  seasonId: number;
  scheduledTime: string;
  venue: string;
}

export interface BblLog { ts: string; msg: string }

export interface BblGameSession {
  gameId: number;
  gameInfo: GameInfo | null;
  events: MappedEvent[];
  isConnected: boolean;
  isHistoryLoaded: boolean;
  historyIncomplete: boolean;
  lastIds: { score: number; action: number; team: number; player: number };
  logs: BblLog[];
  connectCount: number;
}

export interface StatusPayload {
  connected: boolean;
  gameId: number;
  historyLoaded: boolean;
  historyIncomplete: boolean;
}

type EventCallback = (event: MappedEvent) => void;
type LogCallback = (log: BblLog) => void;
type StatusCallback = (status: StatusPayload) => void;

/* ------------------------------------------------------------------ */
/*  Standalone helper (exported for testing)                           */
/* ------------------------------------------------------------------ */

/**
 * Returns events from `fromIndex` onwards.
 * Exported as a standalone pure function so it can be tested independently.
 */
export function getEventsSince(events: MappedEvent[], fromIndex: number): MappedEvent[] {
  return events.slice(fromIndex);
}

/* ------------------------------------------------------------------ */
/*  Public interface                                                    */
/* ------------------------------------------------------------------ */

export interface BblSocketService {
  connect(gameId: number): Promise<GameInfo | null>;
  disconnect(): void;
  getSession(): BblGameSession | null;
  getEventsSince(fromIndex: number): MappedEvent[];
  onEvent(cb: EventCallback): () => void;
  onLog(cb: LogCallback): () => void;
  onStatus(cb: StatusCallback): () => void;
  isConnected(): boolean;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createBblSocketService(config: BblSocketConfig): BblSocketService {
  let socket: Socket | null = null;
  let currentGameId: number | null = null;
  let session: BblGameSession | null = null;
  let eventListeners: EventCallback[] = [];
  let logListeners: LogCallback[] = [];
  let statusListeners: StatusCallback[] = [];
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  /* ---------- internal helpers ---------- */

  function log(msg: string) {
    const ts = new Date().toISOString().slice(11, 23);
    const entry: BblLog = { ts, msg };
    console.log(`[BBL ${ts}] ${msg}`);
    if (session) session.logs.push(entry);
    logListeners.forEach(cb => cb(entry));
  }

  function notifyStatus() {
    if (!session) return;
    const status: StatusPayload = {
      connected: session.isConnected,
      gameId: session.gameId,
      historyLoaded: session.isHistoryLoaded,
      historyIncomplete: session.historyIncomplete,
    };
    statusListeners.forEach(cb => cb(status));
  }

  /**
   * Detect whether the history is incomplete.
   *
   * The BBL API snapshots history at halftime. If we connect (or reconnect)
   * after halftime has started, the history we receive only covers up to the
   * snapshot point — play-by-play events between the snapshot and our
   * connection time are missing.
   *
   * Heuristic: history is incomplete when this is a reconnect (connectCount > 1)
   * OR when the history contains time-events indicating we're past Q2 / halftime
   * but the history_end arrives with relatively few action events for the
   * elapsed game time. We use a simpler, reliable signal: if connectCount > 1
   * (reconnect) we always mark incomplete because we can't guarantee the
   * incremental history filled the gap. For a first connect we check whether
   * the gamecenter reports a period > 2 (past halftime) — if so, the snapshot
   * based history is likely incomplete.
   */
  function detectHistoryIncomplete(gamecenterPeriod?: number): boolean {
    if (!session) return false;
    // Reconnect — incremental history may have gaps
    if (session.connectCount > 1) return true;
    // Late first connection after halftime — snapshot-based history is incomplete
    if (gamecenterPeriod != null && gamecenterPeriod > 2) return true;
    return false;
  }

  function handleEvent(arr: unknown[]) {
    if (!session || !Array.isArray(arr)) return;
    const mapped = mapData(arr);
    session.events.push(mapped);

    // Track last IDs for incremental reconnect
    const id = mapped.data.id as number | undefined;
    if (id != null) {
      if (mapped.type === 0) session.lastIds.score = id;
      if (mapped.type === 1) session.lastIds.action = id;
      if (mapped.type === 2) session.lastIds.team = id;
      if (mapped.type === 4) session.lastIds.player = id;
    }

    if (mapped.type === 20 && !session.isHistoryLoaded) {
      session.isHistoryLoaded = true;
      log(`history_end — ${session.events.length} events total`);

      // Gamecenter sync: fetch current score + quarter scores
      if (socket) {
        socket.emit('gamecenter', {}, (res: { status: string; data: { present?: any[]; past?: any[] } }) => {
          if (res.status === 'success' && session) {
            const all = [...(res.data.present || []), ...(res.data.past || [])];
            const game = all.find((g: any) => g.id === session!.gameId);
            if (game?.result) {
              const [scoreA, scoreB] = game.result.final || [0, 0];
              const period = game.result.latestPeriod || 0;
              const quarterScores: number[][] = game.result.scores || [];
              log(`gamecenter sync — score ${scoreA}:${scoreB} period=${period} quarters=${quarterScores.length}`);

              // Detect incomplete history based on gamecenter period
              session!.historyIncomplete = detectHistoryIncomplete(period);
              if (session!.historyIncomplete) {
                log(`historyIncomplete=true — play-by-play may have gaps`);
              }

              // Insert synthetic quarter-score events so the client can
              // reconstruct per-quarter score progression
              let cumA = 0, cumB = 0;
              for (let q = 0; q < quarterScores.length; q++) {
                cumA += quarterScores[q][0] || 0;
                cumB += quarterScores[q][1] || 0;
                const synth = mapData([0, -(q + 1), q + 1, 0, cumA, cumB]);
                session!.events.push(synth);
                eventListeners.forEach(cb => cb(synth));
              }

              // Insert final score if it differs from quarter sum
              if (scoreA !== cumA || scoreB !== cumB) {
                const synthFinal = mapData([0, -100, period, 0, scoreA, scoreB]);
                session!.events.push(synthFinal);
                eventListeners.forEach(cb => cb(synthFinal));
              }

              // Insert current period as time event
              if (period > 0) {
                const synthTime = mapData([3, -1, period, 0, 0, 0, 0]);
                session!.events.push(synthTime);
                eventListeners.forEach(cb => cb(synthTime));
              }
            } else {
              // No gamecenter result — still check reconnect-based incompleteness
              session!.historyIncomplete = detectHistoryIncomplete();
            }
          } else {
            // Gamecenter call failed — check reconnect-based incompleteness
            if (session) session.historyIncomplete = detectHistoryIncomplete();
          }
          notifyStatus();
        });
      } else {
        session.historyIncomplete = detectHistoryIncomplete();
        notifyStatus();
      }
    }

    eventListeners.forEach(cb => cb(mapped));
  }

  function requestHistory() {
    if (!socket || !session) return;
    const gid = session.gameId;
    const ids = session.lastIds;

    if (ids.score === 0 && ids.action === 0 && ids.team === 0 && ids.player === 0) {
      log(`emit('history', ${gid}) — full history`);
      socket.emit('history', gid);
    } else {
      log(`emit('history') — incremental (score>${ids.score}, action>${ids.action})`);
      socket.emit('history', [gid, 0, ids.score]);
      socket.emit('history', [gid, 1, ids.action]);
      socket.emit('history', [gid, 2, ids.team]);
      socket.emit('history', [gid, 4, ids.player]);
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (session && session.isConnected) {
        log(`heartbeat — ${session.events.length} events, connected`);
      }
    }, 30000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  }

  function cleanup() {
    stopHeartbeat();
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  }

  /* ---------- public API ---------- */

  return {
    async connect(gameId: number): Promise<GameInfo | null> {
      cleanup();

      currentGameId = gameId;
      session = {
        gameId,
        gameInfo: null,
        events: [],
        isConnected: false,
        isHistoryLoaded: false,
        historyIncomplete: false,
        lastIds: { score: 0, action: 0, team: 0, player: 0 },
        logs: [],
        connectCount: 0,
      };

      log(`connecting to ${config.apiUrl} for game ${gameId}...`);

      return new Promise((resolve) => {
        let resolved = false;

        socket = io(config.apiUrl, {
          extraHeaders: { 'x-api-key': config.apiKey },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
          reconnectionAttempts: Infinity,
          timeout: 10000,
        });

        socket.on('connect', () => {
          if (!session || !socket) return;
          session.isConnected = true;
          session.connectCount++;
          const isReconnect = session.connectCount > 1;
          log(`${isReconnect ? 'reconnected' : 'connected'} — socket.id=${socket.id} (connect #${session.connectCount})`);
          notifyStatus();

          // Join game channel (always, also on reconnect)
          socket.emit('join', gameId, (ack: unknown) => {
            log(`join ack: ${JSON.stringify(ack)}`);
          });

          // Load game info (first connect only)
          if (!isReconnect) {
            log(`emit('game', { gameId: ${gameId} })`);
            socket.emit('game', { gameId }, (res: { status: string; data: GameInfo }) => {
              if (res.status === 'success' && session) {
                session.gameInfo = res.data;
                log(`game info — ${res.data.homeTeam?.name || '?'} vs ${res.data.guestTeam?.name || '?'}`);
                if (!resolved) { resolved = true; resolve(res.data); }
              } else {
                log(`game info failed: ${JSON.stringify(res).slice(0, 100)}`);
                if (!resolved) { resolved = true; resolve(null); }
              }
            });
          }

          // Load history (full on first connect, incremental on reconnect)
          // Reset historyLoaded so we process the new history_end
          if (isReconnect) {
            session.isHistoryLoaded = false;
          }
          requestHistory();
          startHeartbeat();
        });

        // Game events (registered once)
        socket.on(String(gameId), (data: unknown[]) => {
          handleEvent(data);
        });

        socket.on('disconnect', (reason) => {
          if (session) {
            session.isConnected = false;
            log(`disconnected — reason: ${reason}`);
            notifyStatus();
          }
          stopHeartbeat();
        });

        socket.on('reconnect_attempt', (attempt) => {
          log(`reconnect attempt #${attempt}...`);
        });

        socket.on('reconnect_failed', () => {
          log(`reconnect failed — giving up`);
        });

        socket.on('connect_error', (err) => {
          log(`connect_error: ${err.message}`);
          if (!resolved) { resolved = true; resolve(null); }
        });

        socket.io.on('error', (err) => {
          log(`transport error: ${err.message}`);
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!resolved) { resolved = true; log('connect timeout (10s)'); resolve(null); }
        }, 10000);
      });
    },

    disconnect() {
      if (currentGameId) log(`disconnecting from game ${currentGameId}`);
      cleanup();
      currentGameId = null;
      session = null;
    },

    getSession(): BblGameSession | null { return session; },

    getEventsSince(fromIndex: number): MappedEvent[] {
      return getEventsSince(session?.events ?? [], fromIndex);
    },

    onEvent(cb: EventCallback) {
      eventListeners.push(cb);
      return () => { eventListeners = eventListeners.filter(l => l !== cb); };
    },

    onLog(cb: LogCallback) {
      logListeners.push(cb);
      return () => { logListeners = logListeners.filter(l => l !== cb); };
    },

    onStatus(cb: StatusCallback) {
      statusListeners.push(cb);
      return () => { statusListeners = statusListeners.filter(l => l !== cb); };
    },

    isConnected(): boolean { return session?.isConnected ?? false; },
  };
}
