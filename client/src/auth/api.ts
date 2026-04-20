export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface LoginResponse {
  user: AuthUser;
}

export interface LoginErrorResponse {
  error: string;
  retryAfterMs?: number;
}

export async function loginApi(
  identity: string,
  password: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; status: number; error: string; retryAfterMs?: number }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ identity, password }),
  });

  if (res.ok) {
    const data: LoginResponse = await res.json();
    return { ok: true, user: data.user };
  }

  const data: LoginErrorResponse = await res.json().catch(() => ({ error: 'Anmeldung fehlgeschlagen' }));
  return { ok: false, status: res.status, error: data.error, retryAfterMs: data.retryAfterMs };
}

export async function logoutApi(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
}

export async function getMeApi(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data: { user: AuthUser } = await res.json();
  return data.user;
}
