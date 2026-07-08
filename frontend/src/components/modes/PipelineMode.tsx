import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Rocket, Search, Play, Pause, RotateCcw, CheckCircle2, AlertCircle, Loader2, Upload, X, KeyRound, ExternalLink, Globe } from 'lucide-react';
import { useAgent } from '../../hooks/useAgent';
import { useClusterStore } from '../../store/clusterStore';
import { TaskList } from '../shared/TaskList';
import type { PipelineConfig, RepoAnalysis } from '../../types';

type Phase = 'intake' | 'analyzing' | 'ready' | 'running' | 'done';

const IaC_TOOLS = ['kustomize', 'helm'] as const;

// ─── Shared sub-components (must be outside parent components to avoid remount) ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 600, color: ok === true ? 'var(--success)' : ok === false ? 'var(--error)' : 'var(--text-primary)' }}>
        {ok === true ? '✓ ' : ok === false ? '✗ ' : ''}{value}
      </span>
    </div>
  );
}

// ─── Intake form ──────────────────────────────────────────────────────────────

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = val;
  }
  return result;
}

function IntakeForm({ onAnalyze, initialRepoUrl = '', initialPrivate = false }: { onAnalyze: (cfg: Omit<PipelineConfig, 'analysis' | 'clarifications'>) => void; initialRepoUrl?: string; initialPrivate?: boolean }) {
  const { clusters, activeCluster } = useClusterStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savedCreds, setSavedCreds] = useState<{ username: string; hasPat: boolean } | null>(null);
  const [connectedDns, setConnectedDns] = useState({
    cloudflare: false, route53: false, azure_dns: false, gcp_dns: false,
  });
  const [form, setForm] = useState({
    app_name: '',
    repo_url: initialRepoUrl,
    private_repo: initialPrivate,
    gitops_repo: '',
    gitops_same: true,
    gitops_path: '/deployments',
    namespace: '',
    target_url: '',
    publish_mode: 'none' as 'none' | 'infrapilot' | 'cloudflare' | 'route53' | 'azure_dns' | 'gcp_dns',
    iac_tool: 'kustomize' as 'kustomize' | 'helm',
    registry: 'ghcr.io',
    selected_clusters: activeCluster ? [activeCluster] : [] as string[],
    github_pat: '',
    github_username: '',
    vault_strategy: 'shared' as 'shared' | 'separate',
    env_vars: {} as Record<string, string>,
    env_file_name: '',
    rotate_vault_secret: false,
  });

  // Load saved GitHub credentials + DNS platform connected states
  useEffect(() => {
    fetch('/api/settings/platform')
      .then((r) => r.json())
      .then((data) => {
        const pat = data?.github?.pat ?? '';
        const username = data?.github?.username ?? '';
        if (pat) setSavedCreds({ username, hasPat: true });
        setConnectedDns({
          cloudflare: data?.cloudflare?.connected ?? false,
          route53: data?.route53?.connected ?? false,
          azure_dns: data?.azure_dns?.connected ?? false,
          gcp_dns: data?.gcp_dns?.connected ?? false,
        });
      })
      .catch(() => {});
  }, []);

  const inputStyle = {
    width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: '5px', color: 'var(--text-primary)', fontSize: '13px',
    padding: '8px 10px', outline: 'none', fontFamily: 'inherit',
  };

  const toggleCluster = (name: string) =>
    setForm((f) => ({
      ...f,
      selected_clusters: f.selected_clusters.includes(name)
        ? f.selected_clusters.filter((x) => x !== name)
        : [...f.selected_clusters, name],
    }));

  const canSubmit = form.app_name.trim() && form.repo_url.trim() && form.selected_clusters.length > 0;

  function handleEnvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const parsed = parseEnvFile(content);
      setForm((f) => ({ ...f, env_vars: parsed, env_file_name: file.name }));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div style={{ maxWidth: '700px', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(99,102,241,0.15)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Rocket size={18} color="var(--accent)" />
        </div>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>New Deployment</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>From GitHub repo to live URL in one pipeline</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Field label="App Name">
            <input value={form.app_name} onChange={(e) => { setForm((f) => ({ ...f, app_name: e.target.value, namespace: f.namespace || e.target.value })); }} placeholder="my-app" style={inputStyle} />
          </Field>
          <Field label="Target Namespace">
            <input value={form.namespace} onChange={(e) => setForm((f) => ({ ...f, namespace: e.target.value }))} placeholder={form.app_name || 'default'} style={inputStyle} />
          </Field>
        </div>

        <Field label="GitHub Repository URL">
          <input value={form.repo_url} onChange={(e) => setForm((f) => ({ ...f, repo_url: e.target.value }))} placeholder="https://github.com/org/repo" style={inputStyle} />
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={form.private_repo} onChange={(e) => setForm((f) => ({ ...f, private_repo: e.target.checked }))} style={{ accentColor: 'var(--accent)' }} />
            Private repo
          </label>
        </div>

        {form.private_repo && (
          savedCreds?.hasPat ? (
            /* Saved credentials detected — no manual entry needed */
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(52,211,153,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <KeyRound size={14} style={{ color: 'var(--success)' }} />
                </div>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', margin: 0 }}>GitHub credentials saved</p>
                  {savedCreds.username && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                      Deploying as <strong style={{ color: 'var(--text-secondary)' }}>{savedCreds.username}</strong>
                    </p>
                  )}
                </div>
              </div>
              <a href="/app/settings" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none' }}>
                Change <ExternalLink size={10} />
              </a>
            </div>
          ) : (
            /* No saved credentials — show manual fields with settings link */
            <div style={{ padding: '12px', background: 'var(--bg-hover)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <Field label="GitHub Username">
                  <input value={form.github_username} onChange={(e) => setForm((f) => ({ ...f, github_username: e.target.value }))} placeholder="octocat" style={inputStyle} />
                </Field>
                <Field label="Personal Access Token">
                  <input type="password" value={form.github_pat} onChange={(e) => setForm((f) => ({ ...f, github_pat: e.target.value }))} placeholder="ghp_..." style={inputStyle} />
                </Field>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                Or <a href="/app/settings" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>save your PAT in Settings</a> once and never enter it again.
              </p>
            </div>
          )
        )}

        <div>
          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            GitOps Repo
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            {(['Same repo', 'Separate repo'] as const).map((opt) => {
              const isSame = opt === 'Same repo';
              const active = form.gitops_same === isSame;
              return (
                <button key={opt} onClick={() => setForm((f) => ({ ...f, gitops_same: isSame }))} style={{ padding: '5px 12px', background: active ? 'var(--accent-glow)' : 'transparent', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '5px', color: active ? 'var(--accent)' : 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {opt}
                </button>
              );
            })}
          </div>
          {!form.gitops_same && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
              <input value={form.gitops_repo} onChange={(e) => setForm((f) => ({ ...f, gitops_repo: e.target.value }))} placeholder="https://github.com/org/gitops" style={inputStyle} />
              <input value={form.gitops_path} onChange={(e) => setForm((f) => ({ ...f, gitops_path: e.target.value }))} placeholder="/deployments" style={inputStyle} />
            </div>
          )}
        </div>

        {/* ── Publish section ──────────────────────────────────────────── */}
        <div>
          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Globe size={11} /> Publish
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {(
              [
                { id: 'none', label: 'No Publish', always: true },
                { id: 'infrapilot', label: '⬡ infrapilot.app', always: true },
                { id: 'cloudflare', label: '☁ Cloudflare', always: false, key: 'cloudflare' as const },
                { id: 'route53', label: '⬡ Route 53', always: false, key: 'route53' as const },
                { id: 'azure_dns', label: '⬡ Azure DNS', always: false, key: 'azure_dns' as const },
                { id: 'gcp_dns', label: '⬡ GCP DNS', always: false, key: 'gcp_dns' as const },
              ] as { id: string; label: string; always: boolean; key?: keyof typeof connectedDns }[]
            )
              .filter((m) => m.always || (m.key && connectedDns[m.key]))
              .map((mode) => {
                const active = form.publish_mode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, publish_mode: mode.id as typeof f.publish_mode }))}
                    style={{ padding: '5px 12px', background: active ? 'var(--accent-glow)' : 'transparent', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '5px', color: active ? 'var(--accent)' : 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 600 : 400 }}
                  >
                    {mode.label}
                  </button>
                );
              })}
          </div>
          {form.publish_mode === 'infrapilot' && (
            <div style={{ padding: '8px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Globe size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Your app will be available at </span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {form.app_name
                  ? `${form.app_name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.infrapilot.app`
                  : '<app-name>.infrapilot.app'}
              </span>
            </div>
          )}
          {['cloudflare', 'route53', 'azure_dns', 'gcp_dns'].includes(form.publish_mode) && (
            <input
              value={form.target_url}
              onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))}
              placeholder="myapp.company.com"
              style={inputStyle}
            />
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>IaC Tool</p>
            <div style={{ display: 'flex', gap: '6px' }}>
              {IaC_TOOLS.map((t) => (
                <button key={t} onClick={() => setForm((f) => ({ ...f, iac_tool: t }))} style={{ flex: 1, padding: '6px', background: form.iac_tool === t ? 'var(--accent-glow)' : 'transparent', border: `1px solid ${form.iac_tool === t ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '5px', color: form.iac_tool === t ? 'var(--accent)' : 'var(--text-muted)', fontSize: '12px', fontWeight: form.iac_tool === t ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <Field label="Container Registry">
            <select value={form.registry} onChange={(e) => setForm((f) => ({ ...f, registry: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
              {['ghcr.io', 'docker.io', 'ecr.aws', 'azurecr.io', 'gcr.io'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
        </div>

        {/* Cluster targets */}
        <div>
          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Cluster Targets
          </p>
          {clusters.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--warning)' }}>⚠ No clusters configured. Complete onboarding first.</p>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {clusters.map((c) => {
                const active = form.selected_clusters.includes(c.name);
                return (
                  <button key={c.name} onClick={() => toggleCluster(c.name)} style={{ padding: '5px 12px', background: active ? 'var(--accent-glow)' : 'transparent', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '5px', color: active ? 'var(--accent)' : 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {c.name} ({c.environment})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Vault Secrets */}
        <div>
          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Vault Secret Strategy
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            {(['shared', 'separate'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setForm((f) => ({ ...f, vault_strategy: s }))}
                style={{
                  flex: 1, padding: '6px 10px',
                  background: form.vault_strategy === s ? 'var(--accent-glow)' : 'transparent',
                  border: `1px solid ${form.vault_strategy === s ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: '5px',
                  color: form.vault_strategy === s ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {s === 'shared' ? 'Shared (dev + prod)' : 'Separate per environment'}
              </button>
            ))}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
            {form.vault_strategy === 'shared'
              ? `Path: secret/${form.app_name || '<app>'} — dev and prod share one secret`
              : `Paths: secret/${form.app_name || '<app>'}/dev  and  secret/${form.app_name || '<app>'}/prod`}
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={form.rotate_vault_secret}
              onChange={(e) => setForm((f) => ({ ...f, rotate_vault_secret: e.target.checked }))}
              style={{ accentColor: 'var(--accent)' }}
            />
            Rotate secret if it already exists (delete K8s CSI secret + restart deployment)
          </label>

          {/* .env file upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".env,text/plain"
            aria-label="Upload .env file"
            title="Upload .env file"
            style={{ display: 'none' }}
            onChange={handleEnvFile}
          />
          {form.env_file_name ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: '6px' }}>
              <CheckCircle2 size={14} color="var(--success)" />
              <span style={{ flex: 1, fontSize: '12px', color: 'var(--text-primary)' }}>
                {form.env_file_name} — {Object.keys(form.env_vars).length} keys: {Object.keys(form.env_vars).slice(0, 5).join(', ')}{Object.keys(form.env_vars).length > 5 ? '…' : ''}
              </span>
              <button
                type="button"
                title="Remove .env file"
                onClick={() => setForm((f) => ({ ...f, env_vars: {}, env_file_name: '' }))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{ width: '100%', padding: '8px', background: 'transparent', border: '1px dashed var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontFamily: 'inherit' }}
            >
              <Upload size={13} /> Upload .env file (optional — keys stored in Vault)
            </button>
          )}
        </div>

        <button
          onClick={() => {
            if (!canSubmit) return;
            const appSlug = form.app_name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            const resolvedTargetUrl =
              form.publish_mode === 'infrapilot'
                ? `${appSlug}.infrapilot.app`
                : form.publish_mode === 'none'
                ? ''
                : form.target_url.trim();
            onAnalyze({
              app_name: form.app_name.trim(),
              repo_url: form.repo_url.trim(),
              private_repo: form.private_repo,
              gitops_repo: form.gitops_same ? form.repo_url.trim() : form.gitops_repo.trim(),
              gitops_path: form.gitops_path,
              namespace: form.namespace || form.app_name.trim(),
              target_url: resolvedTargetUrl,
              publish_mode: form.publish_mode,
              cluster: form.selected_clusters[0] ?? '',
              iac_tool: form.iac_tool,
              registry: form.registry,
              github_pat: form.private_repo ? form.github_pat : undefined,
              github_username: form.private_repo ? form.github_username : undefined,
              vault_strategy: form.vault_strategy,
              env_vars: form.env_vars,
              rotate_vault_secret: form.rotate_vault_secret,
            });
          }}
          disabled={!canSubmit}
          style={{
            padding: '10px', background: canSubmit ? 'var(--accent)' : 'var(--bg-hover)',
            border: 'none', borderRadius: '7px', color: '#fff',
            fontSize: '14px', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            boxShadow: canSubmit ? '0 0 20px var(--accent-glow)' : 'none', fontFamily: 'inherit',
          }}
        >
          <Search size={16} /> Analyze Repository →
        </button>
      </div>
    </div>
  );
}

// ─── Analysis phase ───────────────────────────────────────────────────────────

function AnalysisCard({ analysis, onConfirm, onBack }: { analysis: RepoAnalysis | null; onConfirm: () => void; onBack: () => void }) {
  const [clarifications, setClarifications] = useState({ tag: 'sha', resources: 'standard', replicas: '2' });

  if (!analysis) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <Loader2 size={32} color="var(--accent)" style={{ animation: 'spin 1.2s linear infinite' }} />
      <p style={{ color: 'var(--text-secondary)' }}>Scanning repository...</p>
    </div>
  );

  if (!analysis.success) {
    return (
      <div style={{ maxWidth: '600px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid var(--warning)', borderRadius: '8px', marginBottom: '16px' }}>
          <AlertCircle size={16} color="var(--warning)" />
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--warning)' }}>Could not access repository</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{analysis.error}</p>
          </div>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Pipeline will use defaults. You can still generate all manifests.</p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onBack} style={{ padding: '8px 18px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
          <button onClick={onConfirm} style={{ padding: '8px 18px', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Continue with defaults</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '600px', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <CheckCircle2 size={18} color="var(--success)" />
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Repository Analysis</h3>
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' }}>
        <Row label="Language" value={analysis.language} />
        <Row label="Dockerfile" value={analysis.has_dockerfile ? 'Found' : 'Not found'} ok={analysis.has_dockerfile} />
        <Row label="Exposed Port" value={analysis.port ? String(analysis.port) : 'Not detected (using 8080)'} ok={analysis.port !== null} />
        <Row label="K8s Manifests" value={analysis.has_manifests ? 'Found (will add overlays)' : 'None — will generate'} />
        <Row label="CI/CD" value={analysis.has_cicd ? 'Found (will add to pipeline)' : 'None — will generate'} />
        {analysis.secrets.length > 0 && (
          <Row label="Detected Secrets" value={analysis.secrets.join(', ')} />
        )}
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' }}>
        <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick Settings</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            { label: 'Image tag strategy', key: 'tag', options: [{ v: 'sha', l: 'Git SHA' }, { v: 'semver', l: 'Semver' }, { v: 'latest', l: 'latest' }] },
            { label: 'Resource sizing', key: 'resources', options: [{ v: 'minimal', l: 'Minimal' }, { v: 'standard', l: 'Standard' }, { v: 'high', l: 'High' }] },
            { label: 'Prod replicas', key: 'replicas', options: [{ v: '1', l: '1' }, { v: '2', l: '2' }, { v: '3', l: '3' }] },
          ].map(({ label, key, options }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {options.map((o) => (
                  <button key={o.v} onClick={() => setClarifications((c) => ({ ...c, [key]: o.v }))} style={{ padding: '3px 8px', background: (clarifications as Record<string, string>)[key] === o.v ? 'var(--accent-glow)' : 'transparent', border: `1px solid ${(clarifications as Record<string, string>)[key] === o.v ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '4px', color: (clarifications as Record<string, string>)[key] === o.v ? 'var(--accent)' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={onBack} style={{ padding: '9px 20px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
        <button onClick={onConfirm} style={{ flex: 1, padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 16px var(--accent-glow)' }}>
          Generate Pipeline →
        </button>
      </div>
    </div>
  );
}

// ─── Main PipelineMode ────────────────────────────────────────────────────────

export function PipelineMode() {
  const [searchParams] = useSearchParams();
  const initialRepoUrl = searchParams.get('repo') ?? '';
  const initialPrivate = searchParams.get('private') === 'true';

  const [phase, setPhase] = useState<Phase>('intake');
  const [pipelineCfg, setPipelineCfg] = useState<PipelineConfig | null>(null);
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [runMode, setRunMode] = useState<'auto' | 'step'>('auto');
  const [analyzing, setAnalyzing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { tasks, isRunning, isDone, runAll, reset, abort, runId } = useAgent();

  const handleAnalyze = useCallback(async (cfg: Omit<PipelineConfig, 'analysis' | 'clarifications'>) => {
    setPhase('analyzing');
    setAnalyzing(true);
    try {
      const res = await fetch('/api/github/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: cfg.repo_url, pat: cfg.github_pat, username: cfg.github_username }),
      });
      const data = await res.json() as RepoAnalysis;
      setAnalysis(data);
      setPipelineCfg({ ...cfg, analysis: data });
    } catch {
      setAnalysis({ success: false, language: 'Unknown', has_dockerfile: false, port: 8080, has_manifests: false, has_cicd: false, secrets: [], error: 'Network error' });
      setPipelineCfg({ ...cfg });
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleRunAll = useCallback(() => {
    if (!pipelineCfg) return;
    setShowConfirm(true);
  }, [pipelineCfg]);

  const confirmRun = useCallback(() => {
    setShowConfirm(false);
    if (!pipelineCfg) return;
    setPhase('running');
    runAll({
      ...pipelineCfg,
      analysis: analysis ?? undefined,
    });
  }, [pipelineCfg, analysis, runAll]);

  const handleReset = () => {
    reset();
    setPhase('intake');
    setPipelineCfg(null);
    setAnalysis(null);
  };

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header bar when pipeline is active */}
      {(phase === 'running' || phase === 'done') && (
        <div
          style={{
            padding: '10px 20px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: '12px',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
              Deploying: {pipelineCfg?.app_name} → {pipelineCfg?.cluster || 'cluster'}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {doneCount}/{tasks.length} steps complete{failedCount > 0 ? ` · ${failedCount} failed` : ''}
              {isDone ? ' · Pipeline complete ✓' : isRunning ? ' · Running...' : ''}
            </p>
          </div>

          {/* Run mode toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-base)', borderRadius: '5px', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {(['auto', 'step'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setRunMode(m)}
                style={{
                  padding: '4px 10px', background: runMode === m ? 'var(--accent)' : 'transparent',
                  border: 'none', color: runMode === m ? '#fff' : 'var(--text-muted)',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}
              >
                {m === 'auto' ? <><Play size={10} /> Run All</> : <><Pause size={10} /> Step by Step</>}
              </button>
            ))}
          </div>

          {isRunning && runId && (
            <button
              type="button"
              onClick={() => abort()}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--error)', borderRadius: '5px', color: 'var(--error)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <X size={12} /> Abort
            </button>
          )}
          <button
            onClick={handleReset}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <RotateCcw size={12} /> New
          </button>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 20px', display: 'flex', justifyContent: phase === 'running' || phase === 'done' ? 'flex-start' : 'center' }}>
        {phase === 'intake' && <IntakeForm onAnalyze={handleAnalyze} initialRepoUrl={initialRepoUrl} initialPrivate={initialPrivate} />}

        {phase === 'analyzing' && (
          <AnalysisCard analysis={analyzing ? null : analysis} onConfirm={() => setPhase('ready')} onBack={() => setPhase('intake')} />
        )}

        {phase === 'ready' && analysis && (
          <AnalysisCard
            analysis={analysis}
            onConfirm={handleRunAll}
            onBack={() => setPhase('intake')}
          />
        )}

        {(phase === 'running' || phase === 'done') && (
          <div style={{ width: '100%', maxWidth: '760px' }}>
            <TaskList tasks={tasks} mode={runMode} />
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }} onClick={() => setShowConfirm(false)} />
          <div
            style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: '12px', padding: '28px', width: '420px', zIndex: 201,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <p style={{ fontWeight: 700, fontSize: '16px', marginBottom: '10px' }}>
              {pipelineCfg?.cluster?.includes('prod') ? '⚠ Deploying to Production' : '🚀 Start Pipeline'}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '20px' }}>
              This will push to <strong>{pipelineCfg?.gitops_repo || pipelineCfg?.repo_url}</strong> and deploy <strong>{pipelineCfg?.app_name}</strong> to <strong>{pipelineCfg?.cluster}</strong>.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={confirmRun} style={{ flex: 1, padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 16px var(--accent-glow)' }}>
                Confirm & Run
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
