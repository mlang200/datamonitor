/**
 * React Hook für die BBL Live WebSocket-Verbindung.
 *
 * Features:
 * - Automatischer Reconnect mit exponential backoff (1s → 2s → 4s → max 10s)
 * - State-Synchronisation nach Reconnect (init-Payload vom Server)
 * - Sendet Befehle nur wenn WebSocket ready ist (readyState check)
 * - Heartbeat-Erkennung über Ping/Pong (Server-seitig)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { BblMappedEvent } from '../api';

export interface BblLog { ts: string; msg: string }

interface GameInfoTeam {
  id: number;
  name: string;
  shortname: string;
  TLC: string;
  roster: { id: number; firstName: string; lastName: string; playerId: number; NUM: string }[];
}

export interface GameInfo {
  homeTeam: GameInfoTeam;
  guestTeam: GameInfoTeam;
  gameId: number;
  seasonId: number;
  scheduledTime: string;
  venue: string;
}

export interface BblWsState {
  connected: boolean;
  gameId: number | null;
  gameInfo: GameInfo | null;
  events: BblMappedEvent[];
  logs: BblLog[];
  historyLoaded: boolean;
  historyIncomplete: boolean;
  wsReady: boolean;
}

const INITIAL_STATE: BblWsState = {
  connected: false,
  gameId: null,
  gameInfo: null,
  events: [],
  logs: [],
  historyLoaded: false,
  historyIncomplete: false,
  wsReady: false,
};

const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 10000;

/**
 * Pure function: processes an `init` message payload into a new BblWsState.
 * Exported for Property 14 testing.
 */
export function processInitMessage(prev: BblWsState, payload: any): BblWsState {
  return {
    ...prev,
    connected: payload.connected,
    gameId: payload.gameId,
    gameInfo: payload.gameInfo,
    historyLoaded: payload.historyLoaded,
    historyIncomplete: payload.historyIncomplete ?? false,
    events: payload.events || [],
    logs: payload.logs?.length > 0 ? payload.logs : prev.logs,
  };
}

/**
 * Pure function: processes an `event` message payload by appending to existing events.
 * Exported for Property 15 testing.
 */
export function processEventMessage(prev: BblWsState, payload: BblMappedEvent): BblWsState {
  return { ...prev, events: [...prev.events, payload] };
}

export function useBblSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE);
  const intentionalClose = useRef(false);
  const mountedRef = useRef(true);

  const [state, setState] = useState<BblWsState>(INITIAL_STATE);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setState(prev => ({ ...prev, logs: [...prev.logs, { ts, msg }] }));
  }, []);

  const createConnection = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up old connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/bbl-live`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectDelay.current = RECONNECT_BASE; // Reset backoff
      setState(prev => ({ ...prev, wsReady: true }));
      addLog('Serververbindung hergestellt — wähle ein Spiel und klicke „Verbinden"');
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      let msg: { type: string; payload: any };
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case 'init':
          setState(prev => processInitMessage(prev, msg.payload));
          break;
        case 'event':
          setState(prev => processEventMessage(prev, msg.payload));
          break;
        case 'log':
          setState(prev => ({ ...prev, logs: [...prev.logs, msg.payload] }));
          break;
        case 'status':
          setState(prev => ({
            ...prev,
            connected: msg.payload.connected,
            historyLoaded: msg.payload.historyLoaded,
            historyIncomplete: msg.payload.historyIncomplete ?? prev.historyIncomplete,
          }));
          break;
        case 'connected':
          setState(prev => ({
            ...prev,
            connected: true,
            gameId: msg.payload.gameId,
            gameInfo: msg.payload.gameInfo,
          }));
          break;
        case 'disconnected':
          setState(prev => ({
            ...prev,
            connected: false,
            gameId: null,
            gameInfo: null,
            events: [],
            logs: [],
            historyLoaded: false,
            historyIncomplete: false,
          }));
          break;
        case 'error':
          addLog(`error: ${msg.payload}`);
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setState(prev => ({ ...prev, wsReady: false }));

      if (!intentionalClose.current) {
        // Auto-reconnect with exponential backoff
        const delay = reconnectDelay.current;
        addLog(`ws: disconnected, reconnecting in ${delay}ms...`);
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX);
          createConnection();
        }, delay);
      }
    };

    ws.onerror = () => {
      // onclose is called automatically after onerror
    };
  }, [addLog]);

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;
    intentionalClose.current = false;
    createConnection();

    return () => {
      mountedRef.current = false;
      intentionalClose.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [createConnection]);

  const sendMessage = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      addLog('ws: not ready, message dropped');
    }
  }, [addLog]);

  const connect = useCallback((gameId: number) => {
    setState(prev => ({
      ...prev,
      events: [],
      logs: [{ ts: new Date().toISOString().slice(11, 23), msg: `connecting to game ${gameId}...` }],
      connected: false,
      gameInfo: null,
      historyLoaded: false,
      historyIncomplete: false,
      gameId,
    }));
    sendMessage({ type: 'connect', gameId });
  }, [sendMessage]);

  const disconnect = useCallback(() => {
    sendMessage({ type: 'disconnect' });
    setState(prev => ({
      ...prev,
      connected: false,
      gameId: null,
      gameInfo: null,
      events: [],
      logs: [],
      historyLoaded: false,
      historyIncomplete: false,
    }));
  }, [sendMessage]);

  return { state, connect, disconnect };
}
