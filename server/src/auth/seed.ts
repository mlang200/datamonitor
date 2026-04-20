import type { UserService } from './user-service';

export interface SeedConfig {
  username?: string;   // INITIAL_ADMIN_USERNAME
  email?: string;      // INITIAL_ADMIN_EMAIL
  password?: string;   // INITIAL_ADMIN_PASSWORD
}

export async function seedInitialAdmin(userService: UserService, config: SeedConfig): Promise<void> {
  if (!userService.isEmpty()) {
    return;
  }

  const { username, email, password } = config;

  if (!username || !email || !password) {
    console.warn(
      'WARNUNG: Keine INITIAL_ADMIN_*-Umgebungsvariablen gesetzt. ' +
      'Kein Admin-Benutzer wurde erstellt — die App ist nicht nutzbar, ' +
      'bis ein Admin manuell angelegt wird.',
    );
    return;
  }

  await userService.createUser({
    username,
    email,
    password,
    role: 'admin',
  });
}
