import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Zap } from 'lucide-react';
import { ClusterToggle } from '../shared/ClusterToggle';
import { useClusterStore } from '../../store/clusterStore';
import { useNamespaces } from '../../hooks/useKubernetes';
import { NotificationBell, NotificationPanel } from './NotificationPanel';
import { UserMenu } from './UserMenu';
import { useAuthStore } from '../../store/authStore';
import { useQuery } from '@tanstack/react-query';

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
        borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <Zap size={11} color={color} fill={color} />
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
        {remaining}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/{limit} AI</span>
      </span>
      <div style={{ width: 36, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
    </button>
  );
}

export function TopBar() {
  const navigate = useNavigate();
  const { activeCluster, activeNamespace, setActiveNamespace } = useClusterStore();
  const { data: nsData } = useNamespaces(activeCluster);
  const [notifOpen, setNotifOpen] = useState(false);
  const { user } = useAuthStore();
  const isFree = !user?.plan || user.plan === 'free';

  const namespaces = nsData?.namespaces ?? ['default'];

  return (
    <header
      style={{
        height: '48px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '10px',
        flexShrink: 0,
      }}
    >
      {/* LEFT: Logo */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', flexShrink: 0 }}
        onClick={() => navigate('/app')}
      >
        <span style={{ fontSize: '15px' }}>⬡</span>
        <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          InfraPilot
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '18px', background: 'var(--border)', flexShrink: 0 }} />

      {/* Cluster pills — left-aligned, right after logo */}
      <ClusterToggle />


      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* FREE plan usage chip */}
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
              padding: '4px 24px 4px 8px',
              borderRadius: '4px',
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
          <ChevronDown size={11} style={{ position: 'absolute', right: '6px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        </div>

        {/* Bell with notification dropdown */}
        <div style={{ position: 'relative' }}>
          <NotificationBell onClick={() => setNotifOpen((o) => !o)} />
          <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>

        <UserMenu />
      </div>
    </header>
  );
}
