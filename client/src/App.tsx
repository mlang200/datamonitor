import { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import BblSocketDashboard from './components/BblSocketDashboard';
import AdminPanel from './admin/AdminPanel';

type Page = 'dashboard' | 'admin';

function AppContent() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#011326', color: '#c1d1e1', fontSize: 14,
      }}>
        Lade...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Non-admin trying to view admin page → redirect to dashboard
  const activePage = page === 'admin' && user?.role !== 'admin' ? 'dashboard' : page;

  return (
    <div style={{ background: '#011326', minHeight: '100vh' }}>
      {/* Navigation bar */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 24px',
        background: '#01192e', borderBottom: '1px solid #0d2a42',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <button onClick={() => setPage('dashboard')} style={navBtn(activePage === 'dashboard')}>
          Dashboard
        </button>
        {user?.role === 'admin' && (
          <button onClick={() => setPage('admin')} style={navBtn(activePage === 'admin')}>
            Admin
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#4a6a85' }}>
          {user?.username} ({user?.role})
        </span>
        <button onClick={logout} style={{
          padding: '4px 12px', fontSize: 12, cursor: 'pointer',
          background: 'transparent', border: '1px solid #163a56', borderRadius: 4, color: '#c1d1e1',
        }}>
          Abmelden
        </button>
      </nav>

      {/* Page content */}
      {activePage === 'admin' ? <AdminPanel /> : <BblSocketDashboard />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function navBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#22d2e6' : '#0d2a42'}`, borderRadius: 4,
    background: active ? '#22d2e6' : 'transparent',
    color: active ? '#011326' : '#c1d1e1',
  };
}
