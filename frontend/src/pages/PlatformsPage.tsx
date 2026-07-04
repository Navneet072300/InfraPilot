import { useEffect, useState } from 'react';
import {
  GitBranch, GitMerge, Server, Shield, Cloud, Database,
  Activity, BarChart2, CheckCircle2, Loader2,
  Plus, Trash2, Edit2, ChevronDown, ChevronRight,
  Zap,
} from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useClusterStore } from '../store/clusterStore';
import type { ClusterConfig } from '../types';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)',
} as const;

// Status pill component
type PlatformStatus = 'connected' | 'untested' | 'not_connected' | 'builtin';

function StatusPill({ status }: { status: PlatformStatus }) {
  const cfg = {
    connected:     { label: '● Connected',     bg: 'rgba(63,185,80,0.12)',  color: '#3fb950' },
    untested:      { label: '● Untested',      bg: 'rgba(210,153,34,0.12)', color: '#d2991c' },
    not_connected: { label: '○ Not connected', bg: 'rgba(110,118,129,0.12)',color: '#6e7681' },
    builtin:       { label: '★ Built-in',      bg: 'rgba(88,166,255,0.12)', color: '#58a6ff' },
  }[status];
  return (
    <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

// Generic platform card
interface PlatformCardProps {
  icon: React.ReactNode;
  name: string;
  status: PlatformStatus;
  details?: string;
  lastTested?: string;
  onTest?: () => void;
  onEdit?: () => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
  onExpand?: () => void;
  expanded?: boolean;
  children?: React.ReactNode;
  testing?: boolean;
}

function PlatformCard({ icon, name, status, details, lastTested, onTest, onEdit, onDisconnect, onConnect, onExpand, expanded, children, testing }: PlatformCardProps) {
  return (
    <div style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.875rem 1rem' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: `${V.accent}12`, border: `1px solid ${V.accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: V.accent }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: V.text }}>{name}</span>
            <StatusPill status={status} />
          </div>
          <div style={{ fontSize: '0.75rem', color: V.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {details || (status === 'not_connected' ? 'Not connected' : '')}
          </div>
          {lastTested && <div style={{ fontSize: '0.7rem', color: V.muted, marginTop: 2 }}>Last tested: {lastTested}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {status === 'not_connected' && onConnect ? (
            <button type="button" onClick={onConnect}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
              Connect →
            </button>
          ) : status !== 'builtin' ? (
            <>
              {onTest && <button type="button" onClick={onTest} disabled={testing} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {testing ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={11} />} Test
              </button>}
              {onEdit && <button type="button" onClick={onEdit} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Edit2 size={12} /></button>}
              {onDisconnect && <button type="button" onClick={onDisconnect} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.red, fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Trash2 size={12} /></button>}
            </>
          ) : null}
          {onExpand && (
            <button type="button" onClick={onExpand} style={{ padding: '4px 6px', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </div>
      </div>
      {expanded && children && (
        <div style={{ borderTop: `1px solid ${V.border}`, padding: '0.875rem 1rem' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.625rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', color: V.muted, textTransform: 'uppercase' }}>{children}</h2>
    </div>
  );
}

// ─── GitHub Section ───────────────────────────────────────────────────────────

function GitHubCard() {
  const [pat, setPat] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [expiry, setExpiry] = useState('');
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/settings/platform').then(r => r.json()).then(d => {
      if (d.github?.pat) setPat(d.github.pat);
      if (d.github?.username) setUsername(d.github.username);
      if (d.github?.pat_expires_at) setExpiry(d.github.pat_expires_at);
    }).catch(() => {});
  }, []);

  const connected = !!pat && !pat.includes('***') || pat.includes('***');
  const status: PlatformStatus = connected ? (testResult?.ok ? 'connected' : 'untested') : 'not_connected';

  async function handleTest() {
    setTesting(true);
    try {
      const r = await fetch('/api/github/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pat }) });
      const d = await r.json();
      setTestResult({ ok: d.success, msg: d.success ? `@${d.username}` : d.error || 'Auth failed' });
    } catch { setTestResult({ ok: false, msg: 'Test failed' }); }
    finally { setTesting(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const vr = await fetch('/api/github/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pat }) });
      const vd = await vr.json();
      if (!vd.success) { setTestResult({ ok: false, msg: 'Invalid token' }); return; }
      setUsername(vd.username);
      await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.pat', value: pat }) });
      if (vd.username) await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.username', value: vd.username }) });
      setTestResult({ ok: true, msg: `@${vd.username}` });
      setEditing(false);
    } finally { setSaving(false); }
  }

  return (
    <PlatformCard
      icon={<GitBranch size={18} />}
      name="GitHub"
      status={status}
      details={username ? `@${username}${expiry ? ` · expires ${expiry}` : ''}` : undefined}
      lastTested={testResult?.msg}
      onTest={connected && !editing ? handleTest : undefined}
      onEdit={connected && !editing ? () => setEditing(true) : undefined}
      onDisconnect={connected && !editing ? async () => {
        await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.pat', value: '' }) });
        setPat(''); setUsername(null); setTestResult(null);
      } : undefined}
      onConnect={!connected ? () => setExpanded(true) : undefined}
      onExpand={connected ? () => setExpanded(e => !e) : undefined}
      expanded={expanded}
      testing={testing}
    >
      {editing || !connected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          <div style={{ fontSize: '0.8rem', color: V.muted, marginBottom: 4 }}>
            Paste your GitHub Personal Access Token (needs <code>repo</code>, <code>workflow</code> scopes).
            {' '}<a href="https://github.com/settings/tokens/new?scopes=repo,workflow,write:packages&description=InfraPilot" target="_blank" rel="noopener noreferrer" style={{ color: V.accent }}>Generate one →</a>
          </div>
          <input type="password" value={pat.includes('***') ? '' : pat} onChange={e => setPat(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxx"
            style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.5rem 0.75rem', color: V.text, fontSize: '0.875rem', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleSave} disabled={saving || !pat}
              style={{ padding: '0.45rem 1rem', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null} Validate & Save
            </button>
            {editing && <button type="button" onClick={() => setEditing(false)} style={{ padding: '0.45rem 0.875rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>}
          </div>
          {testResult && <p style={{ margin: 0, fontSize: '0.78rem', color: testResult.ok ? V.green : V.red }}>{testResult.ok ? '✓' : '✗'} {testResult.msg}</p>}
        </div>
      ) : null}
    </PlatformCard>
  );
}

// ─── Clusters Section ─────────────────────────────────────────────────────────

function ClustersSection() {
  const { addCluster, removeCluster } = useClusterStore();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', environment: 'dev', connection_type: 'token', api_url: '', token: '' });
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean }>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const { data: clusters = [], isLoading } = useQuery({
    queryKey: ['platforms-clusters'],
    queryFn: () => fetch('/api/settings/clusters').then(r => r.json()).then(d => d.clusters as ClusterConfig[]),
  });

  async function handleTest(name: string) {
    setTesting(name);
    try {
      const r = await fetch(`/api/settings/clusters/${encodeURIComponent(name)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      setTestResults(prev => ({ ...prev, [name]: { ok: d.healthy } }));
    } finally { setTesting(null); }
  }

  async function handleAdd() {
    setSaving(true);
    try {
      const r = await fetch('/api/settings/clusters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error((await r.json()).detail);
      const d = await r.json();
      addCluster(d.cluster);
      qc.invalidateQueries({ queryKey: ['platforms-clusters'] });
      setAddOpen(false);
      setForm({ name: '', environment: 'dev', connection_type: 'token', api_url: '', token: '' });
    } catch { /* toast */ } finally { setSaving(false); }
  }

  async function handleDelete(name: string) {
    await fetch(`/api/settings/clusters/${encodeURIComponent(name)}`, { method: 'DELETE' });
    removeCluster(name);
    qc.invalidateQueries({ queryKey: ['platforms-clusters'] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: V.muted, padding: '1rem' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading clusters…
        </div>
      ) : (
        clusters.map(c => (
          <PlatformCard
            key={c.name}
            icon={<Server size={18} />}
            name={`${c.name}`}
            status={testResults[c.name] ? (testResults[c.name].ok ? 'connected' : 'untested') : 'untested'}
            details={`${c.environment} · ${c.connection_type === 'kubeconfig' ? 'kubeconfig' : c.api_url || 'Bearer Token'}`}
            onTest={() => handleTest(c.name)}
            onDisconnect={() => handleDelete(c.name)}
            testing={testing === c.name}
          />
        ))
      )}
      {addOpen ? (
        <div style={{ background: V.bg, border: `1px solid ${V.accent}40`, borderRadius: 10, padding: '0.875rem 1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '0.625rem' }}>
            <div>
              <label style={{ display: 'block', color: V.muted, fontSize: '0.75rem', marginBottom: 3 }}>Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="dev-aks"
                style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.4rem 0.625rem', color: V.text, fontSize: '0.82rem', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', color: V.muted, fontSize: '0.75rem', marginBottom: 3 }}>Environment</label>
              <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))} style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.4rem 0.625rem', color: V.text, fontSize: '0.82rem', colorScheme: 'dark' }}>
                <option>dev</option><option>staging</option><option>prod</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', color: V.muted, fontSize: '0.75rem', marginBottom: 3 }}>API Server URL</label>
              <input value={form.api_url} onChange={e => setForm(f => ({ ...f, api_url: e.target.value }))} placeholder="https://k8s.example.com:6443"
                style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.4rem 0.625rem', color: V.text, fontSize: '0.82rem', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', color: V.muted, fontSize: '0.75rem', marginBottom: 3 }}>Bearer Token</label>
              <input type="password" value={form.token} onChange={e => setForm(f => ({ ...f, token: e.target.value }))} placeholder="eyJhbGci…"
                style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.4rem 0.625rem', color: V.text, fontSize: '0.82rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleAdd} disabled={saving || !form.name}
              style={{ padding: '0.45rem 1rem', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', opacity: !form.name ? 0.5 : 1 }}>
              {saving ? 'Adding…' : 'Add Cluster'}
            </button>
            <button type="button" onClick={() => setAddOpen(false)} style={{ padding: '0.45rem 0.875rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAddOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.875rem', borderRadius: 8, border: `1px dashed ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.8rem', cursor: 'pointer', width: 'fit-content' }}>
          <Plus size={13} /> Add Cluster
        </button>
      )}
    </div>
  );
}

// ─── External vault card ──────────────────────────────────────────────────────

function ExternalVaultCard({ name, icon, settingKey, fields }: { name: string; icon: React.ReactNode; settingKey: string; fields: { key: string; label: string; placeholder: string; secret?: boolean }[] }) {
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/platform').then(r => r.json()).then(d => {
      const val = d[settingKey];
      if (val && typeof val === 'object' && val.connected) setConnected(true);
    }).catch(() => {});
  }, [settingKey]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: settingKey, value: JSON.stringify({ ...form, connected: true }) }) });
      setConnected(true); setExpanded(false);
    } finally { setSaving(false); }
  }

  return (
    <PlatformCard
      icon={icon}
      name={name}
      status={connected ? 'untested' : 'not_connected'}
      details={connected ? 'Credentials saved — click Test to verify' : undefined}
      onConnect={!connected ? () => setExpanded(true) : undefined}
      onEdit={connected ? () => setExpanded(e => !e) : undefined}
      onDisconnect={connected ? async () => {
        await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: settingKey, value: '' }) });
        setConnected(false); setForm({});
      } : undefined}
      onExpand={connected ? () => setExpanded(e => !e) : undefined}
      expanded={expanded}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={{ display: 'block', color: V.muted, fontSize: '0.75rem', marginBottom: 3 }}>{f.label}</label>
            <input type={f.secret ? 'password' : 'text'} value={form[f.key] ?? ''} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 7, padding: '0.4rem 0.625rem', color: V.text, fontSize: '0.82rem', boxSizing: 'border-box' }} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{ padding: '0.45rem 1rem', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setExpanded(false)} style={{ padding: '0.45rem 0.875rem', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </PlatformCard>
  );
}

// ─── InfraPilot Monitor card ──────────────────────────────────────────────────

function InfraPilotMonitorCard() {
  const [status, setStatus] = useState<{ prometheus_running?: boolean; clusters_monitored?: number } | null>(null);

  useEffect(() => {
    fetch('/api/monitoring/status').then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  const details = status
    ? `Prometheus ${status.prometheus_running ? 'running' : 'not running'} · ${status.clusters_monitored ?? 0} cluster${status.clusters_monitored !== 1 ? 's' : ''} monitored · 30-day retention`
    : 'Automatic time-series monitoring for connected clusters';

  return (
    <PlatformCard
      icon={<Activity size={18} />}
      name="InfraPilot Monitor"
      status="builtin"
      details={details}
    />
  );
}

// ─── Main PlatformsPage ───────────────────────────────────────────────────────

export default function PlatformsPage() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '1.4rem', fontWeight: 700, color: V.text }}>Connected Platforms</h1>
        <p style={{ margin: 0, color: V.muted, fontSize: '0.875rem' }}>Manage your integrations and credentials</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* Section A: Infrastructure & Cloud */}
        <section>
          <SectionHeader>Infrastructure &amp; Cloud</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <GitHubCard />
            <ExternalVaultCard
              name="GitLab"
              icon={<GitMerge size={18} />}
              settingKey="gitlab"
              fields={[
                { key: 'url', label: 'GitLab URL', placeholder: 'https://gitlab.com' },
                { key: 'token', label: 'Access Token', placeholder: 'glpat-xxxxxxxxxxxx', secret: true },
              ]}
            />
            <ClustersSection />
            <ExternalVaultCard
              name="Cloudflare"
              icon={<Cloud size={18} />}
              settingKey="cloudflare"
              fields={[
                { key: 'api_token', label: 'API Token', placeholder: 'Your Cloudflare API token', secret: true },
                { key: 'zone_id', label: 'Zone ID (optional)', placeholder: 'Zone ID for DNS management' },
              ]}
            />
          </div>
        </section>

        {/* Section B: Secrets & Vaults */}
        <section>
          <SectionHeader>Secrets &amp; Vaults</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <ExternalVaultCard
              name="HashiCorp Vault"
              icon={<Shield size={18} />}
              settingKey="hashicorp_vault"
              fields={[
                { key: 'address', label: 'Vault Address', placeholder: 'https://vault.company.com' },
                { key: 'token', label: 'Vault Token', placeholder: 'hvs.xxxxxxxxxxxx', secret: true },
                { key: 'namespace', label: 'Namespace (optional)', placeholder: 'admin' },
              ]}
            />
            <ExternalVaultCard
              name="Infisical"
              icon={<Database size={18} />}
              settingKey="infisical"
              fields={[
                { key: 'client_id', label: 'Client ID', placeholder: 'Your Infisical client ID' },
                { key: 'client_secret', label: 'Client Secret', placeholder: 'Your Infisical client secret', secret: true },
                { key: 'project_slug', label: 'Project Slug', placeholder: 'my-app' },
              ]}
            />
            <ExternalVaultCard
              name="AWS Secrets Manager"
              icon={<Cloud size={18} />}
              settingKey="aws_secrets"
              fields={[
                { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AKIA…' },
                { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'Your AWS secret', secret: true },
                { key: 'region', label: 'Region', placeholder: 'us-east-1' },
              ]}
            />
            <ExternalVaultCard
              name="Azure Key Vault"
              icon={<Cloud size={18} />}
              settingKey="azure_keyvault"
              fields={[
                { key: 'vault_url', label: 'Vault URL', placeholder: 'https://myvault.vault.azure.net' },
                { key: 'client_id', label: 'Client ID', placeholder: 'Azure AD App client ID' },
                { key: 'client_secret', label: 'Client Secret', placeholder: 'Azure AD client secret', secret: true },
                { key: 'tenant_id', label: 'Tenant ID', placeholder: 'Azure tenant ID' },
              ]}
            />
            <ExternalVaultCard
              name="GCP Secret Manager"
              icon={<Cloud size={18} />}
              settingKey="gcp_secrets"
              fields={[
                { key: 'project_id', label: 'Project ID', placeholder: 'my-gcp-project' },
                { key: 'service_account_json', label: 'Service Account JSON', placeholder: '{"type":"service_account"…}', secret: true },
              ]}
            />
          </div>
        </section>

        {/* Section C: Monitoring & Observability */}
        <section>
          <SectionHeader>Monitoring &amp; Observability</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <InfraPilotMonitorCard />
            <ExternalVaultCard
              name="Grafana"
              icon={<BarChart2 size={18} />}
              settingKey="grafana_external"
              fields={[
                { key: 'url', label: 'Grafana URL', placeholder: 'https://grafana.company.com' },
                { key: 'api_key', label: 'Service Account Token', placeholder: 'glsa_xxxxxxxxxxxx', secret: true },
              ]}
            />
            <ExternalVaultCard
              name="Datadog"
              icon={<BarChart2 size={18} />}
              settingKey="datadog"
              fields={[
                { key: 'api_key', label: 'API Key', placeholder: 'Your Datadog API key', secret: true },
                { key: 'app_key', label: 'Application Key', placeholder: 'Your Datadog app key', secret: true },
                { key: 'site', label: 'Site', placeholder: 'datadoghq.com' },
              ]}
            />
            <ExternalVaultCard
              name="New Relic"
              icon={<Activity size={18} />}
              settingKey="newrelic"
              fields={[
                { key: 'license_key', label: 'License Key', placeholder: 'Your New Relic license key', secret: true },
                { key: 'account_id', label: 'Account ID', placeholder: '1234567' },
              ]}
            />
            <ExternalVaultCard
              name="Prometheus (external)"
              icon={<Zap size={18} />}
              settingKey="prometheus_external"
              fields={[
                { key: 'url', label: 'Prometheus URL', placeholder: 'https://prometheus.company.com' },
                { key: 'username', label: 'Username (optional)', placeholder: 'For basic auth' },
                { key: 'password', label: 'Password (optional)', placeholder: 'For basic auth', secret: true },
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
