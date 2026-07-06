import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, AlertTriangle, RefreshCw, DollarSign,
  BarChart2, Loader2, CheckCircle2, Edit2, X, Eye, EyeOff,
  ShieldAlert, Activity, Trash2, Server, Layers, BellOff, Wrench,
  AlertOctagon, AlertCircle, Info, BarChart3, ThumbsUp, LineChart,
  Bot, Copy, Check, RefreshCcw, Wifi, WifiOff, Clock, ExternalLink, Plug,
} from 'lucide-react';
import { useClusterStore } from '../../store/clusterStore';
import { useClusterOverview, useNamespaces, useResources, useNodeMetrics } from '../../hooks/useKubernetes';
import type { ClusterConfig, ClusterOverview, K8sNode } from '../../types';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:      '#0d0d12',
  surface: '#111118',
  border:  '#1e1e2a',
  rowWarn: '#0f0e0a',
  rowErr:  '#100d0d',
  badgeErr:'#2a1515',
  primary: '#f0f0f5',
  muted:   '#8b8b9e',
  dim:     '#5a5a6e',
  dead:    '#3a3a4a',
  accent:  '#6366f1',
  success: '#22c55e',
  warning: '#f59e0b',
  error:   '#ef4444',
} as const;

function barColor(pct: number) {
  if (pct > 85) return C.error;
  if (pct > 60) return C.warning;
  return C.accent;
}

// ─── Incident type ────────────────────────────────────────────────────────────

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

// ─── Demo data ────────────────────────────────────────────────────────────────

const SPEND_DATA = [
  { service: 'EC2',        monthly: 842, color: '#f97316' },
  { service: 'RDS',        monthly: 380, color: C.success },
  { service: 'EKS',        monthly: 320, color: '#3b82f6' },
  { service: 'CloudFront', monthly: 185, color: '#a855f7' },
  { service: 'S3',         monthly: 43,  color: '#eab308' },
  { service: 'Other',      monthly: 115, color: '#6b7280' },
];
const DRIFT_RESOURCES = [
  { resource: 'aws_security_group.web-sg', type: 'aws_security_group', expected: 'port 443 only', actual: 'ports 443, 8080 open', severity: 'high' as const },
  { resource: 'aws_instance.bastion',      type: 'aws_instance',       expected: 't3.micro',       actual: 't3.medium',           severity: 'medium' as const },
  { resource: 'aws_s3_bucket.assets',      type: 'aws_s3_bucket',      expected: 'versioning: enabled', actual: 'versioning: disabled', severity: 'high' as const },
];
const OPTIMIZATIONS = [
  { title: 'Right-size EC2 instances',     desc: '4 instances at ~15% avg CPU. Downgrade to t3.small.',           saving: '$218/mo' },
  { title: 'Reserve 3× RDS instances',     desc: '1-year Reserved Instances for predictable workload.',           saving: '$148/mo' },
  { title: 'Enable S3 Intelligent-Tiering',desc: 'Move infrequently accessed objects automatically.',              saving: '$31/mo' },
  { title: 'Delete 12 unused snapshots',   desc: 'Snapshots older than 90 days with no attached volume.',         saving: '$22/mo' },
];
const SEV_COLORS: Record<'high' | 'medium' | 'low', string> = { high: C.error, medium: C.warning, low: '#60a5fa' };
const maxSpend = Math.max(...SPEND_DATA.map((d) => d.monthly));

// ─── Token fix form ───────────────────────────────────────────────────────────

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
  const [apiUrl,     setApiUrl]     = useState(cluster.api_url ?? '');
  const [token,      setToken]      = useState('');
  const [kubeconfig, setKubeconfig] = useState('');
  const [showToken,  setShowToken]  = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [testResult, setTestResult] = useState<{ healthy?: boolean; error?: string; version?: string } | null>(null);
  const [confirmProd,setConfirmProd]= useState(false);

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      const body: Record<string, string> = { connection_type: connType };
      if (apiUrl)     body.api_url    = apiUrl;
      if (token)      body.token      = token;
      if (kubeconfig) body.kubeconfig = kubeconfig;
      const r = await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      setTestResult(await r.json());
    } catch (e) { setTestResult({ healthy: false, error: String(e) }); }
    finally { setTesting(false); }
  }

  async function doSave() {
    setSaving(true);
    try {
      const body: Record<string, string> = { connection_type: connType };
      if (apiUrl)     body.api_url    = apiUrl;
      if (token)      body.token      = token;
      if (kubeconfig) body.kubeconfig = kubeconfig;
      const r = await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Save failed');
      onSaved(); onClose();
    } catch (e) { setTestResult({ healthy: false, error: String(e) }); }
    finally { setSaving(false); }
  }

  function handleSave() {
    if (cluster.environment === 'prod') setConfirmProd(true);
    else doSave();
  }

  const V = {
    border: C.border, surface: C.surface, bg: C.bg,
    text: C.primary, muted: C.muted, accent: C.accent,
    green: C.success, red: C.error,
  };

  return (
    <div style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem', marginTop: '0.5rem' }}>
      {confirmProd && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: `1px solid ${V.red}`, borderRadius: 8, padding: '0.875rem', marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: V.red, fontWeight: 600, fontSize: '0.875rem' }}>
            <ShieldAlert size={16} /> Production cluster — confirm change
          </div>
          <p style={{ color: V.muted, fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
            You are updating credentials for a <strong style={{ color: V.red }}>PRODUCTION</strong> cluster. Are you sure?
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={() => setConfirmProd(false)} style={{ flex: 1, padding: '0.4rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
            <button type="button" onClick={doSave} disabled={saving} style={{ flex: 1, padding: '0.4rem', borderRadius: 7, border: 'none', background: V.red, color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
              {saving ? '...' : 'Confirm Update'}
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.75rem' }}>
        {([{ val: 'token', label: 'Bearer Token' }, { val: 'kubeconfig', label: 'Kubeconfig' }] as { val: 'token' | 'kubeconfig'; label: string }[]).map(({ val, label }) => (
          <button key={val} type="button" onClick={() => setConnType(val)} style={{ flex: 1, padding: '0.3rem', borderRadius: 7, border: `1px solid ${connType === val ? V.accent : V.border}`, background: connType === val ? `${V.accent}14` : 'transparent', color: connType === val ? V.accent : V.muted, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500 }}>
            {label}
          </button>
        ))}
      </div>
      {connType === 'token' ? (
        <>
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="API URL (e.g. https://k8s.example.com:6443)"
            style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.425rem 0.625rem', color: V.text, fontSize: '0.8rem', marginBottom: '0.5rem', boxSizing: 'border-box' }} />
          <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
            <input type={showToken ? 'text' : 'password'} value={token} onChange={(e) => setToken(e.target.value)} placeholder="New bearer token..."
              style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.425rem 2.25rem 0.425rem 0.625rem', color: V.text, fontSize: '0.8rem', boxSizing: 'border-box' }} />
            <button type="button" onClick={() => setShowToken(!showToken)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}>
              {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </>
      ) : (
        <textarea value={kubeconfig} onChange={(e) => setKubeconfig(e.target.value)} placeholder="Paste kubeconfig YAML..." rows={4}
          style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.425rem 0.625rem', color: V.text, fontSize: '0.78rem', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', marginBottom: '0.5rem' }} />
      )}
      {testResult && (
        <div style={{ borderRadius: 7, padding: '0.5rem 0.625rem', fontSize: '0.78rem', marginBottom: '0.5rem', background: testResult.healthy ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${testResult.healthy ? V.green : V.red}`, color: testResult.healthy ? V.green : V.red }}>
          {testResult.healthy ? `✓ ${testResult.version || 'Connected'}` : `✗ ${testResult.error || 'Connection failed'}`}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={handleTest} disabled={testing} style={{ padding: '0.375rem 0.75rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.text, cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          {testing ? <Loader2 size={12} /> : <CheckCircle2 size={12} />} Test
        </button>
        <button type="button" onClick={onClose} style={{ padding: '0.375rem 0.75rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.78rem' }}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving || (!token && !kubeconfig && !apiUrl)} style={{ padding: '0.375rem 0.875rem', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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
  const [showFix,       setShowFix]       = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}`, { method: 'DELETE' });
      removeCluster(cluster.name);
    } catch { /* removed from store regardless */ }
    finally { setDeleting(false); setDeleteConfirm(false); }
  }

  const { data: health, isFetching } = useQuery({
    queryKey: ['monitor-health', cluster.name],
    queryFn: async () => {
      const r = await fetch(`/api/k8s/health?cluster=${encodeURIComponent(cluster.name)}`);
      return r.json() as Promise<{ healthy: boolean; error?: string; version?: string; cluster_name?: string }>;
    },
    refetchInterval: 30_000,
  });

  const healthy      = health?.healthy;
  const tokenExpired = !healthy && isTokenError(health?.error);
  const errorMsg     = health?.error;
  const envColor     = cluster.environment === 'prod' ? C.error : cluster.environment === 'staging' ? C.warning : C.success;

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['monitor-health', cluster.name] });
    qc.invalidateQueries({ queryKey: ['cluster-overview'] });
  }

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${healthy === undefined ? C.border : healthy ? `${C.success}44` : `${C.error}44`}`,
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flexShrink: 0 }}>
            {isFetching ? (
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: C.muted }} />
            ) : (
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: healthy === undefined ? C.border : healthy ? C.success : C.error, boxShadow: healthy ? `0 0 6px ${C.success}66` : healthy === false ? `0 0 6px ${C.error}44` : 'none' }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: C.primary, fontWeight: 600, fontSize: 12, fontFamily: 'monospace' }}>{cluster.name}</span>
              {cluster.active && <span style={{ background: `${C.accent}22`, color: C.accent, borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em' }}>ACTIVE</span>}
              <span style={{ background: `${envColor}18`, color: envColor, borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em' }}>{cluster.environment.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
              {healthy ? `✓ ${health?.version || 'cluster reachable'}` : healthy === false ? (tokenExpired ? '✗ Token expired or invalid' : `✗ ${errorMsg?.slice(0, 60) || 'Unreachable'}`) : 'Checking…'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {!cluster.active && (
              <button type="button" onClick={() => setActiveCluster(cluster.name)} style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, cursor: 'pointer' }}>Activate</button>
            )}
            <button type="button" onClick={() => setShowFix(!showFix)} title={tokenExpired ? 'Fix Token' : 'Edit'} style={{ padding: '3px 8px', background: tokenExpired ? `${C.error}14` : 'transparent', border: `1px solid ${tokenExpired ? C.error : C.border}`, borderRadius: 4, color: tokenExpired ? C.error : C.muted, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontWeight: tokenExpired ? 600 : 400 }}>
              {tokenExpired ? <><ShieldAlert size={10} /> Fix Token</> : <><Edit2 size={10} /> Edit</>}
            </button>
            {showFix && <button type="button" onClick={() => setShowFix(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: '3px' }}><X size={12} /></button>}
            <button type="button" onClick={() => setDeleteConfirm(true)} style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Trash2 size={10} /> Delete
            </button>
          </div>
        </div>
      </div>
      {showFix && (
        <div style={{ padding: '0 10px 10px' }}>
          <TokenFixForm cluster={cluster} onClose={() => setShowFix(false)} onSaved={handleSaved} />
        </div>
      )}
      {deleteConfirm && (
        <div style={{ margin: '0 10px 10px', background: `${C.error}0a`, border: `1px solid ${C.error}44`, borderRadius: 6, padding: '10px 12px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.error, margin: '0 0 4px' }}>Remove cluster?</p>
          <p style={{ fontSize: 11, color: C.muted, margin: '0 0 10px', lineHeight: 1.5 }}>
            <strong style={{ color: C.primary }}>{cluster.name}</strong> will be removed. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 5 }}>
            <button type="button" disabled={deleting} onClick={handleDelete} style={{ flex: 1, padding: '4px', background: C.error, border: 'none', borderRadius: 4, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
              {deleting ? 'Removing…' : 'Remove'}
            </button>
            <button type="button" onClick={() => setDeleteConfirm(false)} style={{ flex: 1, padding: '4px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cluster health section ───────────────────────────────────────────────────

function ClusterHealthSection() {
  const { clusters } = useClusterStore();
  if (clusters.length === 0) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, textAlign: 'center', color: C.dim, fontSize: 12 }}>
        No clusters configured. Go to Settings to add a cluster.
      </div>
    );
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
        <Activity size={12} color={C.muted} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.primary, letterSpacing: '0.05em' }}>Cluster Connections</span>
        <span style={{ fontSize: 10, color: C.dim }}>polls every 30s</span>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {clusters.map((c) => <ClusterHealthCard key={c.name} cluster={c} />)}
      </div>
    </div>
  );
}

// ─── Usage bar ────────────────────────────────────────────────────────────────

function UsageBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${clamped}%`, background: color, borderRadius: 2, transition: 'width 0.4s' }} />
    </div>
  );
}

// ─── Issues panel ────────────────────────────────────────────────────────────

const SEV_COLOR_MAP: Record<string, string> = {
  all:      C.accent,
  critical: C.error,
  high:     '#f97316',
  medium:   C.warning,
  low:      '#60a5fa',
};
const SEV_ICON_MAP: Record<string, React.ReactNode> = {
  critical: <AlertOctagon size={10} />,
  high:     <AlertTriangle size={10} />,
  medium:   <AlertCircle size={10} />,
  low:      <Info size={10} />,
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
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
    await fetch(`/api/incidents/${id}/snooze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: mins }) });
    setShowSnooze(null);
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }
  async function handleFixAuto(id: string) {
    await fetch(`/api/incidents/${id}/fix-auto`, { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }
  async function handleResolve(id: string, what: string) {
    await fetch(`/api/incidents/${id}/fix-manual`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what_changed: what || 'Manually resolved', verification: '' }) });
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: 'Active',         value: summary?.active ?? 0,         color: C.error   },
          { label: 'Snoozed',        value: summary?.snoozed ?? 0,        color: C.warning  },
          { label: 'Resolved Today', value: summary?.resolved_today ?? 0, color: C.success  },
        ].map((card) => (
          <div key={card.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
            <p style={{ fontSize: 10, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{card.label}</p>
            <p style={{ fontSize: 26, fontWeight: 700, color: card.color, lineHeight: 1, fontFamily: 'monospace' }}>{card.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {['all', 'critical', 'high', 'medium', 'low'].map((sev) => {
          const col = SEV_COLOR_MAP[sev];
          const active = sevFilter === sev;
          return (
            <button key={sev} type="button" onClick={() => setSevFilter(sev)} style={{ padding: '4px 12px', borderRadius: 100, border: `1px solid ${active ? col : `${col}55`}`, background: active ? `${col}22` : `${col}0d`, color: active ? col : `${col}99`, fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {sev === 'all' ? 'All' : <>{SEV_ICON_MAP[sev]} {sev}</>}
            </button>
          );
        })}
      </div>

      {displayed.length === 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <CheckCircle2 size={26} style={{ color: C.success, marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: C.primary, marginBottom: 4 }}>No active issues</p>
          <p style={{ fontSize: 11, color: C.dim }}>All clusters are healthy. Monitor checks every 60 seconds.</p>
        </div>
      )}

      {displayed.map((inc) => {
        const col = SEV_COLOR_MAP[inc.severity] || C.muted;
        return (
          <div key={inc.id} style={{ background: C.surface, border: `1px solid ${col}44`, borderRadius: 8, padding: 14, borderLeft: `3px solid ${col}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {inc.issue_type?.startsWith('Anomaly:') ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '2px 7px', borderRadius: 100, border: '1px solid rgba(245,158,11,0.35)', letterSpacing: '0.04em' }}>
                    ~ Anomaly
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: col, background: `${col}15`, padding: '2px 7px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {SEV_ICON_MAP[inc.severity]} {inc.severity}
                  </span>
                )}
                {inc.status === 'acknowledged' && <span style={{ fontSize: 9, color: C.warning, fontWeight: 700 }}>ACK</span>}
                {inc.status === 'fixing' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, color: C.accent, fontWeight: 700 }}><Wrench size={9} /> FIXING</span>}
                <span style={{ fontSize: 10, color: C.dim }}>{timeAgo(inc.detected_at)}</span>
              </div>
              <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{inc.cluster_name}</span>
            </div>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 2 }}>{inc.title}</p>
            <p style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontFamily: 'monospace' }}>{inc.namespace && `${inc.namespace} / `}{inc.resource_name}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => handleFixAuto(inc.id)} style={{ padding: '4px 10px', background: C.accent, border: 'none', borderRadius: 4, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Wrench size={10} /> Fix Now
              </button>
              {inc.status !== 'acknowledged' && (
                <button type="button" onClick={() => handleAcknowledge(inc.id)} style={{ padding: '4px 10px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <ThumbsUp size={10} /> Acknowledge
                </button>
              )}
              <div style={{ position: 'relative' }}>
                <button type="button" onClick={() => setShowSnooze(showSnooze === inc.id ? null : inc.id)} style={{ padding: '4px 10px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <BellOff size={10} /> Snooze
                </button>
                {showSnooze === inc.id && (
                  <div style={{ position: 'absolute', top: '110%', left: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, zIndex: 10, overflow: 'hidden', minWidth: 110 }}>
                    {[30, 60, 240].map((m) => (
                      <button key={m} type="button" onClick={() => handleSnooze(inc.id, m)} style={{ display: 'block', width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: C.primary, fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>
                        {m === 240 ? '4 hours' : `${m} min`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {inc.issue_type?.startsWith('Anomaly:') ? (
                <button type="button" onClick={() => handleSnooze(inc.id, 120)} style={{ padding: '4px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 4, color: '#f59e0b', fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                  <BellOff size={10} /> Dismiss (2h)
                </button>
              ) : (
                <button type="button" onClick={() => handleResolve(inc.id, inc.title)} style={{ padding: '4px 10px', background: `${C.success}12`, border: `1px solid ${C.success}`, borderRadius: 4, color: C.success, fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                  <CheckCircle2 size={10} /> Mark Resolved
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Cluster overview panel ───────────────────────────────────────────────────

function ClusterOverviewPanel() {
  const { activeCluster } = useClusterStore();
  const { data, isFetching, refetch } = useClusterOverview(activeCluster);
  const { data: metricsData } = useNodeMetrics(activeCluster);

  if (!activeCluster) return null;

  const overview = data as ClusterOverview | undefined;
  const nodeMetrics = metricsData?.metrics ?? [];

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Server size={12} color={C.muted} />
          <span style={{ fontSize: 11, fontWeight: 700, color: C.primary }}>Cluster Overview</span>
          <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{activeCluster}</span>
        </div>
        <button type="button" title="Refresh" onClick={() => refetch()} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 3 }}>
          {isFetching ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
        </button>
      </div>

      {!overview && !isFetching && <div style={{ padding: '12px 14px', fontSize: 11, color: C.muted }}>No overview data — check cluster connection.</div>}
      {isFetching && !overview && (
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 11 }}>
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Fetching cluster state…
        </div>
      )}

      {overview && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              { label: 'Total Nodes', value: String(overview.nodes?.length ?? '—') },
              { label: 'Ready',       value: String(overview.nodes?.filter((n) => n.status === 'Ready').length ?? '—'), color: C.success },
              { label: 'Total Pods',  value: String(overview.pod_counts?.total ?? '—') },
              { label: 'Running',     value: String(overview.pod_counts?.running ?? '—'), color: C.success },
            ].map((stat) => (
              <div key={stat.label} style={{ background: C.bg, borderRadius: 6, padding: '9px 11px' }}>
                <p style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{stat.label}</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: stat.color ?? C.primary, fontFamily: 'monospace' }}>{stat.value}</p>
              </div>
            ))}
          </div>

          {overview.nodes && overview.nodes.length > 0 && (
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>Nodes</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    {['Name', 'Status', 'Roles', 'Version', 'Age', 'CPU', 'Memory'].map((h) => (
                      <th key={h} style={{ padding: '5px 9px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overview.nodes.map((node, i) => {
                    const m = nodeMetrics.find((nm) => nm.name === node.name);
                    const cpuPct = m ? parseInt(m.cpu_percent) : null;
                    const memPct = m ? parseInt(m.memory_percent) : null;
                    const cpuColor = cpuPct !== null ? barColor(cpuPct) : C.accent;
                    const memColor = memPct !== null ? barColor(memPct) : C.accent;
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '7px 9px', fontFamily: 'monospace', color: C.primary, fontWeight: 500, fontSize: 11 }}>{node.name}</td>
                        <td style={{ padding: '7px 9px' }}>
                          <span style={{ padding: '2px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: node.status === 'Ready' ? `${C.success}14` : `${C.error}14`, color: node.status === 'Ready' ? C.success : C.error }}>{node.status}</span>
                        </td>
                        <td style={{ padding: '7px 9px', color: C.muted }}>{Array.isArray(node.roles) ? node.roles.join(',') : node.roles}</td>
                        <td style={{ padding: '7px 9px', color: C.dim, fontFamily: 'monospace' }}>{node.version}</td>
                        <td style={{ padding: '7px 9px', color: C.dim }}>{node.age}</td>
                        <td style={{ padding: '7px 9px', minWidth: 110 }}>
                          {m ? (
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 10 }}>
                                <span style={{ color: C.dim }}>{m.cpu_cores}</span>
                                <span style={{ color: cpuColor, fontWeight: 600, fontFamily: 'monospace' }}>{m.cpu_percent}%</span>
                              </div>
                              <UsageBar pct={cpuPct!} color={cpuColor} />
                            </div>
                          ) : <span style={{ color: C.dead, fontSize: 10 }}>no metrics-server</span>}
                        </td>
                        <td style={{ padding: '7px 9px', minWidth: 110 }}>
                          {m ? (
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 10 }}>
                                <span style={{ color: C.dim }}>{Math.round(parseInt(m.memory_bytes) / 1024 / 1024)}Mi</span>
                                <span style={{ color: memColor, fontWeight: 600, fontFamily: 'monospace' }}>{m.memory_percent}%</span>
                              </div>
                              <UsageBar pct={memPct!} color={memColor} />
                            </div>
                          ) : <span style={{ color: C.dead, fontSize: 10 }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {overview.warning_events && overview.warning_events.length > 0 && (
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Warning Events</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {overview.warning_events.slice(0, 5).map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: 7, padding: '4px 8px', background: `${C.warning}0a`, border: `1px solid ${C.warning}33`, borderRadius: 4, fontSize: 11 }}>
                    <span style={{ color: C.warning, fontWeight: 600, whiteSpace: 'nowrap' }}>{ev.reason}</span>
                    <span style={{ color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.namespace}: {ev.message}</span>
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

// ─── Resource explorer ────────────────────────────────────────────────────────

type ResTab = 'pods' | 'services' | 'deployments' | 'statefulsets' | 'daemonsets' | 'replicasets';

const STATUS_COLOR: Record<string, string> = {
  Running: C.success, Succeeded: C.success,
  Pending: C.warning, Terminating: C.warning,
  Failed: C.error, CrashLoopBackOff: C.error, OOMKilled: C.error, ImagePullBackOff: C.error,
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
  const pods        = (data?.pods        ?? []) as AnyResource[];
  const services    = (data?.services    ?? []) as AnyResource[];
  const deployments = (data?.deployments ?? []) as AnyResource[];
  const statefulsets= (data?.statefulsets?? []) as AnyResource[];
  const daemonsets  = (data?.daemonsets  ?? []) as AnyResource[];
  const replicasets = (data?.replicasets ?? []) as AnyResource[];

  const counts: Record<ResTab, number> = { pods: pods.length, services: services.length, deployments: deployments.length, statefulsets: statefulsets.length, daemonsets: daemonsets.length, replicasets: replicasets.length };
  const TABS: { id: ResTab; label: string }[] = [
    { id: 'pods', label: 'Pods' }, { id: 'services', label: 'Services' }, { id: 'deployments', label: 'Deployments' },
    { id: 'statefulsets', label: 'StatefulSets' }, { id: 'daemonsets', label: 'DaemonSets' }, { id: 'replicasets', label: 'ReplicaSets' },
  ];

  const TH = ({ children }: { children: React.ReactNode | string | number }) => (
    <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: C.bg }}>{children}</th>
  );
  const TD = ({ children, mono, color }: { children: React.ReactNode; mono?: boolean; color?: string }) => (
    <td style={{ padding: '7px 10px', fontSize: 11, color: color ?? C.muted, fontFamily: mono ? 'monospace' : undefined, borderBottom: `1px solid ${C.border}` }}>{children}</td>
  );
  const statusBadge = (s: string) => {
    const color = STATUS_COLOR[s] ?? C.muted;
    return <span style={{ padding: '2px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${color}18`, color, border: `1px solid ${color}44` }}>{s}</span>;
  };
  const ageTd = (r: AnyResource) => <TD color={C.dim}>{String(r.age ?? '—')}</TD>;

  const renderTable = () => {
    if (isFetching && !data) return (
      <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 11 }}>
        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading resources…
      </div>
    );
    if (activeTab === 'pods') {
      if (!pods.length) return <div style={{ padding: '16px', fontSize: 11, color: C.muted }}>No pods in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Ready</TH><TH>Status</TH><TH>Restarts</TH><TH>Age</TH><TH>Node</TH></tr></thead>
          <tbody>{pods.map((p, i) => (<tr key={i}><TD mono color={C.primary}>{String(p.name)}</TD><TD>{String(p.ready ?? '—')}</TD><TD>{statusBadge(String(p.status ?? 'Unknown'))}</TD><TD color={(p.restarts as number) > 0 ? C.warning : undefined}>{String(p.restarts ?? 0)}</TD>{ageTd(p)}<TD mono>{String(p.node ?? '—')}</TD></tr>))}</tbody>
        </table>
      );
    }
    if (activeTab === 'services') {
      if (!services.length) return <div style={{ padding: '16px', fontSize: 11, color: C.muted }}>No services in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Type</TH><TH>Cluster-IP</TH><TH>External-IP</TH><TH>Port(s)</TH><TH>Age</TH></tr></thead>
          <tbody>{services.map((s, i) => (<tr key={i}><TD mono color={C.primary}>{String(s.name)}</TD><TD>{String(s.type ?? 'ClusterIP')}</TD><TD mono>{String(s.cluster_ip ?? '—')}</TD><TD mono>{String(s.external_ip ?? '<none>')}</TD><TD mono>{String(s.ports ?? '<none>')}</TD>{ageTd(s)}</tr>))}</tbody>
        </table>
      );
    }
    if (activeTab === 'deployments') {
      if (!deployments.length) return <div style={{ padding: '16px', fontSize: 11, color: C.muted }}>No deployments in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Ready</TH><TH>Up-to-date</TH><TH>Available</TH><TH>Age</TH></tr></thead>
          <tbody>{deployments.map((d, i) => (<tr key={i}><TD mono color={C.primary}>{String(d.name)}</TD><TD>{String(d.ready ?? '—')}</TD><TD>{String(d.up_to_date ?? '—')}</TD><TD>{String(d.available ?? '—')}</TD>{ageTd(d)}</tr>))}</tbody>
        </table>
      );
    }
    if (activeTab === 'statefulsets') {
      if (!statefulsets.length) return <div style={{ padding: '16px', fontSize: 11, color: C.muted }}>No statefulsets in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Ready</TH><TH>Age</TH></tr></thead>
          <tbody>{statefulsets.map((s, i) => (<tr key={i}><TD mono color={C.primary}>{String(s.name)}</TD><TD>{String(s.ready ?? '—')}</TD>{ageTd(s)}</tr>))}</tbody>
        </table>
      );
    }
    if (activeTab === 'daemonsets') {
      if (!daemonsets.length) return <div style={{ padding: '16px', fontSize: 11, color: C.muted }}>No daemonsets in {namespace}</div>;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Name</TH><TH>Desired</TH><TH>Ready</TH><TH>Age</TH></tr></thead>
          <tbody>{daemonsets.map((d, i) => (<tr key={i}><TD mono color={C.primary}>{String(d.name)}</TD><TD>{String(d.desired ?? '—')}</TD><TD>{String(d.ready ?? '—')}</TD>{ageTd(d)}</tr>))}</tbody>
        </table>
      );
    }
    if (!replicasets.length) return <div style={{ padding: '16px', fontSize: 11, color: C.muted }}>No replicasets in {namespace}</div>;
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><TH>Name</TH><TH>Desired</TH><TH>Ready</TH><TH>Age</TH></tr></thead>
        <tbody>{replicasets.map((r, i) => (<tr key={i}><TD mono color={C.primary}>{String(r.name)}</TD><TD>{String(r.desired ?? '—')}</TD><TD>{String(r.ready ?? '—')}</TD>{ageTd(r)}</tr>))}</tbody>
      </table>
    );
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Layers size={12} color={C.muted} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.primary }}>Resource Explorer</span>
        <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{activeCluster}</span>
        <select value={namespace} onChange={(e) => setNamespace(e.target.value)} style={{ marginLeft: 'auto', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}>
          {namespaces.map((ns) => <option key={ns}>{ns}</option>)}
        </select>
        <button type="button" onClick={() => refetch()} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 3 }}>
          {isFetching ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={11} />}
        </button>
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setActiveTab(t.id)} style={{ padding: '7px 12px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === t.id ? C.accent : 'transparent'}`, color: activeTab === t.id ? C.primary : C.dim, fontSize: 10, fontWeight: activeTab === t.id ? 700 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            {t.label}
            <span style={{ background: C.border, color: C.muted, borderRadius: 3, padding: '0 4px', fontSize: 9, fontFamily: 'monospace' }}>{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <div style={{ overflow: 'auto' }}>{renderTable()}</div>
    </div>
  );
}

// ─── Sparkline with grid lines ────────────────────────────────────────────────

function Sparkline({ values, color = C.accent, height = 44 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontSize: 9 }}>No data</div>
  );
  const max = Math.max(...values, 0.0001);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${height - (v / max) * (height - 4) - 2}`).join(' ');
  const gridLines = [0.25, 0.5, 0.75].map((f) => Math.round(height - f * (height - 4) - 2));
  return (
    <svg width="100%" height={height} preserveAspectRatio="none" viewBox={`0 0 100 ${height}`} style={{ display: 'block' }}>
      {gridLines.map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke={C.border} strokeWidth="0.8" />)}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,${height} ${pts} 100,${height}`} fill={color} fillOpacity="0.07" stroke="none" />
    </svg>
  );
}

// ─── Metrics sub-components ───────────────────────────────────────────────────

type TimeRange = '1h' | '6h' | '24h' | '7d';
type MetricsSubTab = 'dashboard' | 'raw';

interface RawMetrics {
  cpu:        { metric: Record<string, string>; values: [number, string][] }[];
  memory:     { metric: Record<string, string>; values: [number, string][] }[];
  restarts:   { metric: Record<string, string>; values: [number, string][] }[];
  pod_status: { metric: Record<string, string>; values: [number, string][] }[];
}

function MetricCard({ title, unit, series, color, empty }: { title: string; unit: string; series: { label: string; values: number[] }[]; color: string; empty: boolean }) {
  const latest = series[0]?.values.slice(-1)[0] ?? 0;
  const allValues = series.flatMap(s => s.values);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</span>
        {!empty && <span style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'monospace' }}>{latest.toFixed(2)}<span style={{ fontSize: 9, fontWeight: 400, color: C.muted, marginLeft: 3 }}>{unit}</span></span>}
      </div>
      {empty ? (
        <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontSize: 10 }}>No data — Prometheus not connected</div>
      ) : (
        <Sparkline values={allValues} color={color} height={44} />
      )}
      {!empty && series.slice(0, 3).map((s, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.dim, marginTop: 4 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{s.label || '(default)'}</span>
          <span style={{ fontFamily: 'monospace' }}>{s.values.slice(-1)[0]?.toFixed(2)} {unit}</span>
        </div>
      ))}
    </div>
  );
}

function MetricsTab() {
  const clusters   = useClusterStore(s => s.clusters);
  const activeCluster = clusters.find(c => c.active) ?? clusters[0];
  const navigate   = useNavigate();

  const [subTab,        setSubTab]        = useState<MetricsSubTab>('dashboard');
  const [timeRange,     setTimeRange]     = useState<TimeRange>('1h');
  const [grafanaEmbed,  setGrafanaEmbed]  = useState(false);

  // Load which monitoring platforms are connected
  const { data: platformData = {} } = useQuery<Record<string, Record<string, string> | string>>({
    queryKey: ['platform-data'],
    queryFn: () => fetch('/api/settings/platform', { credentials: 'include' }).then(r => r.json()),
    staleTime: 30_000,
  });

  const grafana    = platformData.grafana_external    as Record<string, string> | undefined;
  const datadog    = platformData.datadog             as Record<string, string> | undefined;
  const prometheus = platformData.prometheus_external as Record<string, string> | undefined;
  const newrelic   = platformData.newrelic            as Record<string, string> | undefined;

  type MonitoringPlatform = { key: string; name: string; url: string; color: string; icon: React.JSX.Element };
  const connectedPlatforms: MonitoringPlatform[] = ([
    grafana?.connected    ? { key: 'grafana',    name: 'Grafana',    url: grafana.url,    color: '#f46800', icon: <BarChart2  size={15} /> } : null,
    datadog?.connected    ? { key: 'datadog',    name: 'Datadog',    url: `https://app.${datadog.site ?? 'datadoghq.com'}/infrastructure`, color: '#632ca6', icon: <BarChart3  size={15} /> } : null,
    prometheus?.connected ? { key: 'prometheus', name: 'Prometheus', url: prometheus.url, color: '#e6522c', icon: <Activity  size={15} /> } : null,
    newrelic?.connected   ? { key: 'newrelic',   name: 'New Relic',  url: 'https://one.newrelic.com', color: '#1ce783', icon: <TrendingUp size={15} /> } : null,
  ] as (MonitoringPlatform | null)[]).filter((p): p is MonitoringPlatform => p !== null);

  const { data: rawMetrics, isLoading: metricsLoading } = useQuery<RawMetrics>({
    queryKey: ['monitoring-metrics', activeCluster?.name, timeRange],
    queryFn: async () => {
      const cluster = activeCluster?.name ?? '';
      const r = await fetch(`/api/monitoring/metrics?cluster=${encodeURIComponent(cluster)}&time_range=${timeRange}`, { credentials: 'include' });
      return r.json();
    },
    enabled: subTab === 'raw',
    refetchInterval: 60_000,
  });

  const toSeries = (result: RawMetrics[keyof RawMetrics] = []) =>
    result.map(r => ({ label: Object.values(r.metric ?? {}).join('/'), values: (r.values ?? []).map(([, v]) => parseFloat(v)) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderBottom: `1px solid ${C.border}` }}>
        {([{ id: 'dashboard' as const, label: 'Live Dashboard' }, { id: 'raw' as const, label: 'Raw Metrics' }]).map(t => (
          <button key={t.id} type="button" onClick={() => setSubTab(t.id)}
            style={{ padding: '7px 14px', background: 'none', border: 'none', borderBottom: `2px solid ${subTab === t.id ? C.accent : 'transparent'}`, color: subTab === t.id ? C.primary : C.dim, fontSize: 11, fontWeight: subTab === t.id ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
            {t.label}
          </button>
        ))}
        {subTab === 'raw' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
            {(['1h', '6h', '24h', '7d'] as TimeRange[]).map(r => (
              <button key={r} type="button" onClick={() => setTimeRange(r)}
                style={{ padding: '3px 8px', fontSize: 10, fontWeight: timeRange === r ? 700 : 400, background: timeRange === r ? `${C.accent}18` : C.surface, border: `1px solid ${timeRange === r ? C.accent : C.border}`, borderRadius: 4, color: timeRange === r ? C.accent : C.dim, cursor: 'pointer', fontFamily: 'monospace' }}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Live Dashboard tab */}
      {subTab === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {connectedPlatforms.length === 0 ? (
            <div style={{ padding: '40px 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, textAlign: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: `${C.accent}14`, border: `1px solid ${C.accent}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <Plug size={20} style={{ color: C.accent }} />
              </div>
              <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: C.primary }}>No monitoring platform connected</p>
              <p style={{ margin: '0 0 20px', fontSize: 11, color: C.muted, lineHeight: 1.7, maxWidth: 340, marginInline: 'auto' }}>
                Connect Grafana, Datadog, Prometheus, or New Relic in Integrations to view live dashboards here. Raw Metrics below uses your cluster's metrics-server directly.
              </p>
              <button type="button" onClick={() => navigate('/app/platforms')}
                style={{ padding: '6px 18px', background: C.accent, border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Plug size={11} /> Go to Integrations
              </button>
            </div>
          ) : (
            connectedPlatforms.map(p => (
              <div key={p.key} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 7, background: `${p.color}18`, border: `1px solid ${p.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: p.color, flexShrink: 0 }}>
                    {p.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: C.primary }}>{p.name}</p>
                    <p style={{ margin: 0, fontSize: 10, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {p.key === 'grafana' && (
                      <button type="button" onClick={() => setGrafanaEmbed(e => !e)}
                        style={{ padding: '4px 10px', background: grafanaEmbed ? `${C.accent}18` : 'none', border: `1px solid ${grafanaEmbed ? C.accent : C.border}`, borderRadius: 5, color: grafanaEmbed ? C.accent : C.dim, fontSize: 10, cursor: 'pointer' }}>
                        {grafanaEmbed ? 'Hide embed' : 'Embed'}
                      </button>
                    )}
                    <a href={p.url} target="_blank" rel="noreferrer"
                      style={{ padding: '4px 12px', background: p.color, border: 'none', borderRadius: 5, color: '#fff', fontSize: 10, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <ExternalLink size={10} /> Open Dashboard
                    </a>
                  </div>
                </div>
                {p.key === 'grafana' && grafanaEmbed && (
                  <div style={{ borderTop: `1px solid ${C.border}` }}>
                    <iframe src={p.url} style={{ width: '100%', height: 520, border: 'none', display: 'block' }} title="Grafana Dashboard" sandbox="allow-same-origin allow-scripts allow-forms" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Raw Metrics tab */}
      {subTab === 'raw' && (
        <div>
          {!activeCluster && <div style={{ padding: '18px 22px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, textAlign: 'center', color: C.muted, fontSize: 12 }}>No active cluster.</div>}
          {activeCluster && metricsLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: 18, color: C.muted, fontSize: 12 }}>
              <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite', color: C.accent }} /> Fetching metrics…
            </div>
          )}
          {activeCluster && !metricsLoading && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <MetricCard title="CPU Usage" unit="cores" color={C.accent} series={toSeries(rawMetrics?.cpu)} empty={!rawMetrics?.cpu?.length} />
              <MetricCard title="Memory Usage" unit="MiB" color="#3b82f6" series={toSeries(rawMetrics?.memory).map(s => ({ ...s, values: s.values.map(v => v / 1024 / 1024) }))} empty={!rawMetrics?.memory?.length} />
              <MetricCard title="Container Restarts" unit="restarts" color={C.warning} series={toSeries(rawMetrics?.restarts)} empty={!rawMetrics?.restarts?.length} />
              <MetricCard title="Pod Status" unit="pods" color={C.success} series={toSeries(rawMetrics?.pod_status)} empty={!rawMetrics?.pod_status?.length} />
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ─── Metric summary card (Health tab top row) ─────────────────────────────────

function MetricSummaryCard({ label, value, pct }: { label: string; value: string; pct?: number }) {
  const p = Math.min(100, Math.max(0, pct ?? 0));
  const bc = barColor(p);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}>
      <p style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: C.primary, lineHeight: 1, margin: '0 0 10px' }}>{value}</p>
      {pct !== undefined && (
        <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${p}%`, height: '100%', background: bc, borderRadius: 2, transition: 'width 0.5s' }} />
        </div>
      )}
    </div>
  );
}

// ─── Service table (Health tab primary view) ──────────────────────────────────

function ServiceTablePanel() {
  const { activeCluster } = useClusterStore();
  const [namespace, setNamespace] = useState('default');
  const { data: nsData } = useNamespaces(activeCluster);
  const { data, isFetching } = useResources(activeCluster, namespace);

  const namespaces = nsData?.namespaces ?? ['default'];
  type AnyResource = Record<string, unknown>;
  const deployments = (data?.deployments ?? []) as AnyResource[];

  function deployStatus(d: AnyResource): 'healthy' | 'degraded' | 'error' {
    const ready = String(d.ready ?? '0/0');
    const parts = ready.split('/').map(Number);
    const r = parts[0], t = parts[1];
    if (!t || isNaN(r) || isNaN(t)) return 'error';
    if (r === t && t > 0) return 'healthy';
    if (r > 0) return 'degraded';
    return 'error';
  }

  const STATUS_DOT: Record<string, string> = { healthy: C.success, degraded: C.warning, error: C.error };
  const STATUS_LABEL: Record<string, string> = { healthy: 'Healthy', degraded: 'Degraded', error: 'Error' };

  if (!activeCluster) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '20px', textAlign: 'center', color: C.dim, fontSize: 11 }}>
        No active cluster — activate one in Connections below.
      </div>
    );
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.primary, letterSpacing: '0.04em' }}>Services</span>
        <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{activeCluster}</span>
        <select value={namespace} onChange={(e) => setNamespace(e.target.value)} style={{ marginLeft: 'auto', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}>
          {namespaces.map((ns) => <option key={ns}>{ns}</option>)}
        </select>
        {isFetching && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: C.dim }} />}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: C.bg }}>
            {[['Service', '2fr'], ['Status', '1fr'], ['Pods', '1fr'], ['CPU', '1fr'], ['Memory', '1fr'], ['Req/s', '1fr']].map(([h]) => (
              <th key={h} style={{ padding: '7px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deployments.map((d, i) => {
            const st = deployStatus(d);
            const ready = String(d.ready ?? '—');
            const parts = ready.split('/').map(Number);
            const r = parts[0], t = parts[1];
            const podPct = (t && !isNaN(r) && !isNaN(t)) ? (r / t) * 100 : 0;
            const rowBg = st === 'error' ? C.rowErr : st === 'degraded' ? C.rowWarn : 'transparent';
            return (
              <tr key={i} style={{ background: rowBg, borderBottom: `1px solid ${C.border}`, height: 40 }}>
                <td style={{ padding: '0 14px', fontFamily: 'monospace', fontSize: 12, color: C.primary }}>{String(d.name)}</td>
                <td style={{ padding: '0 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[st], flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: C.muted }}>{STATUS_LABEL[st]}</span>
                    {st === 'error' && <span style={{ fontSize: 9, background: C.badgeErr, color: C.error, padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>ERR</span>}
                  </div>
                </td>
                <td style={{ padding: '0 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 40, height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${podPct}%`, height: '100%', background: barColor(100 - podPct), borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.muted }}>{ready}</span>
                  </div>
                </td>
                <td style={{ padding: '0 14px' }}><span style={{ fontSize: 11, color: C.dead, fontFamily: 'monospace' }}>—</span></td>
                <td style={{ padding: '0 14px' }}><span style={{ fontSize: 11, color: C.dead, fontFamily: 'monospace' }}>—</span></td>
                <td style={{ padding: '0 14px' }}><span style={{ fontSize: 11, color: C.dead, fontFamily: 'monospace' }}>—</span></td>
              </tr>
            );
          })}
          {!isFetching && deployments.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: '18px 14px', textAlign: 'center', color: C.dim, fontSize: 11 }}>No deployments in {namespace}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Health tab (metric cards + service table + connections) ──────────────────

function HealthTab() {
  const { activeCluster } = useClusterStore();
  const { data, isFetching: overviewFetching } = useClusterOverview(activeCluster);
  const overview = data as ClusterOverview | undefined;
  const nodes = overview?.nodes ?? [];
  type NodeWithMetrics = K8sNode & { cpu_pct?: number; mem_pct?: number };
  const avgCpu = nodes.length ? Math.round((nodes as NodeWithMetrics[]).reduce((s, n) => s + (n.cpu_pct ?? 0), 0) / nodes.length) : null;
  const avgMem = nodes.length ? Math.round((nodes as NodeWithMetrics[]).reduce((s, n) => s + (n.mem_pct ?? 0), 0) / nodes.length) : null;
  const totalNodes   = nodes.length || null;
  const runningPods  = (overview?.pod_counts?.running as number) ?? null;

  const totalSpend = SPEND_DATA.reduce((s, d) => s + d.monthly, 0);
  const budget = 2500;
  const budgetPct = Math.round((totalSpend / budget) * 100);

  return (
    <>
      {/* 4 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricSummaryCard label="Nodes" value={overviewFetching && !overview ? '…' : (totalNodes ? String(totalNodes) : '—')} />
        <MetricSummaryCard label="Running Pods" value={overviewFetching && !overview ? '…' : (runningPods !== null ? String(runningPods) : '—')} />
        <MetricSummaryCard label="Avg CPU" value={avgCpu !== null ? `${avgCpu}%` : '—'} pct={avgCpu ?? 0} />
        <MetricSummaryCard label="Avg Memory" value={avgMem !== null ? `${avgMem}%` : '—'} pct={avgMem ?? 0} />
      </div>

      {/* Service table */}
      <ServiceTablePanel />

      {/* Cluster node overview */}
      <ClusterOverviewPanel />

      {/* Cluster connections */}
      <ClusterHealthSection />

      {/* Cost & Drift */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total Spend',   value: `$${totalSpend.toLocaleString()}`, sub: 'This month',      icon: <DollarSign size={16} />,  color: C.primary  },
          { label: 'vs Last Month', value: '-4.2%',                           sub: '-$79 lower',       icon: <TrendingDown size={16} />, color: C.success  },
          { label: 'Budget Usage',  value: `${budgetPct}%`,                   sub: `$${(budget - totalSpend).toLocaleString()} remaining`, icon: <BarChart2 size={16} />, color: budgetPct > 90 ? C.error : budgetPct > 75 ? C.warning : C.primary },
          { label: 'Projected EOY', value: '$22,740',                         sub: '+12% YoY',          icon: <TrendingUp size={16} />,  color: C.warning  },
        ].map((card) => (
          <div key={card.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{card.label}</span>
              <span style={{ color: card.color, opacity: 0.6 }}>{card.icon}</span>
            </div>
            <p style={{ fontSize: 22, fontWeight: 700, color: card.color, lineHeight: 1, fontFamily: 'monospace' }}>{card.value}</p>
            <p style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Spend + drift */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18 }}>
          <p style={{ fontWeight: 700, fontSize: 11, color: C.primary, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Spend by Service</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SPEND_DATA.map((item) => (
              <div key={item.service}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{item.service}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: item.color, fontFamily: 'monospace' }}>${item.monthly}</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(item.monthly / maxSpend) * 100}%`, background: item.color, borderRadius: 2, transition: 'width 0.5s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: `${C.error}08`, border: `1px solid ${C.error}44`, borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <AlertTriangle size={13} color={C.error} />
              <span style={{ fontWeight: 700, fontSize: 11, color: C.primary }}>Cost Anomaly</span>
            </div>
            <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>EC2 spend is <strong style={{ color: C.error }}>40% above forecast</strong> for the past 3 days.</p>
            <button type="button" style={{ marginTop: 10, padding: '4px 10px', background: 'transparent', border: `1px solid ${C.error}`, borderRadius: 4, color: C.error, fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>Investigate</button>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <p style={{ fontWeight: 700, fontSize: 11, color: C.primary, marginBottom: 10 }}>Quick Wins</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {OPTIMIZATIONS.slice(0, 2).map((opt) => (
                <div key={opt.title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{opt.title}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.success, background: `${C.success}12`, padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>{opt.saving}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Infrastructure drift */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontWeight: 700, fontSize: 11, color: C.primary }}>
            Infrastructure Drift
            <span style={{ marginLeft: 7, padding: '1px 7px', background: `${C.error}18`, border: `1px solid ${C.error}44`, borderRadius: 3, color: C.error, fontSize: 9, fontWeight: 700 }}>3 drifted</span>
          </p>
          <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, cursor: 'pointer' }}>
            <RefreshCw size={10} /> Scan Now
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {['Resource', 'Type', 'Expected', 'Actual', 'Severity', 'Action'].map((h) => (
                <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DRIFT_RESOURCES.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < DRIFT_RESOURCES.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <td style={{ padding: '9px 12px', fontSize: 11, color: C.primary, fontFamily: 'monospace' }}>{row.resource}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>{row.type}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: C.success }}>{row.expected}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: C.error }}>{row.actual}</td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{ padding: '2px 6px', background: `${SEV_COLORS[row.severity]}18`, border: `1px solid ${SEV_COLORS[row.severity]}`, borderRadius: 3, color: SEV_COLORS[row.severity], fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>
                    {row.severity}
                  </span>
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <button type="button" style={{ padding: '3px 8px', background: C.accent, border: 'none', borderRadius: 4, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Sync</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Optimization suggestions */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontWeight: 700, fontSize: 11, color: C.primary }}>Optimization Suggestions</p>
          <span style={{ fontSize: 11, color: C.success, fontWeight: 700, fontFamily: 'monospace' }}>
            ${OPTIMIZATIONS.reduce((s, o) => s + parseInt(o.saving), 0)}/mo potential
          </span>
        </div>
        {OPTIMIZATIONS.map((opt, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '11px 14px', borderBottom: i < OPTIMIZATIONS.length - 1 ? `1px solid ${C.border}` : 'none', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.primary, marginBottom: 2 }}>{opt.title}</p>
              <p style={{ fontSize: 10, color: C.dim }}>{opt.desc}</p>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.success, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{opt.saving}</span>
            <button type="button" style={{ padding: '4px 10px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>Apply</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Agent tab ────────────────────────────────────────────────────────────────

interface AgentStatus {
  has_token: boolean;
  installed: boolean;
  last_seen: string | null;
  last_seen_minutes_ago: number | null;
  agent_version: string | null;
  token_prefix: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <button type="button" onClick={copy} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: copied ? C.success : C.muted, cursor: 'pointer', padding: '4px 8px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
      {copied ? <Check size={10} /> : <Copy size={10} />}{copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function NoHelmSteps({ token }: { token: string }) {
  const [os, setOs] = useState<'linux' | 'windows'>('linux');
  const isLinux = os === 'linux';
  const step1 = isLinux
    ? `curl -o infrapilot-agent.yaml \\\n  https://charts.infrapilot.dev/manifest/latest.yaml`
    : `Invoke-WebRequest -Uri \`\n  https://charts.infrapilot.dev/manifest/latest.yaml \`\n  -OutFile infrapilot-agent.yaml`;
  const step2 = isLinux
    ? `sed -i 's/INFRAPILOT_TOKEN/${token}/g' \\\n  infrapilot-agent.yaml`
    : `(Get-Content infrapilot-agent.yaml) \`\n  -replace 'INFRAPILOT_TOKEN','${token}' \`\n  | Set-Content infrapilot-agent.yaml`;
  const step3 = 'kubectl apply -f infrapilot-agent.yaml';

  const Cb = ({ text }: { text: string }) => (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, padding: '10px 12px', marginBottom: 4 }}>
      <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 10, color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{text}</pre>
    </div>
  );
  const Sh = ({ n, title }: { n: number; title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 6 }}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', background: `${C.accent}22`, border: `1px solid ${C.accent}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{n}</span>
      <span style={{ fontSize: 11, color: C.primary, fontWeight: 600 }}>{title}</span>
    </div>
  );

  return (
    <div>
      {/* OS toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['linux', 'windows'] as const).map((o) => (
          <button key={o} type="button" onClick={() => setOs(o)}
            style={{ padding: '3px 12px', borderRadius: 100, border: `1px solid ${os === o ? C.accent : C.border}`, background: os === o ? `${C.accent}18` : 'transparent', color: os === o ? C.accent : C.dim, fontSize: 10, fontWeight: os === o ? 700 : 400, cursor: 'pointer' }}>
            {o === 'linux' ? 'Linux / macOS' : 'Windows (PowerShell)'}
          </button>
        ))}
      </div>
      <Sh n={1} title="Download manifest" />
      <Cb text={step1} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}><CopyButton text={step1} /></div>
      <Sh n={2} title="Set your token" />
      <Cb text={step2} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}><CopyButton text={step2} /></div>
      <Sh n={3} title="Apply to cluster" />
      <Cb text={step3} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><CopyButton text={step3} /></div>
    </div>
  );
}

function AgentTab() {
  const { clusters } = useClusterStore();
  const activeCluster = clusters.find((c) => c.active) ?? clusters[0];
  const clusterName = activeCluster?.name ?? '';
  const queryClient = useQueryClient();

  const [generating, setGenerating] = useState(false);
  const [newToken, setNewToken]     = useState<{ token: string; helm_command: string } | null>(null);
  const [revoking, setRevoking]     = useState(false);
  const [installTab, setInstallTab] = useState<'linux' | 'powershell' | 'cmd' | 'nohelm'>('linux');
  const [error, setError]           = useState('');

  const { data: status, isLoading } = useQuery<AgentStatus>({
    queryKey: ['agent-status', clusterName],
    queryFn: async () => {
      if (!clusterName) return { has_token: false, installed: false, last_seen: null, last_seen_minutes_ago: null, agent_version: null, token_prefix: '' };
      const r = await fetch(`/api/agent/status/${encodeURIComponent(clusterName)}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
    enabled: !!clusterName,
  });

  const generateToken = async (regenerate = false) => {
    setGenerating(true); setError(''); setNewToken(null);
    try {
      const endpoint = regenerate ? '/api/agent/token/regenerate' : '/api/agent/token';
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cluster_name: clusterName }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Request failed');
      if (data.is_new && data.token) {
        setNewToken({ token: data.token, helm_command: data.helm_command });
      }
      queryClient.invalidateQueries({ queryKey: ['agent-status', clusterName] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const revokeToken = async () => {
    if (!confirm('Revoke agent token? The agent will stop sending data until you reinstall.')) return;
    setRevoking(true); setError('');
    try {
      const r = await fetch(`/api/agent/token/${encodeURIComponent(clusterName)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      setNewToken(null);
      queryClient.invalidateQueries({ queryKey: ['agent-status', clusterName] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevoking(false);
    }
  };

  if (!clusterName) {
    return <div style={{ color: C.muted, fontSize: 12, padding: 24, textAlign: 'center' }}>No cluster selected</div>;
  }

  const cardStyle: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, maxWidth: 640 };
  const labelStyle: React.CSSProperties = { fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 };
  const valueStyle: React.CSSProperties = { fontSize: 13, color: C.primary, fontFamily: 'monospace' };

  // ── State: token was just generated (show once) ───────────────────────────
  if (newToken) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* One-time warning */}
        <div style={{ background: '#1f1700', border: `1px solid ${C.warning}44`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={14} color={C.warning} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, color: C.warning, fontWeight: 700, marginBottom: 2 }}>Save this token — it will not be shown again.</div>
            <div style={{ fontSize: 11, color: C.muted }}>After you navigate away, only the first 12 characters will be visible. Copy it now and store it securely.</div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: C.primary, fontWeight: 600, marginBottom: 16 }}>Step 1 — Save your agent token</div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.success, wordBreak: 'break-all' }}>{newToken.token}</span>
            <CopyButton text={newToken.token} />
          </div>

          <div style={{ fontSize: 13, color: C.primary, fontWeight: 600, margin: '20px 0 10px' }}>Step 2 — Install the agent</div>

          {/* Helm note */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: C.dim }}>Requires Helm ·</span>
            <a href="https://helm.sh/docs/intro/install/" target="_blank" rel="noreferrer" style={{ fontSize: 10, color: C.accent, textDecoration: 'none' }}>Install Helm ↗</a>
            <span style={{ fontSize: 10, color: C.dim, marginLeft: 4 }}>· No Helm? Use the last tab</span>
          </div>

          {/* Tab strip */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>
            {([
              { id: 'linux',      label: 'Linux / macOS' },
              { id: 'powershell', label: 'Windows — PowerShell' },
              { id: 'cmd',        label: 'Windows — CMD' },
              { id: 'nohelm',     label: 'Without Helm' },
            ] as const).map((t) => (
              <button key={t.id} type="button" onClick={() => setInstallTab(t.id)}
                style={{ background: 'none', border: 'none', borderBottom: `2px solid ${installTab === t.id ? C.accent : 'transparent'}`, color: installTab === t.id ? C.primary : C.dim, fontSize: 10, fontWeight: installTab === t.id ? 700 : 400, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab: Linux / macOS */}
          {installTab === 'linux' && (() => {
            const cmd = `helm repo add infrapilot https://charts.infrapilot.dev\nhelm repo update\nhelm install infrapilot-agent \\\n  infrapilot/infrapilot-agent \\\n  --namespace infrapilot-system \\\n  --create-namespace \\\n  --set infrapilot.token=${newToken.token} \\\n  --set infrapilot.endpoint=https://api.infrapilot.dev \\\n  --set infrapilot.clusterName=${clusterName}`;
            return (
              <div>
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 14px', marginBottom: 6 }}>
                  <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: C.muted, whiteSpace: 'pre-wrap' }}>{cmd}</pre>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><CopyButton text={cmd} /></div>
              </div>
            );
          })()}

          {/* Tab: Windows — PowerShell */}
          {installTab === 'powershell' && (() => {
            const cmd = `helm repo add infrapilot https://charts.infrapilot.dev\nhelm repo update\nhelm install infrapilot-agent \`\n  infrapilot/infrapilot-agent \`\n  --namespace infrapilot-system \`\n  --create-namespace \`\n  --set infrapilot.token=${newToken.token} \`\n  --set infrapilot.endpoint=https://api.infrapilot.dev \`\n  --set infrapilot.clusterName=${clusterName}`;
            return (
              <div>
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 14px', marginBottom: 6 }}>
                  <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: C.muted, whiteSpace: 'pre-wrap' }}>{cmd}</pre>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><CopyButton text={cmd} /></div>
              </div>
            );
          })()}

          {/* Tab: Windows — CMD */}
          {installTab === 'cmd' && (() => {
            const cmd = `helm repo add infrapilot https://charts.infrapilot.dev && helm repo update && helm install infrapilot-agent infrapilot/infrapilot-agent --namespace infrapilot-system --create-namespace --set infrapilot.token=${newToken.token} --set infrapilot.endpoint=https://api.infrapilot.dev --set infrapilot.clusterName=${clusterName}`;
            return (
              <div>
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 14px', marginBottom: 6 }}>
                  <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{cmd}</pre>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: C.dim }}>One single command</span>
                  <CopyButton text={cmd} />
                </div>
              </div>
            );
          })()}

          {/* Tab: Without Helm */}
          {installTab === 'nohelm' && <NoHelmSteps token={newToken.token} />}

          <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[['infrapilot-system', 'namespace'], ['read-only', 'ClusterRole'], ['~60 s', 'to connect']].map(([v, l]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 11, color: C.primary, fontWeight: 600, fontFamily: 'monospace' }}>{v}</span>
                <span style={{ fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</span>
              </div>
            ))}
          </div>

          <button type="button" onClick={() => { setNewToken(null); queryClient.invalidateQueries({ queryKey: ['agent-status', clusterName] }); }}
            style={{ marginTop: 20, background: C.accent, border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, padding: '8px 18px', cursor: 'pointer' }}>
            Done — I saved the token
          </button>
        </div>
      </div>
    );
  }

  // ── State: loading ────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ color: C.muted, fontSize: 12, padding: 24, display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Checking agent status…</div>;
  }

  // ── State: no token yet ───────────────────────────────────────────────────
  if (!status?.has_token) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Bot size={20} color={C.accent} />
            <div>
              <div style={{ fontSize: 14, color: C.primary, fontWeight: 600 }}>Install InfraPilot Agent</div>
              <div style={{ fontSize: 11, color: C.muted }}>A lightweight Helm chart that sends heartbeats and metrics from <strong>{clusterName}</strong> to your workspace.</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '16px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '14px 0' }}>
            {[['Read-only', 'ClusterRole lists only allowed resources — no write access'],
              ['Heartbeat', 'Sends a ping every 60 s to show the cluster is reachable'],
              ['Rate limited', '1 heartbeat per 30 s · 1 metrics push per 60 s per token'],
              ['Namespace', 'Runs in infrapilot-system — isolated from your workloads']].map(([t, d]) => (
              <div key={t}>
                <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, marginBottom: 2 }}>{t}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{d}</div>
              </div>
            ))}
          </div>
          {error && <div style={{ color: C.error, fontSize: 11, marginBottom: 10 }}>{error}</div>}
          <button type="button" onClick={() => generateToken(false)} disabled={generating} style={{ background: C.accent, border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, padding: '9px 20px', cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {generating ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Bot size={12} />}
            {generating ? 'Generating…' : 'Generate Agent Token'}
          </button>
        </div>
      </div>
    );
  }

  // ── State: token exists — show status ────────────────────────────────────
  const offline = status.has_token && !status.installed;
  const minutesAgo = status.last_seen_minutes_ago;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Offline warning */}
      {offline && status.last_seen && (
        <div style={{ background: '#1a1400', border: `1px solid ${C.warning}44`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <WifiOff size={13} color={C.warning} />
          <span style={{ fontSize: 11, color: C.warning }}>
            Agent offline — last seen {minutesAgo !== null ? `${minutesAgo} min ago` : 'unknown'}. Check that the Helm chart is running in <code style={{ background: `${C.warning}22`, padding: '1px 4px', borderRadius: 3 }}>infrapilot-system</code>.
          </span>
        </div>
      )}

      {/* Status card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          {status.installed
            ? <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.success, animation: 'livePulse 2s ease-in-out infinite', flexShrink: 0 }} />
            : <div style={{ width: 10, height: 10, borderRadius: '50%', background: status.last_seen ? C.warning : C.dim, flexShrink: 0 }} />
          }
          <div>
            <div style={{ fontSize: 14, color: C.primary, fontWeight: 600 }}>{status.installed ? 'Agent Connected' : status.last_seen ? 'Agent Offline' : 'Waiting for agent…'}</div>
            <div style={{ fontSize: 11, color: C.muted }}>Cluster: {clusterName}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {status.installed ? <Wifi size={13} color={C.success} /> : <WifiOff size={13} color={offline ? C.warning : C.dim} />}
            <span style={{ fontSize: 10, color: status.installed ? C.success : offline ? C.warning : C.dim, fontWeight: 700 }}>
              {status.installed ? 'ONLINE' : offline ? 'OFFLINE' : 'NOT SEEN'}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
          <div>
            <div style={labelStyle}>Token prefix</div>
            <div style={valueStyle}>{status.token_prefix}…</div>
          </div>
          <div>
            <div style={labelStyle}>Agent version</div>
            <div style={valueStyle}>{status.agent_version ?? '—'}</div>
          </div>
          <div>
            <div style={labelStyle}>Last seen</div>
            <div style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock size={10} color={C.dim} />
              {minutesAgo !== null ? (minutesAgo === 0 ? 'Just now' : `${minutesAgo} min ago`) : '—'}
            </div>
          </div>
        </div>

        {error && <div style={{ color: C.error, fontSize: 11, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <button type="button" onClick={() => generateToken(true)} disabled={generating}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 11, padding: '7px 14px', cursor: generating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCcw size={10} />{generating ? 'Regenerating…' : 'Reinstall'}
          </button>
          <button type="button" onClick={revokeToken} disabled={revoking}
            style={{ background: 'none', border: `1px solid ${C.error}44`, borderRadius: 6, color: C.error, fontSize: 11, padding: '7px 14px', cursor: revoking ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Trash2 size={10} />{revoking ? 'Revoking…' : 'Revoke Token'}
          </button>
        </div>
      </div>

      {/* Install hint if no agent seen yet */}
      {!status.last_seen && (
        <div style={{ ...cardStyle, background: '#0d0d12' }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Token generated — run the Helm command to install the agent:</div>
          <div style={{ fontSize: 11, color: C.dim }}>
            <code style={{ background: C.bg, padding: '2px 6px', borderRadius: 3 }}>helm repo add infrapilot https://charts.infrapilot.dev</code>
            <br /><br />
            Then install with your token using the command shown when the token was first generated.
            If you need a new command, click <strong>Reinstall</strong> above to regenerate the token.
          </div>
        </div>
      )}

      {/* Pixie eBPF section */}
      <PixieSection clusterName={clusterName} />
    </div>
  );
}

function PixieSection({ clusterName }: { clusterName: string }) {
  const [deployKey, setDeployKey] = useState('');
  const [pixieStatus, setPixieStatus] = useState<{ installed: boolean; reason?: string; cluster_id?: string } | null>(null);

  useEffect(() => {
    fetch('/api/agent/pixie-status')
      .then(r => r.json()).then(d => setPixieStatus(d as { installed: boolean; reason?: string }))
      .catch(() => {});
  }, []);

  const helmCmd = deployKey.trim()
    ? `helm upgrade --install infrapilot-agent infrapilot/infrapilot-agent \\\n  --namespace infrapilot-system \\\n  --reuse-values \\\n  --set pixie.enabled=true \\\n  --set "pixie.deployKey=${deployKey.trim()}" \\\n  --set "pixie.clusterName=${clusterName}"`
    : '';

  return (
    <div style={{ border: `1px solid rgba(251,191,36,0.2)`, borderRadius: 8, padding: 14, background: 'rgba(251,191,36,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>Pixie eBPF Telemetry</span>
        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 100, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#f59e0b', fontWeight: 600 }}>Optional</span>
        {pixieStatus?.installed && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#34d399', fontWeight: 700 }}>● Installed</span>
        )}
      </div>
      <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
        Add eBPF-level HTTP traces and TCP stats to AI diagnosis. When active, DiagnoseMode shows an "Enhanced with eBPF telemetry" badge.
        {!pixieStatus?.installed && <> Get a free deploy key at <a href="https://app.px.dev" target="_blank" rel="noreferrer" style={{ color: C.accent }}>app.px.dev</a>.</>}
      </p>
      {!pixieStatus?.installed && (
        <>
          <input
            value={deployKey}
            onChange={e => setDeployKey(e.target.value)}
            placeholder="px:deploy:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.primary, fontSize: 11, padding: '6px 9px', outline: 'none', fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box', marginBottom: 8 }}
          />
          {helmCmd && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', position: 'relative' }}>
              <pre style={{ margin: 0, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: C.primary, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{helmCmd}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main MonitorMode ─────────────────────────────────────────────────────────

type MonitorTab = 'health' | 'issues' | 'resources' | 'metrics' | 'agent';
type TopTimeRange = '15m' | '1h' | '3h' | '24h' | '7d';

export function MonitorMode() {
  const [activeTab,  setActiveTab]  = useState<MonitorTab>('health');
  const [timeRange,  setTimeRange]  = useState<TopTimeRange>('1h');
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const { clusters } = useClusterStore();
  const activeCluster = clusters.find((c) => c.active) ?? clusters[0];

  useEffect(() => {
    const id = setInterval(() => setLastUpdate(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data: incidentsData } = useQuery({
    queryKey: ['incidents'],
    queryFn: async () => { const r = await fetch('/api/incidents'); return r.json(); },
    refetchInterval: 30_000,
  });
  const incidents: Incident[] = incidentsData?.incidents ?? [];
  const activeIncidentCount = incidents.filter((i) => i.status === 'active').length;

  const tabs: { id: MonitorTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'health',    label: 'Health',    icon: <Activity size={11} /> },
    { id: 'issues',    label: 'Issues',    icon: <AlertTriangle size={11} />, badge: activeIncidentCount || undefined },
    { id: 'resources', label: 'Resources', icon: <BarChart3 size={11} /> },
    { id: 'metrics',   label: 'Metrics',   icon: <LineChart size={11} /> },
    { id: 'agent',     label: 'Agent',     icon: <Bot size={11} /> },
  ];

  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, overflow: 'hidden' }}>
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.75); }
        }
      `}</style>

      {/* Top bar — 48px */}
      <div style={{ height: 48, minHeight: 48, background: C.surface, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 18px', gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: C.dim }}>Monitor</span>
        <span style={{ color: C.border, fontSize: 14 }}>/</span>
        {activeCluster ? (
          <span style={{ fontSize: 11, background: C.border, color: C.muted, padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
            {activeCluster.name}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: C.dim }}>no cluster</span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2 }}>
          {(['15m', '1h', '3h', '24h', '7d'] as TopTimeRange[]).map((r) => (
            <button key={r} type="button" onClick={() => setTimeRange(r)} style={{ padding: '3px 8px', background: timeRange === r ? `${C.accent}1a` : 'transparent', border: `1px solid ${timeRange === r ? C.accent : C.border}`, borderRadius: 4, color: timeRange === r ? C.accent : C.dim, fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', fontWeight: timeRange === r ? 700 : 400 }}>
              {r}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.success, animation: 'livePulse 2s ease-in-out infinite' }} />
          <span style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: '0.08em' }}>LIVE</span>
        </div>
      </div>

      {/* Tab bar — 32px */}
      <div style={{ height: 32, minHeight: 32, background: C.surface, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-end', padding: '0 18px', flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} style={{ height: 32, padding: '0 14px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === tab.id ? C.accent : 'transparent'}`, color: activeTab === tab.id ? C.primary : C.dim, fontSize: 11, fontWeight: activeTab === tab.id ? 600 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            {tab.icon}{tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span style={{ background: C.error, color: '#fff', borderRadius: 100, fontSize: 9, fontWeight: 700, padding: '1px 5px', minWidth: 14, textAlign: 'center' }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        <div style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {activeTab === 'health'    && <HealthTab />}
          {activeTab === 'issues'    && <IssuesPanel incidents={incidents} summary={incidentsData?.summary} />}
          {activeTab === 'resources' && <ResourceExplorerPanel />}
          {activeTab === 'metrics'   && <MetricsTab />}
          {activeTab === 'agent'     && <AgentTab />}
        </div>
      </div>

      {/* Bottom status bar — 32px */}
      <div style={{ height: 32, minHeight: 32, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 18px', gap: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: C.dim, fontFamily: 'monospace' }}>
          {activeCluster ? `${activeCluster.name} · ${activeCluster.environment?.toUpperCase()}` : 'no cluster selected'}
        </span>
        {activeCluster?.api_url && (
          <span style={{ fontSize: 9, color: C.dead, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{activeCluster.api_url}</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: C.dead, fontFamily: 'monospace' }}>updated {fmt(lastUpdate)}</span>
        <span style={{ fontSize: 9, color: C.dead }}>·</span>
        <span style={{ fontSize: 9, color: activeIncidentCount > 0 ? C.error : C.dim }}>{activeIncidentCount} active issue{activeIncidentCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
