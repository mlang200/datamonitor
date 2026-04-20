import { Router, Request, Response } from 'express';
import type { AuthService } from '../auth/auth-service.js';
import type { RateLimiter } from '../auth/rate-limiter.js';
import { requireAuth } from '../auth/middleware.js';

export function createAuthRouter(authService: AuthService, rateLimiter: RateLimiter): Router {
  const router = Router();

  // POST /login — Login with {identity, password}
  router.post('/login', async (req: Request, res: Response) => {
    const ip = req.ip ?? '0.0.0.0';

    // Check rate limiter
    const rateCheck = rateLimiter.check(ip);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Zu viele Anmeldeversuche',
        retryAfterMs: rateCheck.retryAfterMs,
      });
      return;
    }

    const { identity, password } = req.body;
    if (!identity || !password) {
      res.status(400).json({ error: 'identity und password sind erforderlich' });
      return;
    }

    const result = await authService.login(identity, password);

    if (result.success && result.user) {
      // Set session user data
      req.session.user = {
        id: result.user.id,
        username: result.user.username,
        role: result.user.role,
      };
      rateLimiter.reset(ip);
      res.json({ user: result.user });
    } else {
      rateLimiter.recordFailure(ip);
      res.status(401).json({ error: result.error ?? 'Ungültige Anmeldedaten' });
    }
  });

  // POST /logout — Destroy session
  router.post('/logout', requireAuth(), (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: 'Logout fehlgeschlagen' });
        return;
      }
      res.json({ success: true });
    });
  });

  // GET /me — Return current user from session
  router.get('/me', requireAuth(), (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  return router;
}
