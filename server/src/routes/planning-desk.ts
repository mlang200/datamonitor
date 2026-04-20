import { Router, Request, Response } from 'express';
import type { PlanningDeskClient } from '../planning-desk-client.js';

export function createPlanningDeskRouter(planningDeskClient: PlanningDeskClient): Router {
  const router = Router();

  // GET /matches — Spielliste (gefiltert auf bblscb Scope)
  router.get('/matches', async (_req: Request, res: Response) => {
    try {
      const matches = await planningDeskClient.getMatches('basketball');
      // Additional filter: only bblscb scope matches
      const bblMatches = matches.filter(m => m.gamedayScope === 'bblscb');
      res.json(bblMatches);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
