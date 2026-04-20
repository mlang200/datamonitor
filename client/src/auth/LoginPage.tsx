import React, { useState, FormEvent } from 'react';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(identity, password);
      if (!result.success) {
        if (result.retryAfterMs) {
          const secs = Math.ceil(result.retryAfterMs / 1000);
          setError(`Zu viele Anmeldeversuche. Bitte warten Sie ${secs} Sekunden.`);
        } else {
          setError(result.error ?? 'Anmeldung fehlgeschlagen');
        }
      }
    } catch {
      setError('Verbindungsfehler. Bitte versuchen Sie es erneut.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#011326', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#01192e', border: '1px solid #0d2a42', borderRadius: 8,
        padding: 32, width: 360, display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff', textAlign: 'center' }}>
          Kommentator App
        </h1>

        {error && (
          <div role="alert" style={{
            padding: '10px 12px', background: 'rgba(255,61,61,0.1)', border: '1px solid #ff3d3d',
            borderRadius: 4, color: '#ff3d3d', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#c1d1e1' }}>E-Mail oder Benutzername</span>
          <input
            type="text"
            value={identity}
            onChange={e => setIdentity(e.target.value)}
            autoComplete="username"
            required
            disabled={loading}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#c1d1e1' }}>Passwort</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={loading}
            style={inputStyle}
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 0', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            border: 'none', borderRadius: 4, background: loading ? '#163a56' : '#22d2e6',
            color: loading ? '#4a6a85' : '#011326', transition: 'background 0.2s',
          }}
        >
          {loading ? 'Anmelden...' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 14, background: '#011326', color: '#c1d1e1',
  border: '1px solid #163a56', borderRadius: 4, outline: 'none',
};
