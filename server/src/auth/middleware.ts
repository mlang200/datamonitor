import type { RequestHandler } from 'express';

// Extend express-session with our user data
declare module 'express-session' {
  interface SessionData {
    user?: { id: number; username: string; role: 'admin' | 'user' };
  }
}

// Extend Express Request with user property for downstream handlers
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; username: string; role: 'admin' | 'user' };
    }
  }
}

/**
 * Middleware that requires a valid authenticated session.
 * Returns 401 if no valid session user is present.
 * Sets req.user from session for downstream handlers.
 */
export function requireAuth(): RequestHandler {
  return (req, res, next) => {
    const sessionUser = req.session?.user;

    if (!sessionUser || !sessionUser.id || !sessionUser.username || !sessionUser.role) {
      res.status(401).json({ error: 'Nicht authentifiziert' });
      return;
    }

    req.user = sessionUser;
    next();
  };
}

/**
 * Middleware that requires admin role.
 * Must be used after requireAuth() — assumes session is valid.
 * Returns 403 if user role is not 'admin'.
 */
export function requireAdmin(): RequestHandler {
  return (req, res, next) => {
    const sessionUser = req.session?.user;

    if (!sessionUser || !sessionUser.id || !sessionUser.username || !sessionUser.role) {
      res.status(401).json({ error: 'Nicht authentifiziert' });
      return;
    }

    if (sessionUser.role !== 'admin') {
      res.status(403).json({ error: 'Keine Berechtigung' });
      return;
    }

    req.user = sessionUser;
    next();
  };
}
