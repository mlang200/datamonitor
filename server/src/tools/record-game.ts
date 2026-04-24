#!/usr/bin/env npx tsx
/**
 * Record a live BBL game to a JSON file.
 *
 * Usage:
 *   npx tsx server/src/tools/record-game.ts <gameId> [outputFile]
 *
 * Example:
 *   npx tsx server/src/tools/record-game.ts 12345 recordings/game-12345.json
 *
 * Requires BBL_SOCKET_API_KEY in .env or environment.
 * Press Ctrl+C to stop recording.
 */
import fs from 'fs';
import path from 'path';
import { io } from 'socket.io-client';

const gameId = parseInt(process.argv[2], 10);
if (!gameId) {
  console.error('Usage: npx tsx server/src/tools/record-game.ts <gameId> [outputFile]');
  process.exit(1);
}

const apiKey = process.env.BBL_SOCKET_API_KEY;
const apiUrl = process.env.BBL_SOCKET_URL || 'https://api.bbl.scb.world';
if (!apiKey) {
  console.error('BBL_SOCKET_API_KEY not set');
  process.exit(1);
}

const outputFile = process.argv[3] || `recordings/game-${gameId}.json`;
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

interface RecordedEvent {
  ts: number;       // milliseconds since recording start
  channel: string;  // 'data' | 'game' | 'gamecenter'
  payload: unknown;
}

const recording: {
  gameId: number;
  recordedAt: string;
  apiUrl: string;
  gameInfo: unknown;
  events: RecordedEvent[];
} = {
  gameId,
  recordedAt: new Date().toISOString(),
  apiUrl,
  gameInfo: null,
  events: [],
};

const startTime = Date.now();

console.log(`Connecting to ${apiUrl} for game ${gameId}...`);

const socket = io(apiUrl, {
  extraHeaders: { 'x-api-key': apiKey },
  transports: ['websocket', 'polling'],
  reconnection: true,
  timeout: 10000,
});

socket.on('connect', () => {
  console.log(`Connected (socket.id=${socket.id})`);

  // Join game
  socket.emit('join', gameId, (ack: unknown) => {
    console.log('Join ack:', JSON.stringify(ack));
  });

  // Get game info
  socket.emit('game', { gameId }, (res: { status: string; data: unknown }) => {
    if (res.status === 'success') {
      recording.gameInfo = res.data;
      console.log('Game info received');
    }
  });

  // Request full history
  socket.emit('history', gameId);
  console.log('History requested');

  // Get gamecenter data
  socket.emit('gamecenter', {}, (res: unknown) => {
    recording.events.push({
      ts: Date.now() - startTime,
      channel: 'gamecenter',
      payload: res,
    });
    console.log('Gamecenter data recorded');
  });
});

// Record all game events
socket.on(String(gameId), (data: unknown[]) => {
  recording.events.push({
    ts: Date.now() - startTime,
    channel: 'data',
    payload: data,
  });

  // Log progress
  const type = Array.isArray(data) ? data[0] : '?';
  if (type === 20) {
    console.log(`  history_end — ${recording.events.length} events recorded so far`);
  } else if (recording.events.length % 50 === 0) {
    console.log(`  ${recording.events.length} events recorded...`);
  }
});

socket.on('disconnect', (reason) => {
  console.log(`Disconnected: ${reason}`);
});

// Save on Ctrl+C
function save() {
  console.log(`\nSaving ${recording.events.length} events to ${outputFile}...`);
  fs.writeFileSync(outputFile, JSON.stringify(recording, null, 2));
  console.log(`Done. File size: ${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB`);
  process.exit(0);
}

process.on('SIGINT', save);
process.on('SIGTERM', save);

// Auto-save every 60 seconds
setInterval(() => {
  fs.writeFileSync(outputFile, JSON.stringify(recording, null, 2));
  console.log(`Auto-saved ${recording.events.length} events`);
}, 60000);

console.log('Recording... Press Ctrl+C to stop and save.');
