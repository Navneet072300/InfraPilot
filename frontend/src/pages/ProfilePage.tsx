import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, Activity, Code2, GitBranch, Cpu, Box,
  Settings, CreditCard, Loader2, ChevronRight, Clock,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import type { ProfileStats, ActivityItem, SavedCodeItem, SavedArchItem } from '../types/profile';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)', purple: 'var(--accent)',
} as const;

const PLAN_COLOR: Record<string, string> = { free: 'var(--text-secondary)', pro: 'var(--accent)', team: 'var(--accent)', enterprise: 'var(--accent)' };
const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
const PLAN_LIMITS: Record<string, { requests: number }> = {
  free: { requests: 50 }, pro: { requests: 2000 }, team: { requests: 10000 }, enterprise: { requests: 999999 },
};

async function apiFetch(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  pipeline: <GitBranch size={14} />, generate: <Code2 size={14} />,
  diagnose: <Cpu size={14} />, deploy: <Box size={14} />,
  login: <User size={14} />, default: <Activity size={14} />,
};
const ACTION_COLOR: Record<string, string> = {
  pipeline: 'var(--accent)', generate: 'var(--accent)', diagnose: 'var(--warning)',
  deploy: 'var(--success)', login: 'var(--text-secondary)', default: 'var(--text-secondary)',
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [savedCode, setSavedCode] = useState<SavedCodeItem[]>([]);
  const [savedArch, setSavedArch] = useState<SavedArchItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [actLoading, setActLoading] = useState(true);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedTab, setSavedTab] = useState<'code' | 'arch'>('code');

  useEffect(() => {
    apiFetch('/api/profile/stats').then(setStats).catch(() => {}).finally(() => setStatsLoading(false));
    apiFetch('/api/profile/activity?limit=20').then((d) => setActivity(d.activity || [])).catch(() => {}).finally(() => setActLoading(false));
    Promise.all([
      apiFetch('/api/profile/saved-code').then((d) => setSavedCode(d.items || [])).catch(() => {}),
      apiFetch('/api/profile/saved-architectures').then((d) => setSavedArch(d.items || [])).catch(() => {}),
    ]).finally(() => setSavedLoading(false));
  }, []);

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: V.muted }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const planKey = user.plan as string;
  const planColor = PLAN_COLOR[planKey] ?? V.muted;
  const initials = user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
  const successRate = stats && stats.deployments_total > 0
    ? Math.round((stats.deployments_successful / stats.deployments_total) * 100)
    : null;
  const usedRequests = (stats?.pipelines_run ?? 0) + (stats?.files_generated ?? 0) + (stats?.pods_diagnosed ?? 0);
  const limits = PLAN_LIMITS[planKey] ?? PLAN_LIMITS.free;
  const usagePct = Math.min(100, Math.round((usedRequests / limits.requests) * 100));
  const usageColor = usagePct >= 90 ? V.red : usagePct >= 70 ? V.yellow : V.accent;

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 900, margin: '0 auto' }}>
      {/* Identity card */}
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, var(--accent), #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700, color: '#fff' }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, color: V.text, fontWeight: 700, fontSize: '1.25rem' }}>{user.name}</h1>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', color: planColor, background: `${planColor}18`, border: `1px solid ${planColor}44`, borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase' }}>
              {PLAN_LABEL[planKey] ?? planKey}
            </span>
          </div>
          <div style={{ color: V.muted, fontSize: '0.875rem', marginBottom: '0.875rem' }}>{user.email}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => navigate('/app/settings')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.875rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.82rem' }}>
              <Settings size={13} /> Edit Profile
            </button>
            <button type="button" onClick={() => navigate('/app/subscription')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.875rem', borderRadius: 8, border: `1px solid ${planColor}55`, background: `${planColor}10`, color: planColor, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500 }}>
              <CreditCard size={13} /> {planKey === 'free' ? 'Upgrade Plan' : 'Manage Plan'}
            </button>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, height: 88 }} />)
          : [
            { icon: <Code2 size={16} />, label: 'Files Generated', value: stats?.files_generated ?? 0, sub: 'this month', color: V.purple },
            { icon: <GitBranch size={16} />, label: 'Pipelines Run', value: stats?.pipelines_run ?? 0, sub: 'this month', color: V.accent },
            { icon: <Cpu size={16} />, label: 'Pods Diagnosed', value: stats?.pods_diagnosed ?? 0, sub: 'this month', color: V.yellow },
            { icon: <Box size={16} />, label: 'Deploy Success', value: successRate !== null ? `${successRate}%` : '—', sub: stats?.deployments_total ? `${stats.deployments_total} total` : 'no data', color: successRate !== null && successRate >= 90 ? V.green : V.muted },
          ].map(({ icon, label, value, sub, color }) => (
            <div key={label} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem 1.125rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.625rem' }}>
                <span style={{ color }}>{icon}</span>
                <span style={{ color: V.muted, fontSize: '0.78rem', fontWeight: 500 }}>{label}</span>
              </div>
              <div style={{ color: V.text, fontWeight: 700, fontSize: '1.6rem', lineHeight: 1 }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
              <div style={{ color: V.muted, fontSize: '0.72rem', marginTop: 4 }}>{sub}</div>
            </div>
          ))}
      </div>

      {/* Plan usage bar */}
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ color: V.text, fontSize: '0.875rem', fontWeight: 600 }}>Monthly Usage</span>
          <span style={{ color: V.muted, fontSize: '0.78rem' }}>
            {usedRequests.toLocaleString()} / {limits.requests === 999999 ? 'Unlimited' : limits.requests.toLocaleString()} requests
          </span>
        </div>
        <div style={{ height: 6, background: V.border, borderRadius: 3, overflow: 'hidden', marginBottom: '0.5rem' }}>
          <div style={{ height: '100%', width: `${usagePct}%`, background: usageColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', color: usageColor }}>{usagePct}% used this month</span>
          {usagePct >= 70 && (
            <button type="button" onClick={() => navigate('/app/subscription')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: V.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Upgrade <ChevronRight size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Two-column: activity + saved */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        {/* Activity feed */}
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1.25rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={15} color={V.accent} />
            <span style={{ color: V.text, fontWeight: 600, fontSize: '0.875rem' }}>Recent Activity</span>
          </div>
          <div style={{ padding: '0 1.25rem', maxHeight: 400, overflowY: 'auto' }}>
            {actLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem', color: V.muted }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            ) : activity.length === 0 ? (
              <div style={{ color: V.muted, fontSize: '0.875rem', padding: '1.5rem', textAlign: 'center' }}>No recent activity.</div>
            ) : activity.map((item, i) => {
              const cat = item.action.split('_')[0];
              const icon = ACTION_ICON[cat] ?? ACTION_ICON.default;
              const color = ACTION_COLOR[cat] ?? ACTION_COLOR.default;
              return (
                <div key={item.id} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem 0', borderBottom: i < activity.length - 1 ? `1px solid ${V.border}` : 'none' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${color}18`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
                    {icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: V.text, fontSize: '0.82rem' }}>{item.description}</div>
                    {item.resource && <div style={{ color: V.muted, fontSize: '0.72rem', fontFamily: 'monospace', marginTop: 2 }}>{item.resource}</div>}
                  </div>
                  <div style={{ color: V.muted, fontSize: '0.72rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Clock size={10} /> {item.time_ago}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Saved items */}
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.625rem 1.25rem', borderBottom: `1px solid ${V.border}`, display: 'flex', gap: 4 }}>
            {([['code', 'Saved Code', <Code2 size={13} />], ['arch', 'Architectures', <Box size={13} />]] as const).map(([key, label, icon]) => (
              <button key={key} type="button" onClick={() => setSavedTab(key as 'code' | 'arch')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.35rem 0.7rem', borderRadius: 6, border: 'none', background: savedTab === key ? V.bg : 'transparent', color: savedTab === key ? V.text : V.muted, cursor: 'pointer', fontSize: '0.8rem', fontWeight: savedTab === key ? 600 : 400 }}>
                {icon} {label}
              </button>
            ))}
          </div>
          <div style={{ padding: '0.75rem 1.25rem', maxHeight: 400, overflowY: 'auto' }}>
            {savedLoading ? (
              <div style={{ color: V.muted, padding: '1.5rem', textAlign: 'center' }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /></div>
            ) : savedTab === 'code' ? (
              savedCode.length === 0
                ? <div style={{ color: V.muted, fontSize: '0.875rem', padding: '1.5rem', textAlign: 'center' }}>No saved generations yet.</div>
                : savedCode.map((item) => (
                  <div key={item.id} style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.75rem', marginBottom: 6 }}>
                    <div style={{ color: V.text, fontSize: '0.82rem', fontWeight: 500, marginBottom: 4 }}>{item.prompt.slice(0, 80)}{item.prompt.length > 80 ? '…' : ''}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', color: V.accent, background: 'rgba(88,166,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>{item.tool}</span>
                      {item.files.slice(0, 2).map((f) => <span key={f} style={{ fontSize: '0.68rem', color: V.muted, fontFamily: 'monospace', background: V.surface, borderRadius: 4, padding: '1px 5px' }}>{f}</span>)}
                      <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: V.muted }}>{new Date(item.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))
            ) : (
              savedArch.length === 0
                ? <div style={{ color: V.muted, fontSize: '0.875rem', padding: '1.5rem', textAlign: 'center' }}>No saved architectures yet.</div>
                : savedArch.map((item) => (
                  <div key={item.id} style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.75rem', marginBottom: 6 }}>
                    <div style={{ color: V.text, fontSize: '0.82rem' }}>{item.requirements.slice(0, 100)}{item.requirements.length > 100 ? '…' : ''}</div>
                    <div style={{ color: V.muted, fontSize: '0.68rem', marginTop: 4 }}>{new Date(item.created_at).toLocaleDateString()}</div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
