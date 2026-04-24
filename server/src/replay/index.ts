/**
 * Replay Service — spielt aufgezeichnete BBL-Spiele ab.
 *
 * Simuliert den kompletten Spielverlauf über den WebSocket-Kanal.
 * Der Client (Browser) merkt keinen Unterschied zu einem echten Spiel.
 *
 * Ablauf:
 * 1. Admin startet Replay über POST /api/admin/replay/start
 * 2. GameInfo wird sofort gesendet
 * 3. History-Events werden in einem Batch gesendet (wie beim echten Connect)
 * 4. Live-Events werden zeitversetzt abgespielt (mit konfigurierbarer Geschwindigkeit)
 * 5. Admin kann Replay jederzeit stoppen
 */
import fs from 'fs';
import { mapData, type MappedEvent } from '../bbl-socket/mappings.js';
import type { BblSocketService, GameInfo, BblLog } from '../bbl-socket/index.js';

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

    // Load recording
    const raw = fs.readFileSync(filePath, 'utf-8');
    const recording: Recording = JSON.parse(raw);

    if (!recording.events || recording.events.length === 0) {
      throw new Error('Recording enthält keine Events');
    }

    const dataEvents = recording.events.filter(e => e.channel === 'data');

    state = {
      isPlaying: true,
      gameId: recording.gameId,
      totalEvents: dataEvents.length,
      playedEvents: 0,
      speed,
      recordedAt: recording.recordedAt,
    };

    // Connect to the "game" — this creates a session in the BBL socket service
    // We use a fake connect that just sets up the session
    bblSocket.connect(recording.gameId).then(() => {
      if (aborted || !state) return;

      // Now replay events with timing
      replayEvents(dataEvents, speed);
    });

    return state;
  }

  function replayEvents(events: RecordedEvent[], speed: number) {
    if (events.length === 0 || aborted) return;

    let index = 0;
    const firstTs = events[0].ts;

    function playNext() {
      if (aborted || !state || index >= events.length) {
        if (state) state.isPlaying = false;
        return;
      }

      const ev = events[index];
      const payload = ev.payload as unknown[];

      // Feed the raw event array into the BBL socket service's event handler
      // The service will map it and broadcast to all WebSocket clients
      const mapped = mapData(payload);

      // Emit through the service's event system
      // We need to trigger the onEvent callbacks
      (bblSocket as any)._injectEvent?.(mapped);

      state.playedEvents = index + 1;
      index++;

      // Schedule next event
      if (index < events.length) {
        const nextTs = events[index].ts;
        const delay = Math.max(1, (nextTs - ev.ts) / speed);

        // History events (before history_end) are sent immediately
        const isHistory = mapped.type !== 20 && !events.slice(0, index).some(e => {
          const p = e.payload as unknown[];
          return Array.isArray(p) && p[0] === 20;
        });

        if (isHistory) {
          // Send history events immediately (batch)
          setImmediate(playNext);
        } else {
          timer = setTimeout(playNext, delay);
        }
      } else {
        if (state) state.isPlaying = false;
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
