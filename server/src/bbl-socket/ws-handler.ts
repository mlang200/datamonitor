/**
 * WebSocket-Handler für BBL Socket — pusht Events und Logs
 * direkt an verbundene Browser-Clients.
 *
 * Pfad: /ws/bbl-live
 *
 * Features:
 * - Ping/Pong Heartbeat (30s) — erkennt tote Clients
 * - Init-Payload bei Verbindung — Client bekommt sofort den vollen State
 * - Logs werden direkt über onLog-Callback gepusht (kein Polling)
 * - historyIncomplete-Flag in init und status Broadcasts
 */
import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { BblSocketService, BblGameSession } from './index.js';

interface WsMessage {
  type: 'connect' | 'disconnect';
  gameId?: number;
}

/* ------------------------------------------------------------------ */
/*  Standalone helper (exported for testing — Property 4)              */
/* ------------------------------------------------------------------ */

/**
 * Builds the init payload from a BblGameSession.
 * Exported as a standalone pure function so Property 4 can test it
 * without spinning up a real WebSocket server.
 */
export function buildInitPayload(session: BblGameSession) {
  return {
    connected: session.isConnected,
    gameId: session.gameId,
    gameInfo: session.gameInfo,
    historyLoaded: session.isHistoryLoaded,
    historyIncomplete: session.historyIncomplete,
    events: [...session.events],
    logs: [...session.logs],
  };
}

/* ------------------------------------------------------------------ */
/*  WebSocket setup                                                    */
/* ------------------------------------------------------------------ */

export function setupBblWebSocket(
  server: HttpServer,
  bblSocket: BblSocketService,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  // Ping/Pong Heartbeat — erkennt tote Browser-Clients
  const aliveMap = new WeakMap<WebSocket, boolean>();
  const pingInterval = setInterval(() => {
    for (const ws of clients) {
      if (aliveMap.get(ws) === false) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      aliveMap.set(ws, false);
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(pingInterval));

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname !== '/ws/bbl-live') return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Events direkt an alle Clients pushen
  bblSocket.onEvent((event) => {
    broadcast({ type: 'event', payload: event });
  });

  // Logs direkt pushen (kein Polling mehr)
  bblSocket.onLog((log) => {
    broadcast({ type: 'log', payload: log });
  });

  bblSocket.onStatus((status) => {
    broadcast({ type: 'status', payload: status });
  });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    aliveMap.set(ws, true);

    ws.on('pong', () => { aliveMap.set(ws, true); });

    // Sende aktuellen State sofort (falls schon eine Session läuft)
    const session = bblSocket.getSession();
    if (session) {
      send(ws, { type: 'init', payload: buildInitPayload(session) });
    }

    ws.on('message', async (raw: Buffer | string) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        send(ws, { type: 'error', payload: 'Invalid JSON' });
        return;
      }

      if (msg.type === 'connect' && msg.gameId) {
        try {
          // Alten State verwerfen — Client bekommt frische Daten über Events
          broadcast({ type: 'status', payload: { connected: false, historyLoaded: false, historyIncomplete: false } });
          const gameInfo = await bblSocket.connect(msg.gameId);
          broadcast({ type: 'connected', payload: { gameInfo, gameId: msg.gameId } });
        } catch (err) {
          send(ws, { type: 'error', payload: `Connect failed: ${(err as Error).message}` });
        }
      } else if (msg.type === 'disconnect') {
        bblSocket.disconnect();
        broadcast({ type: 'disconnected', payload: null });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  function broadcast(msg: { type: string; payload: unknown }) {
    if (clients.size === 0) return;
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data, (err) => {
          if (err) { clients.delete(ws); ws.terminate(); }
        });
      }
    }
  }

  function send(ws: WebSocket, msg: { type: string; payload: unknown }) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg), (err) => {
        if (err) { clients.delete(ws); ws.terminate(); }
      });
    }
  }

  return wss;
}
