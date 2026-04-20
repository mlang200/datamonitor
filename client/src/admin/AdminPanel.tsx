import React, { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { AdminUser } from './api';
import * as adminApi from './api';

export default function AdminPanel() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  // Password reset
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetPwConfirm, setResetPwConfirm] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const data = await adminApi.getUsers();
      setUsers(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await adminApi.createUser({ username: newUsername, email: newEmail, password: newPassword, role: newRole });
      setNewUsername(''); setNewEmail(''); setNewPassword(''); setNewRole('user');
      await fetchUsers();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await adminApi.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      setError(null);
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
      setDeleteTarget(null);
    }
  };

  const handleToggleActive = async (u: AdminUser) => {
    try {
      if (u.is_active) {
        await adminApi.deactivateUser(u.id);
      } else {
        await adminApi.activateUser(u.id);
      }
      setError(null);
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleChangeRole = async (u: AdminUser) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    try {
      await adminApi.changeRole(u.id, newRole);
      setError(null);
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    if (resetPw !== resetPwConfirm) {
      setResetError('Passwörter stimmen nicht überein');
      return;
    }
    try {
      await adminApi.resetPassword(resetTarget.id, resetPw);
      setResetTarget(null);
      setResetPw('');
      setResetPwConfirm('');
      setError(null);
      await fetchUsers();
    } catch (err: any) {
      setResetError(err.message);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#c1d1e1' }}>Lade Benutzer...</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <h2 style={{ color: '#fff', margin: '0 0 16px', fontSize: 18 }}>Benutzerverwaltung</h2>

      {error && (
        <div role="alert" style={alertStyle}>{error}</div>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div style={overlayStyle}>
          <div style={dialogStyle}>
            <p style={{ color: '#c1d1e1', margin: '0 0 16px' }}>
              Benutzer <strong style={{ color: '#fff' }}>{deleteTarget.username}</strong> wirklich löschen?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={btnSecondary}>Abbrechen</button>
              <button onClick={handleDelete} style={btnDanger}>Löschen</button>
            </div>
          </div>
        </div>
      )}

      {/* Password reset dialog */}
      {resetTarget && (
        <div style={overlayStyle}>
          <div style={dialogStyle}>
            <h3 style={{ color: '#fff', margin: '0 0 12px', fontSize: 15 }}>
              Passwort zurücksetzen: {resetTarget.username}
            </h3>
            {resetError && <div role="alert" style={alertStyle}>{resetError}</div>}
            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="password"
                placeholder="Neues Passwort"
                value={resetPw}
                onChange={e => setResetPw(e.target.value)}
                required
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="Passwort bestätigen"
                value={resetPwConfirm}
                onChange={e => setResetPwConfirm(e.target.value)}
                required
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setResetTarget(null); setResetPw(''); setResetPwConfirm(''); setResetError(null); }} style={btnSecondary}>
                  Abbrechen
                </button>
                <button type="submit" style={btnPrimary}>Zurücksetzen</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create user form */}
      <form onSubmit={handleCreate} style={{
        background: '#01192e', border: '1px solid #0d2a42', borderRadius: 6,
        padding: 16, marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Benutzername</span>
          <input value={newUsername} onChange={e => setNewUsername(e.target.value)} required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>E-Mail</span>
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Passwort</span>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Rolle</span>
          <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'user')} style={inputStyle}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit" disabled={creating} style={{ ...btnPrimary, alignSelf: 'flex-end' }}>
          {creating ? 'Erstelle...' : 'Benutzer erstellen'}
        </button>
        {createError && <div role="alert" style={{ ...alertStyle, width: '100%' }}>{createError}</div>}
      </form>

      {/* Users table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #0d2a42' }}>
              <th style={thStyle}>Benutzername</th>
              <th style={thStyle}>E-Mail</th>
              <th style={thStyle}>Rolle</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id} style={{ borderBottom: '1px solid #0d2a42' }}>
                  <td style={tdStyle}>{u.username}</td>
                  <td style={tdStyle}>{u.email}</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                      background: u.role === 'admin' ? 'rgba(34,210,230,0.15)' : 'rgba(255,255,255,0.06)',
                      color: u.role === 'admin' ? '#22d2e6' : '#8a9ab0',
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                      background: u.is_active ? 'rgba(34,230,100,0.15)' : 'rgba(255,61,61,0.1)',
                      color: u.is_active ? '#22e664' : '#ff3d3d',
                    }}>
                      {u.is_active ? 'aktiv' : 'deaktiviert'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!isSelf && (
                      <>
                        <button onClick={() => handleChangeRole(u)} style={btnSmall} title="Rolle ändern">
                          → {u.role === 'admin' ? 'user' : 'admin'}
                        </button>
                        <button onClick={() => setResetTarget(u)} style={btnSmall} title="Passwort zurücksetzen">
                          PW Reset
                        </button>
                        <button onClick={() => handleToggleActive(u)} style={btnSmall} title={u.is_active ? 'Deaktivieren' : 'Aktivieren'}>
                          {u.is_active ? 'Deaktivieren' : 'Aktivieren'}
                        </button>
                        <button onClick={() => setDeleteTarget(u)} style={{ ...btnSmall, borderColor: '#ff3d3d', color: '#ff3d3d' }} title="Löschen">
                          Löschen
                        </button>
                      </>
                    )}
                    {isSelf && <span style={{ color: '#4a6a85', fontSize: 11 }}>(eigenes Konto)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const alertStyle: React.CSSProperties = {
  padding: '10px 12px', background: 'rgba(255,61,61,0.1)', border: '1px solid #ff3d3d',
  borderRadius: 4, color: '#ff3d3d', fontSize: 13, marginBottom: 12,
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: '#01192e', border: '1px solid #0d2a42', borderRadius: 8,
  padding: 24, minWidth: 320, maxWidth: 420,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13, background: '#011326', color: '#c1d1e1',
  border: '1px solid #163a56', borderRadius: 4, outline: 'none', minWidth: 140,
};

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
};

const labelTextStyle: React.CSSProperties = {
  fontSize: 11, color: '#4a6a85', fontWeight: 600,
};

const btnPrimary: React.CSSProperties = {
  padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: 'none', borderRadius: 4, background: '#22d2e6', color: '#011326',
};

const btnSecondary: React.CSSProperties = {
  padding: '6px 14px', fontSize: 13, cursor: 'pointer',
  background: 'transparent', border: '1px solid #163a56', borderRadius: 4, color: '#c1d1e1',
};

const btnDanger: React.CSSProperties = {
  padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: 'none', borderRadius: 4, background: '#ff3d3d', color: '#fff',
};

const btnSmall: React.CSSProperties = {
  padding: '3px 8px', fontSize: 11, cursor: 'pointer',
  background: 'transparent', border: '1px solid #163a56', borderRadius: 3, color: '#c1d1e1',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', color: '#4a6a85', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.5px',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px', color: '#c1d1e1',
};
