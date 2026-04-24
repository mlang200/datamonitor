/**
 * Replay Routes — Admin-only endpoints for game replay.
 *
 * POST /api/admin/replay/start  — Start replaying a recorded game
 * POST /api/admin/replay/stop   — Stop current replay
 * GET  /api/admin/replay/status — Get replay state
 * GET  /api/admin/replay/recordings — List available recordings
 */
import { Router, Request, Response } from 'express';
import path from 'path';
import type { ReplayService } from '../replay/index.js';

export function createReplayRouter(replayService: ReplayService, recordingsDir: string): Router {
  const router = Router();

  // POST /start — Start replay
  router.post('/start', (req: Request, res: Response) => {
    const { filename, speed } = req.body;

    if (!filename) {
      res.status(400).json({ error: 'filename ist erforderlich' });
      return;
    }

    // Prevent path traversal
    const safeName = path.basename(filename);
    const filePath = path.join(recordingsDir, safeName);

    try {
      const state = replayService.start(filePath, speed || 10);
      res.json({ success: true, state });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /stop — Stop replay
  router.post('/stop', (_req: Request, res: Response) => {
    replayService.stop();
    res.json({ success: true });
  });

  // GET /status — Get replay state
  router.get('/status', (_req: Request, res: Response) => {
    const state = replayService.getState();
    res.json({ state });
  });

  // GET /recordings — List available recordings
  router.get('/recordings', (_req: Request, res: Response) => {
    const files = replayService.listRecordings();
    res.json({ recordings: files });
  });

  return router;
}
