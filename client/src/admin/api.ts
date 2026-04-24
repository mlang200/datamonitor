export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Unbekannter Fehler');
  }
  return data;
}

export async function getUsers(): Promise<AdminUser[]> {
  const res = await fetch('/api/admin/users', { credentials: 'include' });
  const data = await handleResponse<{ users: AdminUser[] }>(res);
  return data.users;
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const data = await handleResponse<{ user: AdminUser }>(res);
  return data.user;
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await handleResponse<{ success: true }>(res);
}

export async function deactivateUser(id: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}/deactivate`, {
    method: 'POST',
    credentials: 'include',
  });
  await handleResponse<{ success: true }>(res);
}

export async function activateUser(id: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}/activate`, {
    method: 'POST',
    credentials: 'include',
  });
  await handleResponse<{ success: true }>(res);
}

export async function changeRole(id: number, role: 'admin' | 'user'): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role }),
  });
  await handleResponse<{ success: true }>(res);
}

export async function resetPassword(id: number, password: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password }),
  });
  await handleResponse<{ success: true }>(res);
}

// ── Replay API ──────────────────────────────────

export interface ReplayState {
  isPlaying: boolean;
  gameId: number;
  totalEvents: number;
  playedEvents: number;
  speed: number;
  recordedAt: string;
}

export async function getRecordings(): Promise<string[]> {
  const res = await fetch('/api/admin/replay/recordings', { credentials: 'include' });
  const data = await handleResponse<{ recordings: string[] }>(res);
  return data.recordings;
}

export async function startReplay(filename: string, speed?: number): Promise<ReplayState> {
  const res = await fetch('/api/admin/replay/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ filename, speed }),
  });
  const data = await handleResponse<{ state: ReplayState }>(res);
  return data.state;
}

export async function stopReplay(): Promise<void> {
  const res = await fetch('/api/admin/replay/stop', {
    method: 'POST',
    credentials: 'include',
  });
  await handleResponse<{ success: true }>(res);
}

export async function getReplayStatus(): Promise<ReplayState | null> {
  const res = await fetch('/api/admin/replay/status', { credentials: 'include' });
  const data = await handleResponse<{ state: ReplayState | null }>(res);
  return data.state;
}
