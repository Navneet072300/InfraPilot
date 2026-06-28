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
        <div style={{ background: 'rgba(210,153,34,0.12)', borderBottom: '1px solid rgba(210,153,34,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '6px 16px', flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#d29922', fontWeight: 600 }}>
            👁 Demo Mode — data is mocked, nothing is saved
          </span>
          <button
            type="button"
            onClick={() => navigate('/signup')}
            style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#d29922', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}
          >
            Sign up free
          </button>
          <button
            type="button"
            onClick={exitDemo}
            style={{ fontSize: 11, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Exit demo
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <TopBar />
          <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>{children}</main>
        </div>
      </div>
    </div>
  );
}
