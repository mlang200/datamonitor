/**
 * Replay Service — spielt aufgezeichnete BBL-Spiele ab.
 *
 * Simuliert den kompletten Spielverlauf über den WebSocket-Kanal.
 * Der Client (Browser) merkt keinen Unterschied zu einem echten Spiel.
 *
 * Strategie:
 * 1. Disconnect aktuelle Verbindung
 * 2. Sende Setup-Events sofort als Batch (Team-Stats, Player-Stats, Starting-Five)
 * 3. Sende history_end
 * 4. Sende alle Scoring/Action-Events zeitversetzt basierend auf Spielzeit
 *    (Quarter + Clock → absolute Spielsekunde → Delay zwischen Events)
 * 5. Speed-Faktor bestimmt die Geschwindigkeit (10x = 10-fache Geschwindigkeit)
 */
import fs from 'fs';
import { mapData, QUARTER_MAP, type MappedEvent } from '../bbl-socket/mappings.js';
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
 * Convert quarter + remaining seconds to absolute game seconds.
 * Q1 10:00 = 0s, Q1 0:00 = 600s, Q2 10:00 = 600s, Q4 0:00 = 2400s
 */
function toGameSeconds(quarter: number, remainingSeconds: number): number {
  const qIndex = Math.max(0, quarter - 1); // Q1=0, Q2=1, Q3=2, Q4=3, OT1=4...
  const elapsed = QUARTER_SECONDS - Math.max(0, remainingSeconds);
  return qIndex * QUARTER_SECONDS + elapsed;
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
        const mapped = mapData(e.payload as unknown[]);
        // Extract game time from the event for timing
        const rawArr = e.payload as number[];
        const quarter = typeof rawArr[2] === 'number' ? rawArr[2] : 0;
        const time = typeof rawArr[3] === 'number' ? rawArr[3] : 0;
        // For action events (type 1), time is at index 6
        const actionTime = mapped.type === 1 && typeof rawArr[6] === 'number' ? rawArr[6] : time;
        const gameSec = quarter > 0 ? toGameSeconds(quarter, mapped.type === 1 ? actionTime : time) : -1;
        return { ...e, mapped, gameSec };
      });

    // Split: setup events (sent immediately) vs play events (sent with timing)
    const setupTypes = new Set([2, 4, 7, 8]);
    const setupEvents = dataEvents.filter(e => setupTypes.has(e.mapped.type));
    const playEvents = dataEvents
      .filter(e => !setupTypes.has(e.mapped.type) && e.mapped.type !== 20)
      .sort((a, b) => a.gameSec - b.gameSec); // Sort by game time

    state = {
      isPlaying: true,
      gameId: recording.gameId,
      totalEvents: playEvents.length,
      playedEvents: 0,
      speed,
      recordedAt: recording.recordedAt,
    };

    bblSocket.disconnect();

    setTimeout(() => {
      if (aborted || !state) return;

      bblSocket.connect(recording.gameId).then(() => {
        if (aborted || !state) return;

        // 1. Send setup events immediately
        for (const ev of setupEvents) {
          bblSocket._injectEvent(ev.mapped);
        }

        // 2. Send history_end
        bblSocket._injectEvent(mapData([20]));

        // 3. Send play events with game-time-based delays
        replayPlayEvents(playEvents, speed);
      });
    }, 500);

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
        // Calculate delay from game-time difference
        const gameTimeDiff = Math.max(0, nextEv.gameSec - ev.gameSec);
        // Convert game seconds to real milliseconds, divided by speed
        // 1 game second at 10x speed = 100ms real time
        const delay = gameTimeDiff > 0
          ? Math.max(5, (gameTimeDiff * 1000) / speed)
          : 5; // Events at same game time: tiny delay so UI can update
        timer = setTimeout(playNext, delay);
      } else {
        state.isPlaying = false;
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
