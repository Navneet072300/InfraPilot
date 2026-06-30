import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Server,
  Box,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import { useClusterStore } from '../store/clusterStore';

const V = { '--bg': 'var(--bg-base)', '--surface': 'var(--bg-surface)', '--border': 'var(--border)', '--text': 'var(--text-primary)', '--muted': 'var(--text-secondary)', '--accent': 'var(--accent)', '--green': 'var(--success)', '--red': 'var(--error)', '--yellow': 'var(--warning)' } as const;

type Tab = 'nodes' | 'pods' | 'events';

function relativeTime(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

function NodesTab({ cluster }: { cluster: string | null }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['nodes', cluster],
    queryFn: async () => {
      const qs = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
      const r = await fetch(`/api/k8s/nodes${qs}`);
      return (await r.json()) as { nodes: Array<{ name: string; status: string; roles: string[]; version: string; age: string; cpu_capacity?: string; memory_capacity?: string }> };
    },
    refetchInterval: 30_000,
    enabled: !!cluster,
  });

  if (!cluster) return <NoClusterMsg />;
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={String(error)} />;

  const nodes = data?.nodes ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <span style={{ color: V['--muted'], fontSize: '0.825rem' }}>{nodes.length} node{nodes.length !== 1 ? 's' : ''}</span>
        <button type="button" onClick={() => refetch()} style={{ background: 'none', border: `1px solid ${V['--border']}`, color: V['--muted'], borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {nodes.length === 0 ? (
        <Empty msg="No nodes found" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${V['--border']}` }}>
                {['Name', 'Status', 'Roles', 'Version', 'Age', 'CPU', 'Memory'].map((h) => (
                  <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: V['--muted'], fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.name} style={{ borderBottom: `1px solid ${V['--border']}20` }}>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--text'], fontFamily: 'monospace', fontSize: '0.8rem' }}>{n.name}</td>
                  <td style={{ padding: '0.625rem 0.75rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: n.status === 'Ready' ? V['--green'] : V['--red'] }}>
                      {n.status === 'Ready' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      {n.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'] }}>{n.roles?.join(', ') || '—'}</td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'], fontFamily: 'monospace', fontSize: '0.75rem' }}>{n.version}</td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'] }}>{n.age || '—'}</td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'] }}>{n.cpu_capacity || '—'}</td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'] }}>{n.memory_capacity || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Pods ─────────────────────────────────────────────────────────────────────

function PodsTab({ cluster, namespace }: { cluster: string | null; namespace: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pods', cluster, namespace],
    queryFn: async () => {
      const params = new URLSearchParams({ namespace });
      if (cluster) params.set('cluster', cluster);
      const r = await fetch(`/api/k8s/pods?${params}`);
      return (await r.json()) as { pods: Array<{ name: string; namespace: string; status: string; ready: string; restarts: number; age: string; image: string }> };
    },
    refetchInterval: 15_000,
    enabled: !!cluster,
  });

  if (!cluster) return <NoClusterMsg />;
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={String(error)} />;

  const pods = data?.pods ?? [];
  const statusColor = (s: string) => {
    if (s === 'Running') return V['--green'];
    if (s === 'Pending' || s === 'ContainerCreating') return V['--yellow'];
    return V['--red'];
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <span style={{ color: V['--muted'], fontSize: '0.825rem' }}>{pods.length} pod{pods.length !== 1 ? 's' : ''}</span>
        <button type="button" onClick={() => refetch()} style={{ background: 'none', border: `1px solid ${V['--border']}`, color: V['--muted'], borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {pods.length === 0 ? (
        <Empty msg={`No pods in namespace "${namespace}"`} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${V['--border']}` }}>
                {['Name', 'Status', 'Ready', 'Restarts', 'Age', 'Image'].map((h) => (
                  <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: V['--muted'], fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => (
                <tr key={p.name} style={{ borderBottom: `1px solid ${V['--border']}20` }}>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--text'], fontFamily: 'monospace', fontSize: '0.78rem', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ padding: '0.625rem 0.75rem' }}>
                    <span style={{ color: statusColor(p.status), fontWeight: 500 }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'] }}>{p.ready || '—'}</td>
                  <td style={{ padding: '0.625rem 0.75rem', color: p.restarts > 0 ? V['--yellow'] : V['--muted'] }}>{p.restarts}</td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'] }}>{p.age || '—'}</td>
                  <td style={{ padding: '0.625rem 0.75rem', color: V['--muted'], fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.image}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────

function EventsTab({ cluster, namespace }: { cluster: string | null; namespace: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['events', cluster, namespace],
    queryFn: async () => {
      const params = new URLSearchParams({ namespace });
      if (cluster) params.set('cluster', cluster);
      const r = await fetch(`/api/k8s/events?${params}`);
      return (await r.json()) as { events: Array<{ name: string; type: string; reason: string; message: string; namespace: string; object: string; count: number; first_time: string; last_time: string }> };
    },
    refetchInterval: 30_000,
    enabled: !!cluster,
  });

  if (!cluster) return <NoClusterMsg />;
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={String(error)} />;

  const events = data?.events ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <span style={{ color: V['--muted'], fontSize: '0.825rem' }}>{events.length} event{events.length !== 1 ? 's' : ''}</span>
        <button type="button" onClick={() => refetch()} style={{ background: 'none', border: `1px solid ${V['--border']}`, color: V['--muted'], borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {events.length === 0 ? (
        <Empty msg={`No events in namespace "${namespace}"`} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {events.map((ev, i) => (
            <div
              key={`${ev.name}-${i}`}
              style={{
                background: V['--bg'],
                border: `1px solid ${ev.type === 'Warning' ? `${V['--yellow']}44` : V['--border']}`,
                borderRadius: 8,
                padding: '0.625rem 0.875rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                {ev.type === 'Warning' ? (
                  <AlertTriangle size={14} color={V['--yellow']} style={{ flexShrink: 0, marginTop: 2 }} />
                ) : (
                  <CheckCircle2 size={14} color={V['--green']} style={{ flexShrink: 0, marginTop: 2 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ color: V['--text'], fontWeight: 600, fontSize: '0.825rem' }}>{ev.reason}</span>
                    <span style={{ color: V['--muted'], fontSize: '0.75rem', fontFamily: 'monospace' }}>{ev.object}</span>
                    {ev.count > 1 && (
                      <span style={{ color: V['--yellow'], fontSize: '0.7rem', background: 'rgba(210,153,34,0.1)', borderRadius: 4, padding: '1px 5px' }}>×{ev.count}</span>
                    )}
                  </div>
                  <p style={{ margin: 0, color: V['--muted'], fontSize: '0.8rem', wordBreak: 'break-word' }}>{ev.message}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: V['--muted'], fontSize: '0.75rem', flexShrink: 0 }}>
                  <Clock size={11} />
                  {ev.last_time ? relativeTime(ev.last_time) : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Utility components ───────────────────────────────────────────────────────

function Loading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: V['--muted'], gap: 8 }}>
      <Loader2 size={18} className="animate-spin" /> Loading...
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{ background: 'rgba(248,81,73,0.08)', border: `1px solid ${V['--red']}`, borderRadius: 8, padding: '1rem', color: V['--red'], fontSize: '0.875rem' }}>
      {msg}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '2rem', color: V['--muted'], fontSize: '0.875rem', border: `1px dashed ${V['--border']}`, borderRadius: 10 }}>
      {msg}
    </div>
  );
}

function NoClusterMsg() {
  return (
    <div style={{ textAlign: 'center', padding: '3rem', color: V['--muted'], border: `1px dashed ${V['--border']}`, borderRadius: 10 }}>
      <Server size={32} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
      <p style={{ margin: 0, fontSize: '0.9rem' }}>No cluster selected.</p>
      <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>Select a cluster from the top bar to browse resources.</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const { activeCluster, activeNamespace, namespaces } = useClusterStore();
  const [tab, setTab] = useState<Tab>('pods');

  const nsOptions = (activeCluster ? (namespaces[activeCluster] ?? ['default']) : ['default']);

  const [selectedNs, setSelectedNs] = useState(activeNamespace || 'default');

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'nodes', icon: <Server size={14} />, label: 'Nodes' },
    { id: 'pods', icon: <Box size={14} />, label: 'Pods' },
    { id: 'events', icon: <AlertTriangle size={14} />, label: 'Events' },
  ];

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, color: V['--text'], fontWeight: 700, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Server size={22} color={V['--accent']} />
            Resources
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: V['--muted'], fontSize: '0.875rem' }}>
            {activeCluster ? `Browsing ${activeCluster}` : 'Kubernetes resource browser'}
          </p>
        </div>

        {/* Namespace selector */}
        {tab !== 'nodes' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: V['--muted'], fontSize: '0.8rem' }}>Namespace:</span>
            <select
              title="Select namespace"
              value={selectedNs}
              onChange={(e) => setSelectedNs(e.target.value)}
              style={{ background: V['--surface'], border: `1px solid ${V['--border']}`, borderRadius: 8, padding: '0.35rem 0.625rem', color: V['--text'], fontSize: '0.825rem', cursor: 'pointer' }}
            >
              {nsOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', padding: '0.25rem', background: V['--bg'], borderRadius: 10, marginBottom: '1.25rem', border: `1px solid ${V['--border']}`, width: 'fit-content' }}>
        {tabs.map(({ id, icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: 8,
              border: 'none',
              background: tab === id ? V['--surface'] : 'transparent',
              color: tab === id ? V['--text'] : V['--muted'],
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: tab === id ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ background: V['--surface'], border: `1px solid ${V['--border']}`, borderRadius: 12, padding: '1.25rem' }}>
        {tab === 'nodes' && <NodesTab cluster={activeCluster} />}
        {tab === 'pods' && <PodsTab cluster={activeCluster} namespace={selectedNs} />}
        {tab === 'events' && <EventsTab cluster={activeCluster} namespace={selectedNs} />}
      </div>
    </div>
  );
}
