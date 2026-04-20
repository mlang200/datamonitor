/**
 * Production Window Hook — hält die BBL-Socket-Verbindung während des
 * relevanten Produktionsfensters automatisch offen.
 *
 * Fenster: scheduledAt - 15min bis scheduledAt + 2h45min
 * (15min Vorlauf + ~2,5h Spieldauer + 15min Nachlauf)
 *
 * Während des Fensters:
 * - Verbindung wird automatisch aufgebaut wenn noch nicht verbunden
 * - Reconnects laufen weiter bis Verbindung steht oder Fenster endet
 * - Kein automatischer Disconnect durch Inaktivität
 *
 * Außerhalb des Fensters:
 * - Verbindung darf manuell aufgebaut werden
 * - Kein automatischer Connect
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ═══════════════════════════════════════════════
// Pure functions (exported for testing)
// ═══════════════════════════════════════════════

const WINDOW_BEFORE_MS = 15 * 60 * 1000;  // 15 minutes before
const WINDOW_AFTER_MS = 165 * 60 * 1000;  // 2h45min after (2.5h game + 15min buffer)

export interface ProductionWindow {
  start: Date;
  end: Date;
  scheduledAt: Date;
}

/**
 * Computes the production window for a match.
 * Returns null if scheduledAt is invalid.
 */
export function getProductionWindow(scheduledAt: string): ProductionWindow | null {
  const scheduled = new Date(scheduledAt);
  if (isNaN(scheduled.getTime())) return null;
  return {
    scheduledAt: scheduled,
    start: new Date(scheduled.getTime() - WINDOW_BEFORE_MS),
    end: new Date(scheduled.getTime() + WINDOW_AFTER_MS),
  };
}

export type WindowStatus = 'before' | 'active' | 'after';

/**
 * Determines whether the current time is within the production window.
 */
export function getWindowStatus(window: ProductionWindow, now: Date = new Date()): WindowStatus {
  const t = now.getTime();
  if (t < window.start.getTime()) return 'before';
  if (t > window.end.getTime()) return 'after';
  return 'active';
}

/**
 * Returns milliseconds until the window starts (0 if already started or passed).
 */
export function msUntilWindowStart(window: ProductionWindow, now: Date = new Date()): number {
  return Math.max(0, window.start.getTime() - now.getTime());
}

/**
 * Returns milliseconds until the window ends (0 if already ended).
 */
export function msUntilWindowEnd(window: ProductionWindow, now: Date = new Date()): number {
  return Math.max(0, window.end.getTime() - now.getTime());
}

// ═══════════════════════════════════════════════
// React Hook
// ═══════════════════════════════════════════════

export interface ProductionWindowState {
  /** The computed production window (null if no match selected) */
  window: ProductionWindow | null;
  /** Current status: before/active/after the window */
  status: WindowStatus | null;
  /** Whether the window is currently active */
  isActive: boolean;
  /** Whether auto-connect was triggered by the window */
  autoConnected: boolean;
  /** Human-readable status label for the UI */
  label: string;
}

/**
 * Hook that monitors the production window for a selected match
 * and triggers auto-connect/disconnect.
 *
 * @param scheduledAt - ISO date string of the match start time
 * @param gameId - BBL game ID to connect to
 * @param isConnected - Whether the BBL socket is currently connected
 * @param wsReady - Whether the WebSocket to our server is ready
 * @param connect - Function to connect to a game
 * @param disconnect - Function to disconnect
 */
export function useProductionWindow(
  scheduledAt: string | null,
  gameId: number | null,
  isConnected: boolean,
  wsReady: boolean,
  connect: (gameId: number) => void,
  disconnect: () => void,
): ProductionWindowState {
  const [status, setStatus] = useState<WindowStatus | null>(null);
  const [autoConnected, setAutoConnected] = useState(false);
  const manualDisconnect = useRef(false);
  const checkInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const window = useMemo(() => {
    if (!scheduledAt) return null;
    return getProductionWindow(scheduledAt);
  }, [scheduledAt]);

  // Check window status every 10 seconds
  useEffect(() => {
    if (!window) {
      setStatus(null);
      return;
    }

    const check = () => {
      const newStatus = getWindowStatus(window);
      setStatus(newStatus);
    };

    check(); // Initial check
    checkInterval.current = setInterval(check, 10_000);

    return () => {
      if (checkInterval.current) clearInterval(checkInterval.current);
    };
  }, [window]);

  // Auto-connect when window becomes active
  useEffect(() => {
    if (status !== 'active') return;
    if (!gameId || !wsReady) return;
    if (isConnected) return;
    if (manualDisconnect.current) return;

    // Window is active, we have a gameId, WS is ready, not connected, no manual disconnect
    connect(gameId);
    setAutoConnected(true);
  }, [status, gameId, wsReady, isConnected, connect]);

  // Auto-disconnect when window ends
  useEffect(() => {
    if (status === 'after' && isConnected && autoConnected) {
      disconnect();
      setAutoConnected(false);
    }
  }, [status, isConnected, autoConnected, disconnect]);

  // Reset manual disconnect flag when match changes
  useEffect(() => {
    manualDisconnect.current = false;
    setAutoConnected(false);
  }, [scheduledAt, gameId]);

  // Expose a way to mark manual disconnect (called from dashboard)
  const markManualDisconnect = useCallback(() => {
    manualDisconnect.current = true;
    setAutoConnected(false);
  }, []);

  const isActive = status === 'active';

  let label = '';
  if (!window) {
    label = '';
  } else if (status === 'before') {
    const mins = Math.ceil(msUntilWindowStart(window) / 60_000);
    label = `Live-Fenster startet in ${mins} Min`;
  } else if (status === 'active') {
    if (isConnected) {
      label = '🟢 Live-Fenster aktiv — Verbindung wird gehalten';
    } else {
      label = '🟠 Live-Fenster aktiv — Reconnect läuft';
    }
  } else {
    label = 'Live-Fenster beendet';
  }

  return { window, status, isActive, autoConnected, label };
}
