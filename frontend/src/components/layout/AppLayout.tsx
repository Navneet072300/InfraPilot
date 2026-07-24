import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuthStore } from '../../store/authStore';

interface Props {
  children: React.ReactNode;
}

export function AppLayout({ children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { isDemoMode, logout } = useAuthStore();
  const navigate = useNavigate();

  function exitDemo() {
    logout();
    navigate('/', { replace: true });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)', overflow: 'hidden' }}>
      {/* Demo mode banner */}
      {isDemoMode && (
        <div style={{
          background: 'var(--warning-bg)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '6px 16px', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
            👁 Demo Mode — sandbox environment (simulated cluster data)
          </span>
          <button
            type="button"
            onClick={() => navigate('/signup')}
            style={{
              fontSize: 11, fontWeight: 700, color: '#fff',
              background: 'var(--warning)', border: 'none',
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            }}
          >
            Sign up free
          </button>
          <button
            type="button"
            onClick={exitDemo}
            style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Exit demo
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <TopBar />
          <main className="bg-dot-pattern" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>{children}</main>
        </div>
      </div>
    </div>
  );
}
