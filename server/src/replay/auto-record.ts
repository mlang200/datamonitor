/**
 * Auto-Record — zeichnet jedes verbundene Spiel automatisch auf.
 *
 * Hängt sich als Event-Listener in den BBL Socket Service ein.
 * Speichert Recordings im recordings/-Verzeichnis.
 * Alte Recordings (> 7 Tage) werden automatisch gelöscht.
 */
import fs from 'fs';
import path from 'path';
import type { BblSocketService, GameInfo, BblLog } from '../bbl-socket/index.js';
import type { MappedEvent } from '../bbl-socket/mappings.js';

interface RecordedEvent {
  ts: number;
  channel: string;
  payload: unknown;
}

const RETENTION_DAYS = 7;

export function setupAutoRecording(
  bblSocket: BblSocketService,
  recordingsDir: string,
): void {
  // Ensure recordings directory exists
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  let currentGameId: number | null = null;
  let startTime = 0;
  let events: RecordedEvent[] = [];
  let gameInfo: GameInfo | null = null;

  // Listen for events
  bblSocket.onEvent((event: MappedEvent) => {
    if (!currentGameId) return;

    events.push({
      ts: Date.now() - startTime,
      channel: 'data',
      payload: event.raw,
    });

    // Save on history_end and periodically
    if (event.type === 20 || events.length % 100 === 0) {
      saveRecording();
    }
  });

  // Listen for status changes to detect connect/disconnect
  bblSocket.onStatus((status) => {
    if (status.connected && status.gameId && status.gameId !== currentGameId) {
      // New game connected — start recording
      currentGameId = status.gameId;
      startTime = Date.now();
      events = [];
      gameInfo = bblSocket.getSession()?.gameInfo ?? null;
      console.log(`[auto-record] Recording started for game ${currentGameId}`);
    }

    if (!status.connected && currentGameId) {
      // Disconnected — save final recording
      saveRecording();
      console.log(`[auto-record] Recording saved for game ${currentGameId} (${events.length} events)`);
      currentGameId = null;
      events = [];
      gameInfo = null;
    }
  });

  function saveRecording() {
    if (!currentGameId || events.length === 0) return;

    // Update gameInfo from session (may have arrived after connect)
    if (!gameInfo) {
      gameInfo = bblSocket.getSession()?.gameInfo ?? null;
    }

    const recording = {
      gameId: currentGameId,
      recordedAt: new Date(startTime).toISOString(),
      apiUrl: '',
      gameInfo,
      events,
    };

    const filename = `game-${currentGameId}.json`;
    const filePath = path.join(recordingsDir, filename);

    try {
      fs.writeFileSync(filePath, JSON.stringify(recording));
    } catch (err) {
      console.error(`[auto-record] Failed to save: ${(err as Error).message}`);
    }
  }

  // Cleanup old recordings on startup and every hour
  cleanupOldRecordings(recordingsDir);
  setInterval(() => cleanupOldRecordings(recordingsDir), 60 * 60 * 1000);
}

function cleanupOldRecordings(dir: string): void {
  if (!fs.existsSync(dir)) return;

  const now = Date.now();
  const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000;

  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[auto-record] Deleted old recording: ${file}`);
      }
    }
  } catch (err) {
    console.error(`[auto-record] Cleanup error: ${(err as Error).message}`);
  }
}
