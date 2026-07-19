import { useState, useMemo, useEffect } from 'react';
import {
  GitBranch, GitMerge, Server, Shield, Cloud, Database,
  Activity, BarChart2, Loader2, Plus, Trash2, Edit2,
  Search, X, Zap, CheckCircle2, Globe,
} from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useClusterStore } from '../store/clusterStore';
import type { ClusterConfig } from '../types';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)',
} as const;

// ─── Catalog definition ────────────────────────────────────────────────────────

type Category = 'all' | 'source-control' | 'infrastructure' | 'secrets' | 'monitoring';

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  hint?: string;
}

interface CatalogEntry {
  id: string;
  name: string;
  category: Exclude<Category, 'all'>;
  description: string;
  icon: React.ReactNode;
  color: string;
  settingKey: string;
  fields: FieldDef[];
  special?: 'github' | 'cluster';
  multi?: boolean;
}

const CATALOG: CatalogEntry[] = [
  // Source control
  {
    id: 'github', name: 'GitHub', category: 'source-control',
    description: 'Connect repositories, trigger workflows, and pull code.',
    icon: <GitBranch size={18} />, color: '#f0f0f5', settingKey: 'github', special: 'github',
    fields: [{ key: 'pat', label: 'Personal Access Token', placeholder: 'ghp_xxxxxxxxxxxx', secret: true, hint: 'Needs repo, workflow, write:packages scopes.' }],
  },
  {
    id: 'gitlab', name: 'GitLab', category: 'source-control',
    description: 'Connect GitLab projects, CI/CD pipelines, and merge requests.',
    icon: <GitMerge size={18} />, color: '#fc6d26', settingKey: 'gitlab',
    fields: [
      { key: 'url', label: 'GitLab URL', placeholder: 'https://gitlab.com' },
      { key: 'token', label: 'Access Token', placeholder: 'glpat-xxxxxxxxxxxx', secret: true },
    ],
  },
  // Infrastructure
  {
    id: 'cluster', name: 'Kubernetes Cluster', category: 'infrastructure',
    description: 'Add a cluster to monitor, deploy to, and diagnose.',
    icon: <Server size={18} />, color: '#326ce5', settingKey: 'cluster',
    special: 'cluster', multi: true, fields: [],
  },
  {
    id: 'cloudflare', name: 'Cloudflare', category: 'infrastructure',
    description: 'Manage DNS records and CDN configuration for your own domain.',
    icon: <Cloud size={18} />, color: '#f6821f', settingKey: 'cloudflare',
    fields: [
      { key: 'api_token', label: 'API Token', placeholder: 'Your Cloudflare API token', secret: true },
      { key: 'zone_id', label: 'Zone ID (optional)', placeholder: 'Leave blank to auto-detect from domain' },
    ],
  },
  {
    id: 'route53', name: 'AWS Route 53', category: 'infrastructure',
    description: 'Automate DNS record creation in your AWS Route 53 hosted zone.',
    icon: <Globe size={18} />, color: '#ff9900', settingKey: 'route53',
    fields: [
      { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AKIA…' },
      { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'Your AWS secret', secret: true },
      { key: 'hosted_zone_id', label: 'Hosted Zone ID', placeholder: 'Z0123456789EXAMPLE' },
      { key: 'region', label: 'Region', placeholder: 'us-east-1' },
    ],
  },
  {
    id: 'azure_dns', name: 'Azure DNS', category: 'infrastructure',
    description: 'Create DNS records in an Azure DNS zone via the ARM REST API.',
    icon: <Globe size={18} />, color: '#0089d6', settingKey: 'azure_dns',
    fields: [
      { key: 'subscription_id', label: 'Subscription ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { key: 'resource_group', label: 'Resource Group', placeholder: 'my-dns-rg' },
      { key: 'zone_name', label: 'DNS Zone Name', placeholder: 'company.com' },
      { key: 'tenant_id', label: 'Tenant ID', placeholder: 'Azure AD tenant ID' },
      { key: 'client_id', label: 'Client ID', placeholder: 'Azure AD App (service principal) client ID' },
      { key: 'client_secret', label: 'Client Secret', placeholder: 'Azure AD client secret', secret: true },
    ],
  },
  {
    id: 'gcp_dns', name: 'GCP Cloud DNS', category: 'infrastructure',
    description: 'Create DNS records in a GCP Cloud DNS managed zone.',
    icon: <Globe size={18} />, color: '#4285f4', settingKey: 'gcp_dns',
    fields: [
      { key: 'project_id', label: 'Project ID', placeholder: 'my-gcp-project' },
      { key: 'managed_zone', label: 'Managed Zone Name', placeholder: 'my-zone' },
      { key: 'service_account_json', label: 'Service Account JSON', placeholder: '{"type":"service_account"…}', secret: true },
    ],
  },
  // Secrets
  {
    id: 'hashicorp_vault', name: 'HashiCorp Vault', category: 'secrets',
    description: 'Pull secrets from Vault for deployments and pipelines.',
    icon: <Shield size={18} />, color: '#ffca28', settingKey: 'hashicorp_vault',
    fields: [
      { key: 'address', label: 'Vault Address', placeholder: 'https://vault.company.com' },
      { key: 'token', label: 'Vault Token', placeholder: 'hvs.xxxxxxxxxxxx', secret: true },
      { key: 'namespace', label: 'Namespace (optional)', placeholder: 'admin' },
    ],
  },
  {
    id: 'infisical', name: 'Infisical', category: 'secrets',
    description: 'Sync secrets from Infisical projects automatically.',
    icon: <Database size={18} />, color: '#a855f7', settingKey: 'infisical',
    fields: [
      { key: 'client_id', label: 'Client ID', placeholder: 'Your Infisical client ID' },
      { key: 'client_secret', label: 'Client Secret', placeholder: 'Your Infisical client secret', secret: true },
      { key: 'project_slug', label: 'Project Slug', placeholder: 'my-app' },
    ],
  },
  {
    id: 'aws_secrets', name: 'AWS', category: 'secrets',
    description: 'Connect to AWS — Secrets Manager, IAM, and cloud services.',
    icon: <Cloud size={18} />, color: '#ff9900', settingKey: 'aws_secrets',
    fields: [
      { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AKIA…' },
      { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'Your AWS secret', secret: true },
      { key: 'region', label: 'Region', placeholder: 'us-east-1' },
    ],
  },
  {
    id: 'azure_keyvault', name: 'Azure', category: 'secrets',
    description: 'Connect to Azure — Key Vault, AD, and cloud services.',
    icon: <Cloud size={18} />, color: '#0089d6', settingKey: 'azure_keyvault',
    fields: [
      { key: 'vault_url', label: 'Vault URL', placeholder: 'https://myvault.vault.azure.net' },
      { key: 'client_id', label: 'Client ID', placeholder: 'Azure AD App client ID' },
      { key: 'client_secret', label: 'Client Secret', placeholder: 'Azure AD client secret', secret: true },
      { key: 'tenant_id', label: 'Tenant ID', placeholder: 'Azure tenant ID' },
    ],
  },
  {
    id: 'gcp_secrets', name: 'GCP', category: 'secrets',
    description: 'Connect to GCP — Secret Manager, service accounts, and cloud services.',
    icon: <Cloud size={18} />, color: '#4285f4', settingKey: 'gcp_secrets',
    fields: [
      { key: 'project_id', label: 'Project ID', placeholder: 'my-gcp-project' },
      { key: 'service_account_json', label: 'Service Account JSON', placeholder: '{"type":"service_account"…}', secret: true },
    ],
  },
  // Monitoring
  {
    id: 'grafana_external', name: 'Grafana', category: 'monitoring',
    description: 'Embed dashboards from an external Grafana instance.',
    icon: <BarChart2 size={18} />, color: '#f46800', settingKey: 'grafana_external',
    fields: [
      { key: 'url', label: 'Grafana URL', placeholder: 'https://grafana.company.com' },
      { key: 'api_key', label: 'Service Account Token', placeholder: 'glsa_xxxxxxxxxxxx', secret: true },
    ],
  },
  {
    id: 'datadog', name: 'Datadog', category: 'monitoring',
    description: 'Send metrics and events to Datadog.',
    icon: <BarChart2 size={18} />, color: '#632ca6', settingKey: 'datadog',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'Your Datadog API key', secret: true },
      { key: 'app_key', label: 'Application Key', placeholder: 'Your Datadog app key', secret: true },
      { key: 'site', label: 'Site', placeholder: 'datadoghq.com' },
    ],
  },
  {
    id: 'newrelic', name: 'New Relic', category: 'monitoring',
    description: 'Forward metrics and traces to New Relic.',
    icon: <Activity size={18} />, color: '#1ce783', settingKey: 'newrelic',
    fields: [
      { key: 'license_key', label: 'License Key', placeholder: 'Your New Relic license key', secret: true },
      { key: 'account_id', label: 'Account ID', placeholder: '1234567' },
    ],
  },
  {
    id: 'prometheus_external', name: 'Prometheus', category: 'monitoring',
    description: 'Connect an external Prometheus instance.',
    icon: <Zap size={18} />, color: '#e6522c', settingKey: 'prometheus_external',
    fields: [
      { key: 'url', label: 'Prometheus URL', placeholder: 'https://prometheus.company.com' },
      { key: 'username', label: 'Username (optional)', placeholder: 'For basic auth' },
      { key: 'password', label: 'Password (optional)', placeholder: 'For basic auth', secret: true },
    ],
  },
];

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'source-control', label: 'Source Control' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'monitoring', label: 'Monitoring' },
];

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

function AddModal({ entry, onClose, onSaved }: { entry: CatalogEntry; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const qc = useQueryClient();
  const { addCluster } = useClusterStore();

  // Cluster-specific form
  const [clusterForm, setClusterForm] = useState({ name: '', environment: 'dev', connection_type: 'token', api_url: '', token: '' });

  async function handleSave() {
    setSaving(true); setError('');
    try {
      if (entry.special === 'cluster') {
        if (!clusterForm.name.trim()) throw new Error('Cluster name is required');
        const r = await fetch('/api/settings/clusters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clusterForm) });
        if (!r.ok) throw new Error((await r.json()).detail ?? 'Failed');
        const d = await r.json();
        addCluster(d.cluster);
        qc.invalidateQueries({ queryKey: ['platforms-clusters'] });
      } else if (entry.special === 'github') {
        if (!form.pat?.trim()) throw new Error('Token is required');
        const vr = await fetch('/api/github/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pat: form.pat }) });
        const vd = await vr.json();
        if (!vd.success) throw new Error(vd.error ?? 'Invalid token');
        await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.pat', value: form.pat }) });
        if (vd.username) await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.username', value: vd.username }) });
        if (vd.expires_at) await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.pat_expires_at', value: vd.expires_at }) });
      } else {
        // Validate at least the first required field is filled
        const firstField = entry.fields[0];
        if (firstField && !form[firstField.key]?.trim()) throw new Error(`${firstField.label} is required`);
        const r = await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: entry.settingKey, value: JSON.stringify({ ...form, connected: true }) }) });
        if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error((body as Record<string, string>).detail ?? 'Save failed'); }
      }
      qc.invalidateQueries({ queryKey: ['platform-data'] });
      setSaved(true);
      setTimeout(() => { onSaved(); }, 1400);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: V.bg, border: `1px solid ${V.border}`,
    borderRadius: 8, padding: '0.5rem 0.75rem', color: V.text,
    fontSize: '0.875rem', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 14, width: '100%', maxWidth: 480 }}>

        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${V.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: `${entry.color}18`, border: `1px solid ${entry.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: entry.color, flexShrink: 0 }}>
            {entry.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: V.text }}>Connect {entry.name}</div>
            <div style={{ fontSize: '0.78rem', color: V.muted }}>{entry.description}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: V.muted, cursor: 'pointer', padding: 4 }}><X size={16} /></button>
        </div>

        {/* Modal body */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {entry.special === 'cluster' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>Cluster Name *</label>
                  <input value={clusterForm.name} onChange={e => setClusterForm(f => ({ ...f, name: e.target.value }))} placeholder="prod-eks" style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>Environment</label>
                  <select value={clusterForm.environment} onChange={e => setClusterForm(f => ({ ...f, environment: e.target.value }))}
                    style={{ ...inputStyle, colorScheme: 'dark' }}>
                    <option value="dev">dev</option><option value="staging">staging</option><option value="prod">prod</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>API Server URL</label>
                <input value={clusterForm.api_url} onChange={e => setClusterForm(f => ({ ...f, api_url: e.target.value }))} placeholder="https://k8s.example.com:6443" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>Bearer Token</label>
                <input type="password" value={clusterForm.token} onChange={e => setClusterForm(f => ({ ...f, token: e.target.value }))} placeholder="eyJhbGci…" style={inputStyle} />
              </div>
            </>
          ) : (
            <>
              {entry.fields.map(f => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>{f.label}</label>
                  {f.hint && <div style={{ fontSize: '0.73rem', color: V.muted, marginBottom: 6, opacity: 0.8 }}>{f.hint}</div>}
                  <input
                    type={f.secret ? 'password' : 'text'}
                    value={form[f.key] ?? ''}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={inputStyle}
                  />
                </div>
              ))}
              {entry.special === 'github' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '8px 12px' }}>
                  <span style={{ fontSize: '0.75rem', color: V.muted }}>Need to create a token first?</span>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo,workflow,write:packages&description=InfraPilot"
                    target="_blank" rel="noreferrer"
                    style={{ padding: '4px 12px', background: '#24292f', borderRadius: 6, color: '#fff', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <GitBranch size={11} /> Create PAT →
                  </a>
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{ fontSize: '0.8rem', color: V.red, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 7, padding: '8px 12px' }}>
              <X size={12} style={{ flexShrink: 0 }} />{error}
            </div>
          )}
          {saved && (
            <div style={{ fontSize: '0.8rem', color: V.green, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 7, padding: '8px 12px' }}>
              <CheckCircle2 size={12} style={{ flexShrink: 0 }} />{entry.name} connected successfully
            </div>
          )}

          {!saved && (
            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <button type="button" onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={14} />}
                {saving ? 'Connecting…' : (entry.special === 'github' ? 'Validate & Connect' : 'Connect')}
              </button>
              <button type="button" onClick={onClose}
                style={{ padding: '0.55rem 1.25rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.875rem', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Edit Cluster Modal ───────────────────────────────────────────────────────

function EditClusterModal({ cluster, onClose, onSaved }: { cluster: ClusterConfig; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ environment: cluster.environment, api_url: cluster.api_url ?? '', token: '' });
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ healthy: boolean; friendly: string; raw?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const isKubeconfig = cluster.connection_type === 'kubeconfig';
  const tokenTyped = form.token.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    try {
      const patch: Record<string, string> = {
        environment: form.environment,
        api_url: form.api_url,
      };
      if (tokenTyped) patch.token = form.token.trim();
      await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      qc.invalidateQueries({ queryKey: ['platforms-clusters'] });
      onSaved();
    } finally { setSaving(false); }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const patch: Record<string, string> = { api_url: form.api_url };
      if (tokenTyped) patch.token = form.token.trim();
      const r = await fetch(`/api/settings/clusters/${encodeURIComponent(cluster.name)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await r.json();
      const rawError = data.error ?? '';
      const friendlyMsg = data.healthy
        ? `Connected — ${data.node_count ?? '?'} node(s)${data.version ? `, ${data.version}` : ''}`
        : (data.friendly ?? friendlyClusterError(rawError || 'Unknown error'));
      setTestResult({
        healthy: data.healthy,
        friendly: friendlyMsg,
        raw: rawError && rawError !== friendlyMsg ? rawError : undefined,
      });
    } catch {
      setTestResult({ healthy: false, friendly: 'Request failed — is the backend running?' });
    } finally { setTesting(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: V.bg, border: `1px solid ${V.border}`,
    borderRadius: 8, padding: '0.5rem 0.75rem', color: V.text,
    fontSize: '0.875rem', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 14, width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '1.25rem 1.5rem', borderBottom: `1px solid ${V.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#326ce518', border: '1px solid #326ce530', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#326ce5', flexShrink: 0 }}>
            <Server size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: V.text }}>Edit Cluster</div>
            <div style={{ fontSize: '0.78rem', color: V.muted }}>{cluster.name} · {isKubeconfig ? 'kubeconfig mode' : 'token mode'}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: V.muted, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

          {/* Kubeconfig → token mode notice */}
          {isKubeconfig && (
            <div style={{ fontSize: '0.78rem', color: V.yellow, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
              This cluster uses a kubeconfig file. Paste your new bearer token below — the cluster will automatically switch to token auth.
              {!form.api_url.trim() && (
                <><br /><span style={{ opacity: 0.8 }}>Also enter the API Server URL (https://…) if it's different from the kubeconfig.</span></>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>Name</label>
              <div style={{ ...inputStyle, color: V.muted, background: `${V.bg}88`, userSelect: 'none' }}>{cluster.name}</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>Environment</label>
              <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value as 'dev' | 'staging' | 'prod' }))} style={{ ...inputStyle, colorScheme: 'dark' }}>
                <option value="dev">dev</option><option value="staging">staging</option><option value="prod">prod</option>
              </select>
            </div>
          </div>
          {(() => {
            // Red border when api_url is blank and we'll need it:
            // - token-mode clusters always need an API URL
            // - kubeconfig clusters need one when switching to token auth (tokenTyped)
            const apiUrlRequired = !form.api_url.trim() && (!isKubeconfig || tokenTyped);
            return (
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: apiUrlRequired ? V.red : V.muted, marginBottom: 4 }}>
                  API Server URL{apiUrlRequired ? ' — required when switching to token auth' : (isKubeconfig ? ' — auto-extracted from kubeconfig if blank' : '')}
                </label>
                <input
                  value={form.api_url}
                  onChange={e => setForm(f => ({ ...f, api_url: e.target.value }))}
                  placeholder="https://k8s.example.com:6443"
                  style={{ ...inputStyle, border: apiUrlRequired ? `1px solid ${V.red}` : inputStyle.border }}
                />
                {apiUrlRequired && (
                  <div style={{ fontSize: '0.74rem', color: V.red, marginTop: 4, lineHeight: 1.4 }}>
                    Enter the API Server URL so the token knows which cluster to connect to
                  </div>
                )}
              </div>
            );
          })()}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: V.muted, marginBottom: 4 }}>
              New Bearer Token <span style={{ fontWeight: 400 }}>— leave blank to keep existing</span>
            </label>
            <input
              type="password"
              value={form.token}
              onChange={e => { setForm(f => ({ ...f, token: e.target.value })); setTestResult(null); }}
              placeholder="eyJhbGci… (paste new token here)"
              style={inputStyle}
            />
          </div>

          {/* Test result */}
          {testResult && (
            <div style={{
              borderRadius: 7,
              background: testResult.healthy ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
              border: `1px solid ${testResult.healthy ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
              overflow: 'hidden',
            }}>
              <div style={{ padding: '8px 12px', fontSize: '0.82rem', color: testResult.healthy ? V.green : V.red, display: 'flex', alignItems: 'center', gap: 6 }}>
                {testResult.healthy ? <CheckCircle2 size={13} /> : <X size={13} />}
                {testResult.friendly}
              </div>
              {!testResult.healthy && testResult.raw && testResult.raw !== testResult.friendly && (
                <div style={{ borderTop: `1px solid rgba(248,113,113,0.15)`, padding: '6px 12px', fontSize: '0.72rem', color: V.muted, fontFamily: 'var(--font-mono)', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {testResult.raw.slice(0, 300)}{testResult.raw.length > 300 ? '…' : ''}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
            <button type="button" onClick={handleTest} disabled={testing}
              style={{ padding: '0.55rem 1rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: testing ? V.muted : V.text, fontSize: '0.875rem', cursor: testing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              {testing && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={onClose}
              style={{ padding: '0.55rem 1.25rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.875rem', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function friendlyClusterError(raw: string): string {
  const e = raw.toLowerCase();
  if (e.includes('unauthorized') || e.includes('403') || e.includes('401')) return 'Token rejected — update your bearer token';
  if (e.includes('certificate') || e.includes('x509')) return 'TLS certificate expired or untrusted';
  if (e.includes('refused')) return 'Connection refused — check the API server URL and port';
  if (e.includes('timeout') || e.includes('deadline') || e.includes('context deadline')) return 'Connection timed out — cluster may be unreachable';
  if (e.includes('no such host') || e.includes('lookup')) return 'Hostname not found — check the API server URL';
  if (e.includes('kubectl not found')) return 'kubectl is not installed on the server';
  return raw.length > 100 ? raw.slice(0, 100) + '…' : raw;
}

// ─── Connected item row ───────────────────────────────────────────────────────

function ConnectedRow({
  entry, detail, warning, onEdit, onDisconnect,
}: {
  entry: CatalogEntry; detail: string; warning?: string; onEdit: () => void; onDisconnect: () => void;
}) {
  const catLabel = CATEGORIES.find(c => c.id === entry.category)?.label ?? '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0.875rem 1rem', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${entry.color}18`, border: `1px solid ${entry.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: entry.color, flexShrink: 0 }}>
        {entry.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: V.text }}>{entry.name}</span>
          <span style={{ fontSize: '0.68rem', color: V.green, background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)', padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>● Connected</span>
          <span style={{ fontSize: '0.68rem', color: V.muted, background: V.bg, border: `1px solid ${V.border}`, padding: '1px 7px', borderRadius: 100 }}>{catLabel}</span>
          {warning && (
            <span style={{ fontSize: '0.68rem', color: '#e6a817', background: 'rgba(230,168,23,0.12)', border: '1px solid rgba(230,168,23,0.3)', padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>
              ⚠ {warning}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: V.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button type="button" onClick={onEdit}
          style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Edit2 size={11} /> Edit
        </button>
        <button type="button" onClick={onDisconnect}
          style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid rgba(248,81,73,0.3)`, background: 'transparent', color: V.red, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Trash2 size={11} /> Remove
        </button>
      </div>
    </div>
  );
}

// ─── Catalog result card ──────────────────────────────────────────────────────

function CatalogCard({ entry, isConnected, onAdd }: { entry: CatalogEntry; isConnected: boolean; onAdd: () => void }) {
  const catLabel = CATEGORIES.find(c => c.id === entry.category)?.label ?? '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0.875rem 1rem', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, transition: 'border-color 0.15s' }}>
      <div style={{ width: 38, height: 38, borderRadius: 9, background: `${entry.color}18`, border: `1px solid ${entry.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: entry.color, flexShrink: 0 }}>
        {entry.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
          <span style={{ fontSize: '0.88rem', fontWeight: 600, color: V.text }}>{entry.name}</span>
          <span style={{ fontSize: '0.67rem', color: V.muted, background: V.bg, border: `1px solid ${V.border}`, padding: '1px 6px', borderRadius: 100 }}>{catLabel}</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: V.muted }}>{entry.description}</div>
      </div>
      {isConnected ? (
        <span style={{ fontSize: '0.72rem', color: V.green, background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)', padding: '3px 10px', borderRadius: 100, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
          ● Connected
        </span>
      ) : (
        <button type="button" onClick={onAdd}
          style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={12} /> Add
        </button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlatformsPage() {
  const { removeCluster } = useClusterStore();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [addEntry, setAddEntry] = useState<CatalogEntry | null>(null);
  const [editCluster, setEditCluster] = useState<ClusterConfig | null>(null);
  const [editEntry, setEditEntry] = useState<CatalogEntry | null>(null);

  // ── Fetch platform data ──
  const { data: platformData = {}, refetch: refetchPlatform } = useQuery<Record<string, Record<string, string> | string>>({
    queryKey: ['platform-data'],
    queryFn: () => fetch('/api/settings/platform').then(r => r.json()),
    staleTime: 10_000,
  });

  const { data: clusters = [], refetch: refetchClusters } = useQuery<ClusterConfig[]>({
    queryKey: ['platforms-clusters'],
    queryFn: () => fetch('/api/settings/clusters').then(r => r.json()).then(d => d.clusters ?? []),
    staleTime: 10_000,
  });

  // Live health state for each cluster — checked on load
  const [clusterHealth, setClusterHealth] = useState<
    Record<string, { loading: boolean; healthy: boolean; error?: string }>
  >({});

  useEffect(() => {
    if (clusters.length === 0) return;
    // Mark all as loading, then fire checks in parallel
    setClusterHealth(prev => {
      const next = { ...prev };
      for (const c of clusters) next[c.name] = { loading: true, healthy: false };
      return next;
    });
    for (const c of clusters) {
      fetch(`/api/settings/clusters/${encodeURIComponent(c.name)}/test`, { method: 'POST' })
        .then(r => r.json())
        .then((res: { healthy: boolean; error?: string }) => {
          setClusterHealth(prev => ({ ...prev, [c.name]: { loading: false, healthy: res.healthy, error: res.error } }));
        })
        .catch(() => {
          setClusterHealth(prev => ({ ...prev, [c.name]: { loading: false, healthy: false, error: 'Request failed' } }));
        });
    }
  }, [clusters]);

  // ── Derive which catalog entries are connected ──
  const connectedIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    const gh = platformData.github as Record<string, string> | undefined;
    if (gh?.pat) ids.add('github');
    for (const entry of CATALOG) {
      if (entry.special === 'github' || entry.special === 'cluster') continue;
      const val = platformData[entry.settingKey] as Record<string, string> | undefined;
      if (val?.connected) ids.add(entry.id);
    }
    if (clusters.length > 0) ids.add('cluster');
    return ids;
  }, [platformData, clusters]);

  // ── Search / filter logic ──
  const q = search.toLowerCase().trim();
  const filtered = useMemo(() => CATALOG.filter(e => {
    const matchCat = category === 'all' || e.category === category;
    const matchSearch = !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.category.includes(q);
    return matchCat && matchSearch;
  }), [q, category]);

  async function disconnectEntry(entry: CatalogEntry) {
    if (!confirm(`Remove ${entry.name}?`)) return;
    if (entry.special === 'github') {
      await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.pat', value: '' }) });
    } else {
      await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: entry.settingKey, value: '' }) });
    }
    refetchPlatform();
  }

  async function disconnectCluster(name: string) {
    if (!confirm(`Remove cluster "${name}"?`)) return;
    await fetch(`/api/settings/clusters/${encodeURIComponent(name)}`, { method: 'DELETE' });
    removeCluster(name);
    refetchClusters();
  }

  function connectedDetail(entry: CatalogEntry): string {
    if (entry.special === 'github') {
      const gh = platformData.github as Record<string, string> | undefined;
      const parts: string[] = [];
      if (gh?.username) parts.push(`@${gh.username}`);
      if (gh?.pat_expires_at) {
        const exp = new Date(gh.pat_expires_at);
        const days = Math.ceil((exp.getTime() - Date.now()) / 86400000);
        if (days < 0) parts.push('Token expired');
        else if (days === 0) parts.push('Expires today');
        else parts.push(`Expires ${exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
      }
      return parts.join(' · ') || 'Connected';
    }
    return 'Credentials saved';
  }

  function githubExpiryWarning(): string | undefined {
    const gh = platformData.github as Record<string, string> | undefined;
    if (!gh?.pat_expires_at) return undefined;
    const days = Math.ceil((new Date(gh.pat_expires_at).getTime() - Date.now()) / 86400000);
    if (days < 0) return 'Token expired';
    if (days <= 10) return 'Expiring soon';
    return undefined;
  }

  function clusterStatusBadge(name: string): { label: string; color: string; bg: string; border: string } {
    const h = clusterHealth[name];
    if (!h || h.loading) return { label: '○ Checking…', color: V.muted, bg: `${V.border}22`, border: V.border };
    if (h.healthy) return { label: '● Reachable', color: V.green, bg: 'rgba(63,185,80,0.1)', border: 'rgba(63,185,80,0.2)' };
    const err = (h.error ?? '').toLowerCase();
    if (err.includes('unauthorized') || err.includes('403') || err.includes('401'))
      return { label: '✗ Token expired', color: V.red, bg: 'rgba(248,81,73,0.1)', border: 'rgba(248,81,73,0.25)' };
    if (err.includes('certificate') || err.includes('x509') || err.includes('cert'))
      return { label: '✗ Cert expired', color: V.red, bg: 'rgba(248,81,73,0.1)', border: 'rgba(248,81,73,0.25)' };
    if (err.includes('refused') || err.includes('timeout') || err.includes('deadline') || err.includes('no such host'))
      return { label: '⚠ Unreachable', color: V.yellow, bg: 'rgba(230,168,23,0.1)', border: 'rgba(230,168,23,0.25)' };
    return { label: '⚠ Auth failed', color: V.red, bg: 'rgba(248,81,73,0.1)', border: 'rgba(248,81,73,0.25)' };
  }

  const showSearch = q.length > 0 || category !== 'all';
  const connectedSingletons = CATALOG.filter(e => e.special !== 'cluster' && connectedIds.has(e.id));

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.75rem 1.5rem' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '1.35rem', fontWeight: 700, color: V.text }}>Integrations</h1>
        <p style={{ margin: 0, color: V.muted, fontSize: '0.85rem' }}>Search and connect external services to InfraPilot.</p>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: '0.875rem' }}>
        <Search size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search integrations — GitHub, AWS, Datadog, Vault…"
          style={{
            width: '100%', boxSizing: 'border-box', paddingLeft: 40, paddingRight: search ? 36 : 14,
            paddingTop: '0.65rem', paddingBottom: '0.65rem',
            background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10,
            color: V.text, fontSize: '0.9rem', outline: 'none',
          }}
        />
        {search && (
          <button type="button" onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 2 }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button key={c.id} type="button" onClick={() => setCategory(c.id)}
            style={{
              padding: '4px 14px', borderRadius: 100, border: `1px solid ${category === c.id ? V.accent : V.border}`,
              background: category === c.id ? `${V.accent}18` : 'transparent',
              color: category === c.id ? V.accent : V.muted,
              fontSize: '0.78rem', fontWeight: category === c.id ? 700 : 400, cursor: 'pointer',
            }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Search results ── */}
      {showSearch ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: V.muted, fontSize: '0.875rem', background: V.surface, borderRadius: 10, border: `1px solid ${V.border}` }}>
              No integrations found for "{search || CATEGORIES.find(c => c.id === category)?.label}"
            </div>
          ) : (
            filtered.map(entry => (
              <CatalogCard
                key={entry.id}
                entry={entry}
                isConnected={connectedIds.has(entry.id)}
                onAdd={() => setAddEntry(entry)}
              />
            ))
          )}
        </div>
      ) : (
        /* ── Connected view (no active search) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Connected singletons (GitHub, GitLab, Cloudflare, etc.) */}
          {connectedSingletons.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', color: V.muted, textTransform: 'uppercase', marginBottom: '0.625rem' }}>
                Connected — {connectedSingletons.length + (clusters.length > 0 ? clusters.length : 0)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {connectedSingletons.map(entry => (
                  <ConnectedRow
                    key={entry.id}
                    entry={entry}
                    detail={connectedDetail(entry)}
                    warning={entry.special === 'github' ? githubExpiryWarning() : undefined}
                    onEdit={() => setEditEntry(entry)}
                    onDisconnect={() => disconnectEntry(entry)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Connected clusters */}
          {clusters.length > 0 && (
            <div>
              {connectedSingletons.length === 0 && (
                <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', color: V.muted, textTransform: 'uppercase', marginBottom: '0.625rem' }}>
                  Connected — {clusters.length}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {clusters.map(c => {
                  const badge = clusterStatusBadge(c.name);
                  const h = clusterHealth[c.name];
                  return (
                    <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0.875rem 1rem', background: V.surface, border: `1px solid ${h && !h.loading && !h.healthy ? 'rgba(248,81,73,0.25)' : V.border}`, borderRadius: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#326ce518', border: '1px solid #326ce530', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#326ce5', flexShrink: 0 }}>
                        <Server size={18} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: V.text }}>{c.name}</span>
                          <span style={{ fontSize: '0.68rem', color: badge.color, background: badge.bg, border: `1px solid ${badge.border}`, padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>
                            {badge.label}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: V.muted, background: V.bg, border: `1px solid ${V.border}`, padding: '1px 7px', borderRadius: 100 }}>{c.environment}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: V.muted }}>{c.api_url || 'Bearer token auth'}</div>
                        {h && !h.loading && !h.healthy && h.error && (
                          <div style={{ fontSize: '0.72rem', color: V.red, marginTop: 2 }}>
                            {friendlyClusterError(h.error)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button type="button" onClick={() => setEditCluster(c)}
                          style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Edit2 size={11} /> Edit
                        </button>
                        <button type="button" onClick={() => disconnectCluster(c.name)}
                          style={{ padding: '5px 10px', borderRadius: 7, border: 'solid rgba(248,81,73,0.3)', borderWidth: 1, background: 'transparent', color: V.red, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Trash2 size={11} /> Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add cluster button (always visible) */}
          <div>
            <button type="button" onClick={() => setAddEntry(CATALOG.find(e => e.id === 'cluster')!)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.875rem', borderRadius: 8, border: `1px dashed ${V.border}`, background: 'transparent', color: V.muted, fontSize: '0.8rem', cursor: 'pointer' }}>
              <Plus size={13} /> Add Kubernetes Cluster
            </button>
          </div>

          {/* Empty state */}
          {connectedSingletons.length === 0 && clusters.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔌</div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: V.text, marginBottom: 6 }}>No integrations connected yet</div>
              <div style={{ fontSize: '0.85rem', color: V.muted, marginBottom: 20 }}>Search above to add GitHub, AWS, Datadog, Vault, and more.</div>
              <button type="button" onClick={() => { const el = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement; el?.focus(); }}
                style={{ padding: '0.55rem 1.25rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Search size={14} /> Search integrations
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {addEntry && (
        <AddModal
          entry={addEntry}
          onClose={() => setAddEntry(null)}
          onSaved={() => { setAddEntry(null); refetchPlatform(); refetchClusters(); }}
        />
      )}

      {editEntry && (
        <AddModal
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => { setEditEntry(null); refetchPlatform(); }}
        />
      )}

      {editCluster && (
        <EditClusterModal
          cluster={editCluster}
          onClose={() => setEditCluster(null)}
          onSaved={() => { setEditCluster(null); refetchClusters(); }}
        />
      )}
    </div>
  );
}
