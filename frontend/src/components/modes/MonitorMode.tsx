import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, AlertTriangle, RefreshCw, DollarSign,
  BarChart2, Loader2, CheckCircle2, Edit2, X, Eye, EyeOff,
  ShieldAlert, Activity, Trash2, Server, Layers, BellOff, Wrench,
  AlertOctagon, AlertCircle, Info, BarChart3, ThumbsUp,
} from 'lucide-react';
import { useClusterStore } from '../../store/clusterStore';
import { useClusterOverview, useNamespaces, useResources, useNodeMetrics } from '../../hooks/useKubernetes';
import type { ClusterConfig, ClusterOverview } from '../../types';

interface Incident {
  id: string;
  cluster_name: string;
  namespace?: string;
  resource_type: string;
  resource_name: string;
  issue_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  status: 'active' | 'acknowledged' | 'fixing' | 'resolved' | 'auto_resolved';
  detected_at: string;
  acknowledged_at?: string;
  snoozed_until?: string;
}

// ─── Demo data (cost/drift) ───────────────────────────────────────────────────
const SPEND_DATA = [
  { service: 'EC2', monthly: 842, color: '#f97316' },
  { service: 'RDS', monthly: 380, color: 'var(--success)' },
  { service: 'EKS', monthly: 320, color: '#3b82f6' },
  { service: 'CloudFront', monthly: 185, color: '#a855f7' },
  { service: 'S3', monthly: 43, color: '#eab308' },
  { service: 'Other', monthly: 115, color: '#6b7280' },
];
const DRIFT_RESOURCES = [
  { resource: 'aws_security_group.web-sg', type: 'aws_security_group', expected: 'port 443 only', actual: 'ports 443, 8080 open', severity: 'high' as const },
  { resource: 'aws_instance.bastion', type: 'aws_instance', expected: 't3.micro', actual: 't3.medium', severity: 'medium' as const },
  { resource: 'aws_s3_bucket.assets', type: 'aws_s3_bucket', expected: 'versioning: enabled', actual: 'versioning: disabled', severity: 'high' as const },
];
const OPTIMIZATIONS = [
  { title: 'Right-size EC2 instances', desc: '4 instances at ~15% avg CPU. Downgrade to t3.small.', saving: '$218/mo' },
  { title: 'Reserve 3× RDS instances', desc: '1-year Reserved Instances for predictable workload.', saving: '$148/mo' },
  { title: 'Enable S3 Intelligent-Tiering', desc: 'Move infrequently accessed objects automatically.', saving: '$31/mo' },
  { title: 'Delete 12 unused snapshots', desc: 'Snapshots older than 90 days with no attached volume.', saving: '$22/mo' },
];
const SEV_COLORS: Record<'high' | 'medium' | 'low', string> = { high: 'var(--error)', medium: 'var(--warning)', low: 'var(--info)' };
const maxSpend = Math.max(...SPEND_DATA.map((d) => d.monthly));

// ─── Inline token fix form ────────────────────────────────────────────────────

function isTokenError(error?: string) {
  return error && /401|unauthorized|token.*expir|invalid.*token|authentication|forbidden/i.test(error);
}

interface TokenFixFormProps {
  cluster: ClusterConfig;
  onClose: () => void;
  onSaved: () => void;
}

function TokenFixForm({ cluster, onClose, onSaved }: TokenFixFormProps) {
  const [connType, setConnType] = useState<'token' | 'kubeconfig'>(
    cluster.connection_type === 'kubeconfig' ? 'kubeconfig' : 'token'
  );
  const [apiUrl, setApiUrl] = useState(cluster.api_url ?? '');
  const [token, setToken] = useState('');
  const [kubeconfig, setKubeconfig] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ healthy?: boolean; error?: string; version?: string } | null>(null);
  const [confirmProd, setConfirmProd] = useState(false);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const body: Record<string, string> = { connection_type: connType };
      if (apiUrl) body.api_url = apiUrl;
      if (token) body.token = token;
      if (kubeconfig) body.kubeconfig = kubeconfig;
      const r = await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTestResult(await r.json());
    } catch (e) {
      setTestResult({ healthy: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function doSave() {
    setSaving(true);
    try {
      const body: Record<string, string> = { connection_type: connType };
      if (apiUrl) body.api_url = apiUrl;
      if (token) body.token = token;
      if (kubeconfig) body.kubeconfig = kubeconfig;
      const r = await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Save failed');
      onSaved();
      onClose();
    } catch (e) {
      setTestResult({ healthy: false, error: String(e) });
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (cluster.environment === 'prod') {
      setConfirmProd(true);
    } else {
      doSave();
    }
  }

  const V = { border: 'var(--border)', surface: 'var(--bg-surface)', bg: 'var(--bg-base)', text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)', green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)' };

  return (
    <div style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem', marginTop: '0.5rem' }}>
      {confirmProd && (
        <div style={{ background: 'rgba(248,81,73,0.08)', border: `1px solid ${V.red}`, borderRadius: 8, padding: '0.875rem', marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: V.red, fontWeight: 600, fontSize: '0.875rem' }}>
            <ShieldAlert size={16} /> Production cluster — confirm change
          </div>
          <p style={{ color: V.muted, fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
            You are updating credentials for a <strong style={{ color: V.red }}>PRODUCTION</strong> cluster. Are you sure?
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={() => setConfirmProd(false)} style={{ flex: 1, padding: '0.4rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.8rem' }}>
              Cancel
            </button>
            <button type="button" onClick={doSave} disabled={saving} style={{ flex: 1, padding: '0.4rem', borderRadius: 7, border: 'none', background: V.red, color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
              {saving ? '...' : 'Confirm Update'}
            </button>
          </div>
        </div>
      )}

      {/* Connection type */}
      <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.75rem' }}>
        {([{ val: 'token', label: 'Bearer Token' }, { val: 'kubeconfig', label: 'Kubeconfig' }] as { val: 'token' | 'kubeconfig'; label: string }[]).map(({ val, label }) => (
          <button key={val} type="button" onClick={() => setConnType(val)}
            style={{ flex: 1, padding: '0.3rem', borderRadius: 7, border: `1px solid ${connType === val ? V.accent : V.border}`, background: connType === val ? 'rgba(88,166,255,0.08)' : 'transparent', color: connType === val ? V.accent : V.muted, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500 }}>
            {label}
          </button>
        ))}
      </div>

      {connType === 'token' ? (
        <>
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="API URL (e.g. https://k8s.example.com:6443)"
            style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.425rem 0.625rem', color: V.text, fontSize: '0.8rem', marginBottom: '0.5rem', boxSizing: 'border-box' }}
          />
          <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="New bearer token..."
              style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.425rem 2.25rem 0.425rem 0.625rem', color: V.text, fontSize: '0.8rem', boxSizing: 'border-box' }}
            />
            <button type="button" onClick={() => setShowToken(!showToken)}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}>
              {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </>
      ) : (
        <textarea
          value={kubeconfig}
          onChange={(e) => setKubeconfig(e.target.value)}
          placeholder="Paste kubeconfig YAML..."
          rows={4}
          style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.425rem 0.625rem', color: V.text, fontSize: '0.78rem', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', marginBottom: '0.5rem' }}
        />
      )}

      {testResult && (
        <div style={{ borderRadius: 7, padding: '0.5rem 0.625rem', fontSize: '0.78rem', marginBottom: '0.5rem', background: testResult.healthy ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)', border: `1px solid ${testResult.healthy ? V.green : V.red}`, color: testResult.healthy ? V.green : V.red }}>
          {testResult.healthy ? `✓ ${testResult.version || 'Connected'}` : `✗ ${testResult.error || 'Connection failed'}`}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={handleTest} disabled={testing}
          style={{ padding: '0.375rem 0.75rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.text, cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          {testing ? <Loader2 size={12} /> : <CheckCircle2 size={12} />} Test
        </button>
        <button type="button" onClick={onClose}
          style={{ padding: '0.375rem 0.75rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.78rem' }}>
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={saving || (!token && !kubeconfig && !apiUrl)}
          style={{ padding: '0.375rem 0.875rem', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {saving ? '...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Per-cluster health card ───────────────────────────────────────────────────

function ClusterHealthCard({ cluster }: { cluster: ClusterConfig }) {
  const qc = useQueryClient();
  const { setActiveCluster, removeCluster } = useClusterStore();
  const [showFix, setShowFix] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}`, { method: 'DELETE' });
      removeCluster(cluster.name);
    } catch {
      // removed from store regardless
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  const { data: health, isFetching } = useQuery({
    queryKey: ['monitor-health', cluster.name],
    queryFn: async () => {
      const r = await fetch(`/api/k8s/health?cluster=${encodeURIComponent(cluster.name)}`);
      return r.json() as Promise<{ healthy: boolean; error?: string; version?: string; cluster_name?: string }>;
    },
    refetchInterval: 30_000,
  });

  const healthy = health?.healthy;
  const tokenExpired = !healthy && isTokenError(health?.error);
  const errorMsg = health?.error;

  const envColor = cluster.environment === 'prod' ? 'var(--error)' : cluster.environment === 'staging' ? 'var(--warning)' : 'var(--success)';

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['monitor-health', cluster.name] });
    qc.invalidateQueries({ queryKey: ['cluster-overview'] });
  }

  return (
    <div style={{
      background: 'var(--bg-base)',
      border: `1px solid ${healthy === undefined ? 'var(--border)' : healthy ? 'rgba(63,185,80,0.35)' : 'rgba(248,81,73,0.35)'}`,
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Status dot */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {isFetching ? (
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
            ) : (
              <div style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: healthy === undefined ? 'var(--border)' : healthy ? 'var(--success)' : 'var(--error)',
                boxShadow: healthy ? '0 0 6px var(--success)66' : healthy === false ? '0 0 6px var(--error)66' : 'none',
              }} />
            )}
          </div>

          {/* Name + badges */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '13px' }}>{cluster.name}</span>
              {cluster.active && (
                <span style={{ background: 'rgba(88,166,255,0.12)', color: 'var(--accent)', borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: 700 }}>ACTIVE</span>
              )}
              <span style={{ background: `${envColor}18`, color: envColor, borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: 600 }}>{cluster.environment.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {healthy
                ? `✓ Connected · ${health?.version || 'cluster reachable'}`
                : healthy === false
                ? (tokenExpired ? '✗ Token expired or invalid' : `✗ ${errorMsg?.slice(0, 60) || 'Unreachable'}`)
                : 'Checking...'}
            </div>
          </div>

          {/* Right actions */}
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
            {!cluster.active && (
              <button type="button" onClick={() => setActiveCluster(cluster.name)}
                style={{ padding: '3px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}>
                Activate
              </button>
            )}
            <button type="button" onClick={() => setShowFix(!showFix)} title={tokenExpired ? 'Fix Token' : 'Edit Credentials'}
              style={{ padding: '4px 8px', background: tokenExpired ? 'rgba(248,81,73,0.1)' : 'transparent', border: `1px solid ${tokenExpired ? 'var(--error)' : 'var(--border)'}`, borderRadius: '5px', color: tokenExpired ? 'var(--error)' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: tokenExpired ? 600 : 400 }}>
              {tokenExpired ? (
                <><ShieldAlert size={12} /> Fix Token</>
              ) : (
                <><Edit2 size={12} /> Edit</>
              )}
            </button>
            {showFix && (
              <button type="button" onClick={() => setShowFix(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}>
                <X size={14} />
              </button>
            )}
            <button type="button" onClick={() => setDeleteConfirm(true)} title="Remove cluster"
              style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* Inline fix form */}
      {showFix && (
        <div style={{ padding: '0 12px 12px' }}>
          <TokenFixForm cluster={cluster} onClose={() => setShowFix(false)} onSaved={handleSaved} />
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div style={{ margin: '0 12px 12px', background: 'rgba(248,81,73,0.06)', border: '1px solid rgba(248,81,73,0.35)', borderRadius: 8, padding: '10px 14px' }}>
          <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--error)', margin: '0 0 4px' }}>Remove cluster?</p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{cluster.name}</strong> will be removed from InfraPilot. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" disabled={deleting} onClick={handleDelete}
              style={{ flex: 1, padding: '5px', background: 'var(--error)', border: 'none', borderRadius: 5, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
              {deleting ? 'Removing…' : 'Remove'}
            </button>
            <button type="button" onClick={() => setDeleteConfirm(false)}
              style={{ flex: 1, padding: '5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cluster health section (all clusters) ────────────────────────────────────

function ClusterHealthSection() {
  const { clusters } = useClusterStore();

  if (clusters.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
        No clusters configured. Go to Settings to add a cluster.
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Activity size={14} color="var(--text-primary)" />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Cluster Health</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Polls every 30s</span>
      </div>
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {clusters.map((c) => (
          <ClusterHealthCard key={c.name} cluster={c} />
        ))}
      </div>
    </div>
  );
}

// ─── Usage bar helper ─────────────────────────────────────────────────────────

function UsageBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ height: 5, background: 'var(--bg-hover)', borderRadius: 3, overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${clamped}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  );
}

// ─── Issues panel ────────────────────────────────────────────────────────────

const SEV_COLOR_MAP: Record<string, string> = {
  critical: 'var(--error)',
  high: '#f97316',
  medium: 'var(--warning)',
  low: 'var(--info, #60a5fa)',
};
const SEV_ICON_MAP: Record<string, React.ReactNode> = {
  critical: <AlertOctagon size={10} />,
  high:     <AlertTriangle size={10} />,
  medium:   <AlertCircle size={10} />,
  low:      <Info size={10} />,
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function IssuesPanel({ incidents, summary }: { incidents: Incident[]; summary?: { active: number; snoozed: number; resolved_today: number } }) {
  const qc = useQueryClient();
  const [sevFilter, setSevFilter] = useState<string>('all');
  const [showSnooze, setShowSnooze] = useState<string | null>(null);

  const displayed = incidents.filter((i) => {
    if (i.status === 'resolved' || i.status === 'auto_resolved') return false;
    if (sevFilter !== 'all' && i.severity !== sevFilter) return false;
    return true;
  });

  async function handleAcknowledge(id: string) {
    await fetch(`/api/incidents/${id}/acknowledge`, { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }

  async function handleSnooze(id: string, mins: number) {
    await fetch(`/api/incidents/${id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: mins }),
    });
    setShowSnooze(null);
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }

  async function handleFixAuto(id: string) {
    await fetch(`/api/incidents/${id}/fix-auto`, { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }

  async function handleResolve(id: string, what: string) {
    await fetch(`/api/incidents/${id}/fix-manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ what_changed: what || 'Manually resolved', verification: '' }),
    });
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Active', value: summary?.active ?? 0, color: 'var(--error)' },
          { label: 'Snoozed', value: summary?.snoozed ?? 0, color: 'var(--warning)' },
          { label: 'Resolved Today', value: summary?.resolved_today ?? 0, color: 'var(--success)' },
        ].map((c) => (
          <div key={c.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{c.label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: c.color, lineHeight: 1 }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {['all', 'critical', 'high', 'medium', 'low'].map((sev) => {
          const col = SEV_COLOR_MAP[sev] || 'var(--accent)';
          const active = sevFilter === sev;
          return (
            <button
              key={sev}
              type="button"
              onClick={() => setSevFilter(sev)}
              style={{
                padding: '5px 14px', borderRadius: 100,
                border: `1px solid ${active ? col : `${col}55`}`,
                background: active ? `${col}22` : `${col}0d`,
                color: active ? col : `${col}99`,
                fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
            >
              {sev === 'all' ? 'All' : <>{SEV_ICON_MAP[sev]} {sev}</>}
            </button>
          );
        })}
      </div>

      {/* Incident cards */}
      {displayed.length === 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 32, textAlign: 'center' }}>
          <CheckCircle2 size={28} style={{ color: 'var(--success)', marginBottom: 8 }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No active issues</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>All clusters are healthy. Monitor checks every 60 seconds.</p>
        </div>
      )}

      {displayed.map((inc) => {
        const sev = inc.severity;
        const col = SEV_COLOR_MAP[sev] || 'var(--text-muted)';
        return (
          <div
            key={inc.id}
            style={{ background: 'var(--bg-surface)', border: `1px solid ${col}44`, borderRadius: 10, padding: 16, borderLeft: `3px solid ${col}` }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: col, background: `${col}15`, padding: '2px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {SEV_ICON_MAP[sev]} {sev}
                </span>
                {inc.status === 'acknowledged' && (
                  <span style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 600 }}>ACK</span>
                )}
                {inc.status === 'fixing' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}><Wrench size={10} /> FIXING</span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(inc.detected_at)}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{inc.cluster_name}</span>
            </div>

            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{inc.title}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontFamily: 'monospace' }}>
              {inc.namespace && `${inc.namespace} / `}{inc.resource_name}
            </p>

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleFixAuto(inc.id)}
                style={{ padding: '5px 12px', background: 'var(--accent)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Wrench size={11} /> Fix Now
              </button>
              {inc.status !== 'acknowledged' && (
                <button
                  type="button"
                  onClick={() => handleAcknowledge(inc.id)}
                  style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <ThumbsUp size={11} /> Acknowledge
                </button>
              )}
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowSnooze(showSnooze === inc.id ? null : inc.id)}
                  style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <BellOff size={11} /> Snooze
                </button>
                {showSnooze === inc.id && (
                  <div style={{ position: 'absolute', top: '110%', left: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 10, overflow: 'hidden', minWidth: 120 }}>
                    {[30, 60, 240].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleSnooze(inc.id, m)}
                        style={{ display: 'block', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}
                      >
                        {m === 240 ? '4 hours' : `${m} min`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleResolve(inc.id, inc.title)}
                style={{ padding: '5px 12px', background: 'rgba(87,171,90,0.12)', border: '1px solid var(--success)', borderRadius: 5, color: 'var(--success)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}
              >
                <CheckCircle2 size={11} /> Mark Resolved
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Detailed active cluster overview ─────────────────────────────────────────

function ClusterOverviewPanel() {
  const { activeCluster } = useClusterStore();
  const { data, isFetching, refetch } = useClusterOverview(activeCluster);
  const { data: metricsData } = useNodeMetrics(activeCluster);

  if (!activeCluster) return null;

  const overview = data as ClusterOverview | undefined;
  const nodeMetrics = metricsData?.metrics ?? [];

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Server size={14} color="var(--text-primary)" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Cluster Overview</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{activeCluster}</span>
        </div>
        <button type="button" title="Refresh" onClick={() => refetch()}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
          {isFetching ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
        </button>
      </div>

      {!overview && !isFetching && (
        <div style={{ padding: '14px 16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No overview data — check cluster connection above.</p>
        </div>
      )}
      {isFetching && !overview && (
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Fetching cluster state...
        </div>
      )}

      {overview && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {[
              { label: 'Total Nodes', value: String(overview.nodes?.length ?? '—') },
              { label: 'Ready', value: String(overview.nodes?.filter((n) => n.status === 'Ready').length ?? '—'), color: 'var(--success)' },
              { label: 'Total Pods', value: String(overview.pod_counts?.total ?? '—') },
              { label: 'Running', value: String(overview.pod_counts?.running ?? '—'), color: 'var(--success)' },
            ].map((stat) => (
              <div key={stat.label} style={{ background: 'var(--bg-base)', borderRadius: '6px', padding: '10px 12px' }}>
                <p style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{stat.label}</p>
                <p style={{ fontSize: '20px', fontWeight: 700, color: stat.color ?? 'var(--text-primary)' }}>{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Node table with CPU/memory metrics */}
          {overview.nodes && overview.nodes.length > 0 && (
            <div>
              <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Nodes</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-base)' }}>
                    {['Name', 'Status', 'Roles', 'Version', 'Age', 'CPU', 'Memory'].map((h) => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overview.nodes.map((node, i) => {
                    const m = nodeMetrics.find((nm) => nm.name === node.name);
                    const cpuPct = m ? parseInt(m.cpu_percent) : null;
                    const memPct = m ? parseInt(m.memory_percent) : null;
                    const cpuColor = cpuPct !== null ? (cpuPct > 85 ? 'var(--error)' : cpuPct > 65 ? 'var(--warning)' : 'var(--success)') : 'var(--accent)';
                    const memColor = memPct !== null ? (memPct > 85 ? 'var(--error)' : memPct > 65 ? 'var(--warning)' : 'var(--success)') : 'var(--accent)';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 500 }}>{node.name}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: '10px', fontWeight: 600, background: node.status === 'Ready' ? 'rgba(34,197,94,0.1)' : 'rgba(248,81,73,0.1)', color: node.status === 'Ready' ? 'var(--success)' : 'var(--error)' }}>
                            {node.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{Array.isArray(node.roles) ? node.roles.join(',') : node.roles}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{node.version}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>{node.age}</td>
                        <td style={{ padding: '8px 10px', minWidth: 120 }}>
                          {m ? (
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>{m.cpu_cores}</span>
                                <span style={{ color: cpuColor, fontWeight: 600 }}>{m.cpu_percent}%</span>
                              </div>
                              <UsageBar pct={cpuPct!} color={cpuColor} />
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>no metrics-server</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', minWidth: 120 }}>
                          {m ? (
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>{m.memory_bytes}</span>
                                <span style={{ color: memColor, fontWeight: 600 }}>{m.memory_percent}%</span>
                              </div>
                              <UsageBar pct={memPct!} color={memColor} />
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Warning events */}
          {overview.warning_events && overview.warning_events.length > 0 && (
            <div>
              <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Warning Events</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {overview.warning_events.slice(0, 5).map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', padding: '5px 8px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '4px', fontSize: '12px' }}>
                    <span style={{ color: 'var(--warning)', fontWeight: 600, whiteSpace: 'nowrap' }}>{ev.reason}</span>
                    <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.namespace}: {ev.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Resource Explorer (kubectl get all -n namespace) ─────────────────────────

type ResTab = 'pods' | 'services' | 'deployments' | 'statefulsets' | 'daemonsets' | 'replicasets';

const STATUS_COLOR: Record<string, string> = {
  Running: 'var(--success)',
  Succeeded: 'var(--success)',
  Pending: 'var(--warning)',
  Failed: 'var(--error)',
  CrashLoopBackOff: 'var(--error)',
  OOMKilled: 'var(--error)',
  ImagePullBackOff: 'var(--error)',
  Terminating: 'var(--warning)',
};

function ResourceExplorerPanel() {
  const { activeCluster } = useClusterStore();
  const [namespace, setNamespace] = useState('default');
  const [activeTab, setActiveTab] = useState<ResTab>('pods');

  const { data: nsData } = useNamespaces(activeCluster);
  const { data, isFetching, refetch } = useResources(activeCluster, namespace);

  if (!activeCluster) return null;

  const namespaces = nsData?.namespaces ?? ['default'];
  type AnyResource = Record<string, unknown>;
  const pods = (data?.pods ?? []) as AnyResource[];
  const services = (data?.services ?? []) as AnyResource[];
  const deployments = (data?.deployments ?? []) as AnyResource[];
  const statefulsets = (data?.statefulsets ?? []) as AnyResource[];
  const daemonsets = (data?.daemonsets ?? []) as AnyResource[];
  const replicasets = (data?.replicasets ?? []) as AnyResource[];

  const counts: Record<ResTab, number> = {
    pods: pods.length,
    services: services.length,
    deployments: deployments.length,
    statefulsets: statefulsets.length,
    daemonsets: daemonsets.length,
    replicasets: replicasets.length,
  };

  const TABS: { id: ResTab; label: string }[] = [
    { id: 'pods', label: 'Pods' },
    { id: 'services', label: 'Services' },
    { id: 'deployments', label: 'Deployments' },
    { id: 'statefulsets', label: 'StatefulSets' },
    { id: 'daemonsets', label: 'DaemonSets' },
    { id: 'replicasets', label: 'ReplicaSets' },
  ];

  const TH = ({ children }: { children: React.ReactNode | string | number }) => (
    <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: 'var(--bg-base)' }}>
      {children}
    </th>
  );
  const TD = ({ children, mono, color }: { children: React.ReactNode; mono?: boolean; color?: string }) => (
    <td style={{ padding: '7px 12px', fontSize: '12px', color: color ?? 'var(--text-secondary)', fontFamily: mono ? 'monospace' : undefined, borderBottom: '1px solid var(--border)' }}>
      {children}
    </td>
  );

  const statusBadge = (s: string) => {
    const color = STATUS_COLOR[s] ?? 'var(--text-muted)';
    return (
      <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: '11px', fontWeight: 600, background: `${color}18`, color, border: `1px solid ${color}44` }}>
        {s}
      </span>
    );
  };

  const ageTd = (r: AnyResource) => <TD color="var(--text-muted)">{String(r.age ?? '—')}</TD>;

  const renderTable = () => {
    if (isFetching && !data) {
      return (
        <div style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '12px' }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading resources…
        </div>
      );
    }

    if (activeTab === 'pods') {
      if (!pods.length) return <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>No pods in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Ready</TH><TH>Status</TH><TH>Restarts</TH><TH>Age</TH><TH>Node</TH></tr></thead>
          <tbody>
            {pods.map((p, i) => (
              <tr key={i}>
                <TD mono color="var(--text-primary)">{String(p.name)}</TD>
                <TD>{String(p.ready ?? '—')}</TD>
                <TD>{statusBadge(String(p.status ?? 'Unknown'))}</TD>
                <TD color={(p.restarts as number) > 0 ? 'var(--warning)' : undefined}>{String(p.restarts ?? 0)}</TD>
                {ageTd(p)}
                <TD mono>{String(p.node ?? '—')}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeTab === 'services') {
      if (!services.length) return <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>No services in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Type</TH><TH>Cluster-IP</TH><TH>External-IP</TH><TH>Port(s)</TH><TH>Age</TH></tr></thead>
          <tbody>
            {services.map((s, i) => (
              <tr key={i}>
                <TD mono color="var(--text-primary)">{String(s.name)}</TD>
                <TD>{String(s.type ?? 'ClusterIP')}</TD>
                <TD mono>{String(s.cluster_ip ?? '—')}</TD>
                <TD mono>{String(s.external_ip ?? '<none>')}</TD>
                <TD mono>{String(s.ports ?? '<none>')}</TD>
                {ageTd(s)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeTab === 'deployments') {
      if (!deployments.length) return <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>No deployments in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Ready</TH><TH>Up-to-date</TH><TH>Available</TH><TH>Age</TH></tr></thead>
          <tbody>
            {deployments.map((d, i) => (
              <tr key={i}>
                <TD mono color="var(--text-primary)">{String(d.name)}</TD>
                <TD>{String(d.ready ?? '—')}</TD>
                <TD>{String(d.up_to_date ?? '—')}</TD>
                <TD>{String(d.available ?? '—')}</TD>
                {ageTd(d)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeTab === 'statefulsets') {
      if (!statefulsets.length) return <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>No statefulsets in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Ready</TH><TH>Age</TH></tr></thead>
          <tbody>
            {statefulsets.map((s, i) => (
              <tr key={i}>
                <TD mono color="var(--text-primary)">{String(s.name)}</TD>
                <TD>{String(s.ready ?? '—')}</TD>
                {ageTd(s)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeTab === 'daemonsets') {
      if (!daemonsets.length) return <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>No daemonsets in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Desired</TH><TH>Current</TH><TH>Ready</TH><TH>Up-to-date</TH><TH>Available</TH><TH>Age</TH></tr></thead>
          <tbody>
            {daemonsets.map((d, i) => (
              <tr key={i}>
                <TD mono color="var(--text-primary)">{String(d.name)}</TD>
                <TD>{String(d.desired ?? '—')}</TD>
                <TD>{String(d.current ?? '—')}</TD>
                <TD>{String(d.ready ?? '—')}</TD>
                <TD>{String(d.up_to_date ?? '—')}</TD>
                <TD>{String(d.available ?? '—')}</TD>
                {ageTd(d)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeTab === 'replicasets') {
      if (!replicasets.length) return <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>No replicasets in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Desired</TH><TH>Current</TH><TH>Ready</TH><TH>Age</TH></tr></thead>
          <tbody>
            {replicasets.map((r, i) => (
              <tr key={i}>
                <TD mono color="var(--text-primary)">{String(r.name)}</TD>
                <TD>{String(r.desired ?? '—')}</TD>
                <TD>{String(r.current ?? '—')}</TD>
                <TD>{String(r.ready ?? '—')}</TD>
                {ageTd(r)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    return null;
  };

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <Layers size={14} color="var(--text-primary)" />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Resources</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>kubectl get all -n {namespace}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            style={{ padding: '3px 8px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer' }}
          >
            {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
          </select>
          <button type="button" onClick={() => refetch()}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
            {isFetching ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map((tab) => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: activeTab === tab.id ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', transition: 'color 0.15s',
            }}>
            {tab.label}
            {counts[tab.id] > 0 && (
              <span style={{ background: activeTab === tab.id ? 'var(--accent)' : 'var(--bg-hover)', color: activeTab === tab.id ? '#fff' : 'var(--text-muted)', borderRadius: 10, padding: '0 5px', fontSize: '10px', fontWeight: 700 }}>
                {counts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        {renderTable()}
      </div>
    </div>
  );
}

// ─── Main MonitorMode ──────────────────────────────────────────────────────────

type MonitorTab = 'issues' | 'health' | 'resources';

export function MonitorMode() {
  const totalSpend = SPEND_DATA.reduce((s, d) => s + d.monthly, 0);
  const vsLastMonth = -4.2;
  const budget = 2500;
  const budgetPct = Math.round((totalSpend / budget) * 100);
  const [activeTab, setActiveTab] = useState<MonitorTab>('issues');

  // Incidents polling
  const { data: incidentsData } = useQuery({
    queryKey: ['incidents'],
    queryFn: async () => {
      const r = await fetch('/api/incidents');
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const incidents: Incident[] = incidentsData?.incidents ?? [];
  const activeIncidentCount = incidents.filter((i) => i.status === 'active').length;

  const tabs: { id: MonitorTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'issues',    label: 'Issues',         icon: <AlertTriangle size={13} />, badge: activeIncidentCount || undefined },
    { id: 'health',    label: 'Cluster Health', icon: <Activity size={13} /> },
    { id: 'resources', label: 'Resources',      icon: <BarChart3 size={13} /> },
  ];

  return (
    <div style={{ padding: '20px', overflow: 'auto', height: '100%' }}>
      <div style={{ maxWidth: '1100px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Tab bar */}
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 0 }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 18px', background: 'none', border: 'none',
                  borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
                  color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 400,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {tab.icon}{tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span style={{ background: 'var(--error)', color: '#fff', borderRadius: 100, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Issues tab */}
        {activeTab === 'issues' && <IssuesPanel incidents={incidents} summary={incidentsData?.summary} />}

        {/* Health tab */}
        {activeTab === 'health' && (
          <>
            {/* ① Cluster health — all clusters, green/red status, inline token fix */}
            <ClusterHealthSection />

            {/* ② Active cluster overview — nodes with CPU/memory bars, warning events */}
            <ClusterOverviewPanel />

            {/* Cost & drift */}
            <>
              <>
                {/* ③ Cost metric cards (demo) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[
            { label: 'Total Spend', value: `$${totalSpend.toLocaleString()}`, sub: 'This month', icon: <DollarSign size={18} />, color: 'var(--text-primary)' },
            { label: 'vs Last Month', value: `${vsLastMonth}%`, sub: '-$79 lower', icon: <TrendingDown size={18} />, color: 'var(--success)' },
            { label: 'Budget Usage', value: `${budgetPct}%`, sub: `$${(budget - totalSpend).toLocaleString()} remaining`, icon: <BarChart2 size={18} />, color: budgetPct > 90 ? 'var(--error)' : budgetPct > 75 ? 'var(--warning)' : 'var(--text-primary)' },
            { label: 'Projected EOY', value: '$22,740', sub: '+12% YoY', icon: <TrendingUp size={18} />, color: 'var(--warning)' },
          ].map((card) => (
            <div key={card.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</span>
                <span style={{ color: card.color, opacity: 0.7 }}>{card.icon}</span>
              </div>
              <p style={{ fontSize: '24px', fontWeight: 700, color: card.color, lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{card.sub}</p>
            </div>
          ))}
        </div>

        {/* ④ Spend by service + anomaly */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '16px' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px' }}>
            <p style={{ fontWeight: 600, fontSize: '13px', marginBottom: '16px' }}>Spend by Service</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {SPEND_DATA.map((item) => (
                <div key={item.service}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{item.service}</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: item.color }}>${item.monthly}</span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--bg-hover)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(item.monthly / maxSpend) * 100}%`, background: item.color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid var(--error)', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <AlertTriangle size={16} color="var(--error)" />
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>Cost Anomaly Detected</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                EC2 spend is <strong style={{ color: 'var(--error)' }}>40% above forecast</strong> for the past 3 days.
              </p>
              <button type="button" style={{ marginTop: '12px', padding: '5px 12px', background: 'transparent', border: '1px solid var(--error)', borderRadius: '5px', color: 'var(--error)', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                Investigate
              </button>
            </div>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <p style={{ fontWeight: 600, fontSize: '12px', marginBottom: '12px', color: 'var(--text-primary)' }}>Quick Wins</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {OPTIMIZATIONS.slice(0, 2).map((opt) => (
                  <div key={opt.title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{opt.title}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--success)', background: 'rgba(34,197,94,0.1)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', marginLeft: '8px' }}>{opt.saving}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ⑤ Optimizations list */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>Optimization Suggestions</p>
            <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: 600 }}>
              Total potential: ${OPTIMIZATIONS.reduce((s, o) => s + parseInt(o.saving), 0)}/mo
            </span>
          </div>
          <div>
            {OPTIMIZATIONS.map((opt, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: i < OPTIMIZATIONS.length - 1 ? '1px solid var(--border)' : 'none', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>{opt.title}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{opt.desc}</p>
                </div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>{opt.saving}</span>
                <button type="button" style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Apply</button>
              </div>
            ))}
          </div>
        </div>

        {/* ⑥ Drift detection */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
              Infrastructure Drift
              <span style={{ marginLeft: '8px', padding: '2px 8px', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--error)', borderRadius: '4px', color: 'var(--error)', fontSize: '11px', fontWeight: 600 }}>3 drifted</span>
            </p>
            <button type="button" style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
              <RefreshCw size={12} /> Scan Now
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-base)' }}>
                {['Resource', 'Type', 'Expected', 'Actual', 'Severity', 'Action'].map((h) => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DRIFT_RESOURCES.map((row, i) => (
                <tr key={i} style={{ borderBottom: i < DRIFT_RESOURCES.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{row.resource}</td>
                  <td style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{row.type}</td>
                  <td style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--success)' }}>{row.expected}</td>
                  <td style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--error)' }}>{row.actual}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ padding: '2px 8px', background: `${SEV_COLORS[row.severity]}18`, border: `1px solid ${SEV_COLORS[row.severity]}`, borderRadius: '4px', color: SEV_COLORS[row.severity], fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>
                      {row.severity}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <button type="button" style={{ padding: '4px 10px', background: 'var(--accent)', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Sync</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
              </>
            </>
          </>
        )}

        {/* Resources tab */}
        {activeTab === 'resources' && (
          <ResourceExplorerPanel />
        )}

      </div>
    </div>
  );
}
