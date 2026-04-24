/**
 * Replay Service — spielt aufgezeichnete BBL-Spiele ab.
 *
 * Simuliert den kompletten Spielverlauf über den WebSocket-Kanal.
 * Der Client (Browser) merkt keinen Unterschied zu einem echten Spiel.
 *
 * WICHTIG: Der Replay umgeht die echte BBL API komplett.
 * Er baut die Session manuell auf und injiziert Events direkt.
 */
import fs from 'fs';
import { mapData, type MappedEvent } from '../bbl-socket/mappings.js';
import type { BblSocketService, GameInfo } from '../bbl-socket/index.js';

export interface RecordedEvent {
  ts: number;
  channel: string;
  payload: unknown;
}

export interface Recording {
  gameId: number;
  recordedAt: string;
  gameInfo: GameInfo | null;
  events: RecordedEvent[];
}

export interface ReplayState {
  isPlaying: boolean;
  gameId: number;
  totalEvents: number;
  playedEvents: number;
  speed: number;
  recordedAt: string;
}

export interface ReplayService {
  start(filePath: string, speed?: number): ReplayState;
  stop(): void;
  getState(): ReplayState | null;
  listRecordings(): string[];
}

const QUARTER_SECONDS = 600; // 10 min per quarter

/**
 * Convert quarter number + remaining seconds to absolute game seconds.
 * Q1 10:00 (600s remaining) = 0s elapsed
 * Q1 0:00 (0s remaining) = 600s elapsed
 * Q2 10:00 = 600s, Q4 0:00 = 2400s
 */
function toGameSeconds(quarter: number, remainingSeconds: number): number {
  if (quarter <= 0) return 0;
  const qIndex = quarter - 1;
  const elapsed = QUARTER_SECONDS - Math.max(0, remainingSeconds);
  return qIndex * QUARTER_SECONDS + elapsed;
}

/**
 * Extract game time from a raw event array.
 * Returns absolute game seconds, or -1 if not determinable.
 */
function extractGameTime(raw: unknown[]): number {
  const type = raw[0] as number;
  const quarter = raw[2] as number;

  if (typeof quarter !== 'number' || quarter <= 0) return -1;

  if (type === 0) {
    // Score: [0, id, quarter, time, scoreA, scoreB]
    const time = raw[3] as number;
    return typeof time === 'number' ? toGameSeconds(quarter, time) : -1;
  }
  if (type === 1) {
    // Action: [1, id, quarter, teamCode, playerId, assistId, time, ...]
    const time = raw[6] as number;
    return typeof time === 'number' ? toGameSeconds(quarter, time) : -1;
  }
  if (type === 3) {
    // Time event: [3, id, quarter, time, actionType, ...]
    const time = raw[3] as number;
    return typeof time === 'number' ? toGameSeconds(quarter, time) : -1;
  }

  return -1;
}

export function createReplayService(
  bblSocket: BblSocketService,
  recordingsDir: string,
): ReplayService {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: ReplayState | null = null;
  let aborted = false;

  function stop() {
    aborted = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (state) {
      bblSocket.disconnect();
      state = null;
    }
  }

  function start(filePath: string, speed = 10): ReplayState {
    stop();
    aborted = false;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const recording: Recording = JSON.parse(raw);

    if (!recording.events || recording.events.length === 0) {
      throw new Error('Recording enthält keine Events');
    }

    const dataEvents = recording.events
      .filter(e => e.channel === 'data')
      .map(e => {
        const rawArr = e.payload as unknown[];
        const mapped = mapData(rawArr);
        const gameSec = extractGameTime(rawArr);
        return { mapped, gameSec, rawArr };
      });

    // Split: setup events (immediate) vs play events (timed)
    const setupTypes = new Set([2, 4, 7, 8]);
    const setupEvents = dataEvents.filter(e => setupTypes.has(e.mapped.type));
    const playEvents = dataEvents
      .filter(e => !setupTypes.has(e.mapped.type) && e.mapped.type !== 20)
      .filter(e => e.gameSec >= 0) // Only events with valid game time
      .sort((a, b) => a.gameSec - b.gameSec);

    state = {
      isPlaying: true,
      gameId: recording.gameId,
      totalEvents: playEvents.length,
      playedEvents: 0,
      speed,
      recordedAt: recording.recordedAt,
    };

    // Disconnect any current game
    bblSocket.disconnect();

    // Use _startReplaySession to create a session WITHOUT connecting to the real API
    // This injects the gameInfo from the recording directly
    setTimeout(() => {
      if (aborted || !state) return;

      bblSocket._startReplaySession(recording.gameId, recording.gameInfo);

      // 1. Send setup events immediately (team stats, player stats, starting five)
      for (const ev of setupEvents) {
        bblSocket._injectEvent(ev.mapped);
      }

      // 2. Send history_end
      bblSocket._injectEvent(mapData([20]));

      // 3. Send play events with game-time-based delays
      console.log(`[replay] Starting playback: ${playEvents.length} events at ${speed}x speed`);
      replayPlayEvents(playEvents, speed);
    }, 300);

    return state;
  }

  function replayPlayEvents(
    events: { gameSec: number; mapped: MappedEvent }[],
    speed: number,
  ) {
    if (events.length === 0 || aborted) {
      if (state) state.isPlaying = false;
      return;
    }

    let index = 0;

    function playNext() {
      if (aborted || !state || index >= events.length) {
        if (state) state.isPlaying = false;
        return;
      }

      const ev = events[index];
      bblSocket._injectEvent(ev.mapped);
      state.playedEvents = index + 1;
      index++;

      if (index < events.length) {
        const nextEv = events[index];
        const gameTimeDiff = Math.max(0, nextEv.gameSec - ev.gameSec);
        // Convert game seconds to real ms, divided by speed
        const delay = gameTimeDiff > 0
          ? Math.max(20, (gameTimeDiff * 1000) / speed)
          : 20; // Same game-second: 20ms gap for UI updates
        timer = setTimeout(playNext, delay);
      } else {
        state.isPlaying = false;
        console.log(`[replay] Playback complete: ${state.playedEvents} events`);
      }
    }

    playNext();
  }

  function listRecordings(): string[] {
    try {
      if (!fs.existsSync(recordingsDir)) return [];
      return fs.readdirSync(recordingsDir)
        .filter(f => f.endsWith('.json'))
        .sort();
    } catch {
      return [];
    }
  }

  return { start, stop, getState: () => state, listRecordings };
}
