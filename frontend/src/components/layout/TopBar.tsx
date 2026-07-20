import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown, Home, Zap } from 'lucide-react';
import { ClusterToggle } from '../shared/ClusterToggle';
import { useClusterStore } from '../../store/clusterStore';
import { useNamespaces } from '../../hooks/useKubernetes';
import { NotificationBell, NotificationPanel } from './NotificationPanel';
import { UserMenu } from './UserMenu';
import { useAuthStore } from '../../store/authStore';
import { useQuery } from '@tanstack/react-query';

const PAGE_NAMES: Record<string, string> = {
  '/app/deploy':       'Deploy',
  '/app/deployments':  'Deployments',
  '/app/generate':     'Generate',
  '/app/diagnose':     'Diagnose',
  '/app/design':       'Design',
  '/app/monitor':      'Monitor',
  '/app/platforms':    'Platforms',
  '/app/vault':        'Vault',
  '/app/resources':    'Resources',
  '/app/history':      'History',
  '/app/settings':     'Settings',
  '/app/profile':      'Profile',
  '/app/subscription': 'Subscription',
  '/app/help':         'Help',
  '/app/repos':        'Repositories',
};

async function fetchUsage() {
  const r = await fetch('/api/subscription/usage', { credentials: 'include' });
  if (!r.ok) return null;
  return r.json();
}

function FreeUsageChip() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['usage'], queryFn: fetchUsage, refetchInterval: 60_000, retry: false });

  const used = data?.ai_requests?.used ?? 0;
  const limit = 50;
  const remaining = Math.max(0, limit - used);
  const pct = (used / limit) * 100;
  const color = pct >= 90 ? 'var(--error)' : pct >= 70 ? 'var(--warning)' : 'var(--success)';

  return (
    <button
      type="button"
      title={`${remaining} AI requests remaining today. Click to upgrade.`}
      onClick={() => navigate('/app/subscription')}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--bg-hover)', border: '1px solid var(--border)',
        borderRadius: 6, padding: '3px 9px', cursor: 'pointer', flexShrink: 0,
      }}
    >
      <Zap size={11} color={color} fill={color} />
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
        {remaining}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/{limit} AI</span>
      </span>
      <div style={{ width: 34, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
    </button>
  );
}

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeCluster, activeNamespace, setActiveNamespace } = useClusterStore();
  const { data: nsData } = useNamespaces(activeCluster);
  const [notifOpen, setNotifOpen] = useState(false);
  const { user } = useAuthStore();
  const isFree = !user?.plan || user.plan === 'free';

  const namespaces = nsData?.namespaces ?? ['default'];
  const pageName = PAGE_NAMES[location.pathname] ?? 'Dashboard';

  return (
    <header
      style={{
        height: '64px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '12px',
        flexShrink: 0,
      }}
    >
      {/* LEFT: Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => navigate('/app')}
          title="Home"
          style={{
            background: 'none', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer',
            padding: 0, display: 'flex', alignItems: 'center',
          }}
        >
          <Home size={14} />
        </button>
        <span style={{ color: 'var(--border)', fontSize: 16, lineHeight: 1, userSelect: 'none' }}>/</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#bdc2ff' }}>{pageName}</span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

      {/* Cluster dropdown */}
      <ClusterToggle />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Free plan usage chip */}
      {isFree && <FreeUsageChip />}

      {/* RIGHT: Namespace + icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {/* Namespace dropdown */}
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <select
            title="Active namespace"
            value={activeNamespace}
            onChange={(e) => setActiveNamespace(e.target.value)}
            style={{
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              padding: '5px 24px 5px 9px',
              borderRadius: '6px',
              cursor: 'pointer',
              appearance: 'none',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          >
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
          <ChevronDown size={11} style={{ position: 'absolute', right: '7px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        </div>

        {/* Notification bell */}
        <div style={{ position: 'relative' }}>
          <NotificationBell onClick={() => setNotifOpen((o) => !o)} />
          <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>

        <UserMenu />
      </div>
    </header>
  );
}
