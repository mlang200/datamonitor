import { Router, Request, Response } from 'express';
import type { BblSocketService } from '../bbl-socket/index.js';

export function createBblSocketRouter(bblSocket: BblSocketService): Router {
  const router = Router();

  // POST /connect — Verbindet sich mit einem Spiel
  router.post('/connect', async (req: Request, res: Response) => {
    try {
      const { gameId } = req.body;
      if (!gameId || typeof gameId !== 'number') {
        res.status(400).json({ error: 'gameId (number) required' });
        return;
      }
      const gameInfo = await bblSocket.connect(gameId);
      res.json({ success: true, gameInfo });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /disconnect — Trennt die Verbindung
  router.post('/disconnect', (_req: Request, res: Response) => {
    bblSocket.disconnect();
    res.json({ success: true });
  });

  // GET /session — Gibt den aktuellen Session-Status zurück
  router.get('/session', (_req: Request, res: Response) => {
    const session = bblSocket.getSession();
    if (!session) {
      res.json({ connected: false, gameId: null });
      return;
    }
    res.json({
      connected: session.isConnected,
      gameId: session.gameId,
      gameInfo: session.gameInfo,
      historyLoaded: session.isHistoryLoaded,
      historyIncomplete: session.historyIncomplete,
      eventCount: session.events.length,
    });
  });

  // GET /events?from=0 — Gibt Events ab einem Index zurück
  router.get('/events', (req: Request, res: Response) => {
    const from = parseInt(req.query.from as string) || 0;
    const events = bblSocket.getEventsSince(from);
    const session = bblSocket.getSession();
    res.json({
      events,
      totalCount: session ? session.events.length : 0,
      connected: session?.isConnected ?? false,
      historyLoaded: session?.isHistoryLoaded ?? false,
    });
  });

  return router;
}
