import { Router, Request, Response } from 'express';
import type { UserService } from '../auth/user-service.js';
import type { AuthService } from '../auth/auth-service.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';

export function createAdminRouter(userService: UserService, authService: AuthService): Router {
  const router = Router();

  // All admin routes require auth + admin role
  router.use(requireAuth(), requireAdmin());

  // GET / — List all users
  router.get('/', (_req: Request, res: Response) => {
    const users = userService.getUsers();
    res.json({ users });
  });

  // POST / — Create new user
  router.post('/', async (req: Request, res: Response) => {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password || !role) {
      res.status(400).json({ error: 'username, email, password und role sind erforderlich' });
      return;
    }

    if (role !== 'admin' && role !== 'user') {
      res.status(400).json({ error: 'Rolle muss "admin" oder "user" sein' });
      return;
    }

    try {
      const user = await userService.createUser({ username, email, password, role });
      res.status(201).json({ user });
    } catch (err: any) {
      if (err.message === 'Benutzername existiert bereits' || err.message === 'E-Mail existiert bereits') {
        res.status(409).json({ error: err.message });
      } else if (err.message === 'Passwort muss mindestens 8 Zeichen lang sein') {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Interner Serverfehler' });
      }
    }
  });

  // DELETE /:id — Delete user
  router.delete('/:id', (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Ungültige Benutzer-ID' });
      return;
    }

    try {
      userService.deleteUser(userId, req.user!.id);
      res.json({ success: true });
    } catch (err: any) {
      if (err.message === 'Benutzer nicht gefunden') {
        res.status(404).json({ error: err.message });
      } else if (
        err.message === 'Eigenes Konto kann nicht gelöscht werden' ||
        err.message === 'Letzter Admin kann nicht gelöscht werden'
      ) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Interner Serverfehler' });
      }
    }
  });

  // POST /:id/deactivate — Deactivate user
  router.post('/:id/deactivate', (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Ungültige Benutzer-ID' });
      return;
    }

    try {
      userService.deactivateUser(userId, req.user!.id);
      authService.invalidateUserSessions(userId);
      res.json({ success: true });
    } catch (err: any) {
      if (err.message === 'Benutzer nicht gefunden') {
        res.status(404).json({ error: err.message });
      } else if (err.message === 'Eigenes Konto kann nicht deaktiviert werden') {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Interner Serverfehler' });
      }
    }
  });

  // POST /:id/activate — Activate user
  router.post('/:id/activate', (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Ungültige Benutzer-ID' });
      return;
    }

    try {
      userService.activateUser(userId);
      res.json({ success: true });
    } catch (err: any) {
      if (err.message === 'Benutzer nicht gefunden') {
        res.status(404).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Interner Serverfehler' });
      }
    }
  });

  // PUT /:id/role — Change role
  router.put('/:id/role', (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Ungültige Benutzer-ID' });
      return;
    }

    const { role } = req.body;
    if (role !== 'admin' && role !== 'user') {
      res.status(400).json({ error: 'Rolle muss "admin" oder "user" sein' });
      return;
    }

    try {
      userService.changeRole(userId, role, req.user!.id);
      authService.invalidateUserSessions(userId);
      res.json({ success: true });
    } catch (err: any) {
      if (err.message === 'Benutzer nicht gefunden') {
        res.status(404).json({ error: err.message });
      } else if (
        err.message === 'Eigene Rolle kann nicht geändert werden' ||
        err.message === 'Letzter Admin kann nicht degradiert werden'
      ) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Interner Serverfehler' });
      }
    }
  });

  // PUT /:id/password — Reset password
  router.put('/:id/password', async (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Ungültige Benutzer-ID' });
      return;
    }

    const { password } = req.body;
    if (!password) {
      res.status(400).json({ error: 'password ist erforderlich' });
      return;
    }

    try {
      await userService.resetPassword(userId, password);
      authService.invalidateUserSessions(userId);
      res.json({ success: true });
    } catch (err: any) {
      if (err.message === 'Benutzer nicht gefunden') {
        res.status(404).json({ error: err.message });
      } else if (err.message === 'Passwort muss mindestens 8 Zeichen lang sein') {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Interner Serverfehler' });
      }
    }
  });

  return router;
}
