import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Search, CheckCircle2, XCircle, Filter, ChevronLeft, ChevronRight } from 'lucide-react';

interface AuditEntry {
  id: number;
  user_email: string;
  action: string;
  resource: string;
  ip_address: string;
  status: string;
  details: string | null;
  created_at: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  limit: number;
}

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  'pipeline.run':       { label: 'Pipeline',   color: 'var(--accent)', bg: 'rgba(167,139,250,0.12)' },
  'pipeline.abort':     { label: 'Pipeline',   color: 'var(--accent)', bg: 'rgba(167,139,250,0.12)' },
  'diagnose':           { label: 'Diagnose',   color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  'kubectl':            { label: 'Kubectl',    color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  'login':              { label: 'Auth',       color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  'logout':             { label: 'Auth',       color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  'password.changed':   { label: 'Account',   color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  '2fa.enabled':        { label: 'Security',  color: 'var(--success)', bg: 'rgba(52,211,153,0.1)'  },
  '2fa.disabled':       { label: 'Security',  color: 'var(--error)', bg: 'rgba(248,113,113,0.1)' },
};

const ACTION_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pipeline.run', label: 'Pipeline' },
  { value: 'diagnose', label: 'Diagnose' },
  { value: 'kubectl', label: 'Kubectl' },
  { value: 'login', label: 'Auth' },
];

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatAction(action: string): string {
  return action.replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function ActionBadge({ action }: { action: string }) {
  const key = Object.keys(ACTION_LABELS).find((k) => action.startsWith(k)) ?? '';
  const meta = ACTION_LABELS[key] ?? { label: 'Other', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 100, color: meta.color, background: meta.bg, whiteSpace: 'nowrap' }}>
      {meta.label}
    </span>
  );
}

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const LIMIT = 50;

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ['audit-log', page, search, actionFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (search) params.set('search', search);
      if (actionFilter) params.set('action_type', actionFilter);
      const r = await fetch(`/api/audit-log?${params}`);
      if (!r.ok) throw new Error('Failed to load history');
      return r.json();
    },
    staleTime: 30_000,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  function applySearch() {
    setSearch(searchInput);
    setPage(1);
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-base)', padding: '28px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Clock size={22} style={{ color: 'var(--accent)' }} />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Activity History</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            {total > 0 ? `${total} events recorded` : 'All pipeline runs, diagnose sessions, and k8s operations'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Search actions, resources…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>

        {/* Action filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Filter size={13} style={{ color: 'var(--text-muted)' }} />
          <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {ACTION_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => { setActionFilter(f.value); setPage(1); }}
                style={{ padding: '7px 13px', background: actionFilter === f.value ? 'var(--accent)' : 'transparent', border: 'none', color: actionFilter === f.value ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: actionFilter === f.value ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <Clock size={36} style={{ opacity: 0.2, marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No activity yet</p>
          <p style={{ fontSize: 13 }}>
            {search || actionFilter ? 'No events match your filter.' : 'Run a pipeline or diagnose a cluster and activity will appear here.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!isLoading && entries.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 180px 90px 100px', gap: 0, padding: '9px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}>
            {['Action', 'Type', 'Resource', 'Status', 'When'].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {entries.map((e, idx) => (
            <div
              key={e.id}
              style={{ display: 'grid', gridTemplateColumns: '1fr 120px 180px 90px 100px', gap: 0, padding: '11px 16px', borderBottom: idx < entries.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center', transition: 'background 0.1s' }}
              onMouseEnter={(el) => (el.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(el) => (el.currentTarget.style.background = 'transparent')}
            >
              {/* Action */}
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatAction(e.action)}
                </p>
                {e.details && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.details}
                  </p>
                )}
              </div>

              {/* Type badge */}
              <div><ActionBadge action={e.action} /></div>

              {/* Resource */}
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.resource || '—'}
              </div>

              {/* Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {e.status === 'success' || e.status === 'ok'
                  ? <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
                  : <XCircle size={13} style={{ color: 'var(--error)', flexShrink: 0 }} />}
                <span style={{ fontSize: 12, color: e.status === 'success' || e.status === 'ok' ? 'var(--success)' : 'var(--error)', textTransform: 'capitalize' }}>
                  {e.status}
                </span>
              </div>

              {/* When */}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={new Date(e.created_at).toLocaleString()}>
                {timeAgo(e.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Page {page} of {totalPages} · {total} total events
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: page === 1 ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 12, cursor: page === 1 ? 'not-allowed' : 'pointer' }}
            >
              <ChevronLeft size={13} /> Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: page === totalPages ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 12, cursor: page === totalPages ? 'not-allowed' : 'pointer' }}
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
