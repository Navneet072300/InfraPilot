import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Plus, Trash2, Loader2 } from 'lucide-react';
import { useIsBuilder } from '../hooks/useTerminology';
import { HelpTip } from '../components/shared/HelpTip';

// ─── Step 1: Platform selections ─────────────────────────────────────────────

const PLATFORMS = {
  cloud: [
    { id: 'aws', label: 'AWS', icon: '☁️', desc: 'Amazon Web Services' },
    { id: 'azure', label: 'Azure', icon: '⚡', desc: 'Microsoft Azure' },
    { id: 'gcp', label: 'GCP', icon: '🌐', desc: 'Google Cloud Platform' },
    { id: 'bare-metal', label: 'Bare Metal', icon: '🖥️', desc: 'Physical servers' },
    { id: 'vmware', label: 'On-Prem VMware', icon: '📦', desc: 'VMware vSphere' },
  ],
  cicd: [
    { id: 'github-actions', label: 'GitHub Actions', icon: '⚙️', desc: 'Native GitHub CI/CD' },
    { id: 'gitlab-ci', label: 'GitLab CI', icon: '🦊', desc: 'GitLab pipelines' },
    { id: 'jenkins', label: 'Jenkins', icon: '🤖', desc: 'Self-hosted CI' },
    { id: 'tekton', label: 'Tekton', icon: '🔧', desc: 'Kubernetes-native CI' },
    { id: 'drone', label: 'Drone CI', icon: '🚁', desc: 'Container-native CI' },
  ],
  gitops: [
    { id: 'argocd', label: 'ArgoCD', icon: '🐙', desc: 'Kubernetes GitOps' },
    { id: 'flux', label: 'Flux', icon: '🌊', desc: 'GitOps toolkit' },
    { id: 'none', label: 'None (direct kubectl)', icon: '⚓', desc: 'Direct cluster apply' },
  ],
  secrets: [
    { id: 'vault', label: 'HashiCorp Vault', icon: '🔐', desc: 'Dynamic secrets' },
    { id: 'aws-sm', label: 'AWS Secrets Manager', icon: '🔑', desc: 'AWS native' },
    { id: 'azure-kv', label: 'Azure Key Vault', icon: '🗝️', desc: 'Azure native' },
    { id: 'gcp-sm', label: 'GCP Secret Manager', icon: '🔒', desc: 'GCP native' },
    { id: 'k8s', label: 'Kubernetes Secrets', icon: '☸️', desc: 'Native K8s secrets' },
  ],
  monitoring: [
    { id: 'grafana', label: 'Grafana + Prometheus', icon: '📊', desc: 'Open-source stack' },
    { id: 'elk', label: 'ELK Stack', icon: '🦌', desc: 'Elastic logging' },
    { id: 'datadog', label: 'Datadog', icon: '🐕', desc: 'SaaS monitoring' },
    { id: 'newrelic', label: 'New Relic', icon: '📡', desc: 'SaaS observability' },
    { id: 'none', label: 'None', icon: '—', desc: 'Skip for now' },
  ],
  registry: [
    { id: 'ghcr', label: 'GHCR', icon: '🐙', desc: 'GitHub Container Registry' },
    { id: 'dockerhub', label: 'Docker Hub', icon: '🐳', desc: 'Docker official' },
    { id: 'ecr', label: 'AWS ECR', icon: '☁️', desc: 'Amazon ECR' },
    { id: 'acr', label: 'Azure ACR', icon: '⚡', desc: 'Azure Container Registry' },
    { id: 'gcr', label: 'GCP GCR', icon: '🌐', desc: 'Google Container Registry' },
    { id: 'self-hosted', label: 'Self-hosted', icon: '🖥️', desc: 'Harbor, Nexus, etc.' },
  ],
  cdn: [
    { id: 'cloudflare', label: 'Cloudflare', icon: '🌩️', desc: 'CDN + DNS + DDoS' },
    { id: 'route53', label: 'AWS Route53', icon: '🛣️', desc: 'AWS DNS' },
    { id: 'azure-dns', label: 'Azure DNS', icon: '🌐', desc: 'Azure DNS zones' },
    { id: 'none', label: 'None', icon: '—', desc: 'Skip for now' },
  ],
};

type SelectionKey = keyof typeof PLATFORMS;

function SelectionGroup({
  title, items, selected, onToggle,
}: {
  title: string;
  items: { id: string; label: string; icon: string; desc: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map((item) => {
          const active = selected.includes(item.id);
          return (
            <button
              key={item.id}
              onClick={() => onToggle(item.id)}
              title={item.desc}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px',
                background: active ? 'rgba(99,102,241,0.12)' : 'var(--bg-surface)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '6px',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: '12px', fontWeight: active ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.1s',
                fontFamily: 'inherit',
              }}
            >
              <span>{item.icon}</span>
              {item.label}
              {active && <CheckCircle2 size={11} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 2: Cluster setup ───────────────────────────────────────────────────

interface ClusterForm {
  name: string;
  environment: 'dev' | 'staging' | 'prod';
  connection_type: 'token' | 'kubeconfig';
  api_url: string;
  token: string;
  kubeconfig: string;
  testStatus: 'idle' | 'testing' | 'ok' | 'error';
  testMessage: string;
}

function ClusterCard({
  cluster, index, onChange, onRemove,
}: {
  cluster: ClusterForm;
  index: number;
  onChange: (c: ClusterForm) => void;
  onRemove: () => void;
}) {
  const isBuilder = useIsBuilder();
  const testConnection = async () => {
    onChange({ ...cluster, testStatus: 'testing', testMessage: '' });
    try {
      const res = await fetch('/api/platform/test-cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cluster.name || 'test',
          environment: cluster.environment,
          connection_type: cluster.connection_type,
          api_url: cluster.api_url,
          token: cluster.token,
          kubeconfig: cluster.kubeconfig,
          active: false,
        }),
      });
      const data = await res.json() as { healthy: boolean; node_count?: number; version?: string; error?: string };
      if (data.healthy) {
        onChange({
          ...cluster, testStatus: 'ok',
          testMessage: `Connected — ${data.node_count ?? '?'} nodes, Kubernetes ${data.version ?? ''}`,
        });
      } else {
        onChange({ ...cluster, testStatus: 'error', testMessage: data.error || 'Connection failed' });
      }
    } catch (e) {
      onChange({ ...cluster, testStatus: 'error', testMessage: String(e) });
    }
  };

  const inputStyle = {
    width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: '5px', color: 'var(--text-primary)', fontSize: '13px',
    padding: '7px 10px', outline: 'none', fontFamily: 'inherit',
  };

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>Cluster {index + 1}</span>
        {index > 0 && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer' }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Cluster Name</label>
          <input value={cluster.name} onChange={(e) => onChange({ ...cluster, name: e.target.value })} placeholder="e.g. dev-aks" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Environment</label>
          <select value={cluster.environment} onChange={(e) => onChange({ ...cluster, environment: e.target.value as 'dev' | 'staging' | 'prod' })} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="dev">Development</option>
            <option value="staging">Staging</option>
            <option value="prod">Production</option>
          </select>
        </div>
      </div>

      {isBuilder && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          Kubeconfig: if you manage the server yourself (most common). Bearer Token: if you're on AWS, Azure, or GCP managed services.
        </p>
      )}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        {(['token', 'kubeconfig'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onChange({ ...cluster, connection_type: t })}
            style={{
              padding: '4px 10px', background: cluster.connection_type === t ? 'var(--accent-glow)' : 'transparent',
              border: `1px solid ${cluster.connection_type === t ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '4px', color: cluster.connection_type === t ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t === 'token' ? (isBuilder ? 'Server access key' : 'Bearer Token + API URL') : (isBuilder ? 'Server connection file' : 'Kubeconfig paste')}
          </button>
        ))}
      </div>

      {cluster.connection_type === 'token' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: '4px' }}>
              {isBuilder ? "Your server's address" : 'API Server URL'}
            </label>
            <input value={cluster.api_url} onChange={(e) => onChange({ ...cluster, api_url: e.target.value })} placeholder={isBuilder ? 'Looks like https://1.2.3.4 or https://cluster.yourcompany.com' : 'https://kubernetes.example.com:6443'} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: '4px' }}>
              {isBuilder ? 'Server access key' : 'Bearer Token'}
              <HelpTip tip="bearerToken" />
            </label>
            <input type="password" value={cluster.token} onChange={(e) => onChange({ ...cluster, token: e.target.value })} placeholder="eyJhbGci..." style={inputStyle} />
          </div>
        </div>
      ) : (
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: '4px' }}>
            {isBuilder ? 'Paste your server connection file' : 'Kubeconfig'}
            <HelpTip tip="kubeconfig" />
          </label>
          {isBuilder && <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 6 }}>Usually found at ~/.kube/config — run: <code>cat ~/.kube/config</code> to see it.</p>}
          <textarea rows={6} value={cluster.kubeconfig} onChange={(e) => onChange({ ...cluster, kubeconfig: e.target.value })} placeholder="Paste your kubeconfig YAML here..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
        <button
          onClick={testConnection}
          disabled={cluster.testStatus === 'testing'}
          style={{
            padding: '6px 14px', background: 'var(--bg-hover)', border: '1px solid var(--border)',
            borderRadius: '5px', color: 'var(--text-secondary)', fontSize: '12px',
            cursor: cluster.testStatus === 'testing' ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}
        >
          {cluster.testStatus === 'testing' ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Testing...</> : 'Test Connection'}
        </button>
        {cluster.testStatus === 'ok' && <span style={{ fontSize: '12px', color: 'var(--success)' }}>✓ {cluster.testMessage}</span>}
        {cluster.testStatus === 'error' && <span style={{ fontSize: '12px', color: 'var(--error)' }}>✗ {cluster.testMessage}</span>}
      </div>
    </div>
  );
}

// ─── Step 3: Platform credentials ────────────────────────────────────────────

function GitHubCredentials({ value, onChange }: { value: { username: string; pat: string; status: string; msg: string }; onChange: (v: typeof value) => void }) {
  const isBuilder = useIsBuilder();
  const test = async () => {
    onChange({ ...value, status: 'testing' });
    const res = await fetch('/api/platform/test-github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pat: value.pat, username: value.username }) });
    const d = await res.json() as { success: boolean; username?: string; error?: string };
    onChange({ ...value, status: d.success ? 'ok' : 'error', msg: d.success ? `Connected as ${d.username}` : d.error || 'auth failed' });
  };
  const inputStyle = { width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-primary)', fontSize: '13px', padding: '7px 10px', outline: 'none', fontFamily: 'inherit' };
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
      <p style={{ fontWeight: 600, fontSize: '13px', marginBottom: 4 }}>🐙 GitHub</p>
      {isBuilder && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
          InfraPilot needs permission to read your code and set up automatic deploys.
        </p>
      )}
      {!isBuilder && <div style={{ marginBottom: '12px' }} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Username</label>
          <input value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value })} placeholder="octocat" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: '4px' }}>
            {isBuilder ? 'Paste your token here' : 'Personal Access Token'}
            <HelpTip tip="pat" />
          </label>
          <input type="password" value={value.pat} onChange={(e) => onChange({ ...value, pat: e.target.value })} placeholder={isBuilder ? 'Starts with ghp_...' : 'ghp_...'} style={inputStyle} />
          {isBuilder && <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 3 }}>Starts with ghp_ — paste the whole thing</p>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={test} disabled={value.status === 'testing'} style={{ padding: '5px 12px', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          {value.status === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        {value.status === 'ok' && <span style={{ fontSize: '12px', color: 'var(--success)' }}>✓ {value.msg}</span>}
        {value.status === 'error' && <span style={{ fontSize: '12px', color: 'var(--error)' }}>✗ {value.msg}</span>}
      </div>
    </div>
  );
}

// ─── Main Onboarding component ────────────────────────────────────────────────

const EMPTY_CLUSTER: ClusterForm = {
  name: '', environment: 'dev', connection_type: 'token',
  api_url: '', token: '', kubeconfig: '',
  testStatus: 'idle', testMessage: '',
};

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1: selections
  const [selections, setSelections] = useState<Record<SelectionKey, string[]>>({
    cloud: ['aws'], cicd: ['github-actions'], gitops: ['argocd'],
    secrets: ['vault'], monitoring: ['grafana'], registry: ['ghcr'], cdn: ['cloudflare'],
  });

  const toggleSelection = (key: SelectionKey, id: string) => {
    setSelections((prev) => ({
      ...prev,
      [key]: prev[key].includes(id) ? prev[key].filter((x) => x !== id) : [...prev[key], id],
    }));
  };

  // Step 2: clusters
  const [clusters, setClusters] = useState<ClusterForm[]>([{ ...EMPTY_CLUSTER }]);

  // Step 3: platform creds
  const [github, setGithub] = useState({ username: '', pat: '', status: 'idle', msg: '' });

  const canProceed = () => {
    if (step === 2) return clusters.some((c) => c.name.trim());
    return true;
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await fetch('/api/platform/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusters: clusters
            .filter((c) => c.name.trim())
            .map((c, i) => ({
              name: c.name, environment: c.environment,
              connection_type: c.connection_type,
              api_url: c.api_url, token: c.token,
              kubeconfig: c.kubeconfig, active: i === 0,
            })),
          github: github.username ? { username: github.username, pat: github.pat } : undefined,
          selected_platforms: Object.values(selections).flat(),
        }),
      });
      navigate('/app');
    } finally {
      setSaving(false);
    }
  };

  const STEPS = ['Platforms', 'Clusters', 'Credentials', 'Ready'];

  return (
    <div
      style={{
        minHeight: '100vh', background: 'var(--bg-base)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '40px 20px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '36px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 800, color: '#fff' }}>IP</div>
        <span style={{ fontWeight: 800, fontSize: '18px', letterSpacing: '-0.02em' }}>InfraPilot Setup</span>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '32px' }}>
        {STEPS.map((label, i) => {
          const num = i + 1;
          const done = step > num;
          const active = step === num;
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <div
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-hover)',
                    border: `2px solid ${done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 700, color: done || active ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {done ? '✓' : num}
                </div>
                <span style={{ fontSize: '10px', color: active ? 'var(--accent)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: '60px', height: '1px', background: done ? 'var(--success)' : 'var(--border)', margin: '0 4px', marginBottom: '20px' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Card */}
      <div
        style={{
          width: '100%', maxWidth: '720px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '12px', overflow: 'hidden',
        }}
      >
        {/* Step content */}
        <div style={{ padding: '28px', maxHeight: '60vh', overflowY: 'auto' }}>
          {step === 1 && (
            <>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>What are you working with?</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>Select everything in your stack — InfraPilot will tailor its workflows accordingly.</p>
              {(Object.entries(PLATFORMS) as [SelectionKey, typeof PLATFORMS.cloud][]).map(([key, items]) => (
                <SelectionGroup key={key} title={key.toUpperCase()} items={items} selected={selections[key]} onToggle={(id) => toggleSelection(key, id)} />
              ))}
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Connect your clusters</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>Add at least one Kubernetes cluster. You can add more later in Settings.</p>
              {clusters.map((c, i) => (
                <ClusterCard key={i} cluster={c} index={i} onChange={(updated) => setClusters((prev) => prev.map((x, j) => j === i ? updated : x))} onRemove={() => setClusters((prev) => prev.filter((_, j) => j !== i))} />
              ))}
              <button
                onClick={() => setClusters((prev) => [...prev, { ...EMPTY_CLUSTER }])}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'transparent', border: '1px dashed var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <Plus size={13} /> Add another cluster
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Connect your platforms</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>Enter credentials for the tools you selected. Stubbed integrations are pre-configured.</p>
              {selections.cicd.includes('github-actions') && (
                <GitHubCredentials value={github} onChange={setGithub} />
              )}
              {selections.secrets.includes('vault') && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>🔐 HashiCorp Vault</span>
                    <span style={{ fontSize: '10px', color: 'var(--warning)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>STUBBED</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>Vault integration is stubbed for demo. Real Vault connection coming soon.</p>
                </div>
              )}
              {selections.cdn.includes('cloudflare') && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>🌩️ Cloudflare DNS</span>
                    <span style={{ fontSize: '10px', color: 'var(--warning)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>STUBBED</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>Cloudflare DNS configuration is stubbed for demo. Real integration coming soon.</p>
                </div>
              )}
              {!selections.cicd.includes('github-actions') && !selections.secrets.includes('vault') && !selections.cdn.includes('cloudflare') && (
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No platform credentials needed for your selections. Click Continue.</p>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>You're all set! 🎉</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                {clusters.filter((c) => c.name).map((c) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                    {c.testStatus === 'ok' ? <CheckCircle2 size={16} color="var(--success)" /> : <AlertCircle size={16} color="var(--warning)" />}
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{c.name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.environment}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: c.testStatus === 'ok' ? 'var(--success)' : 'var(--warning)' }}>
                      {c.testStatus === 'ok' ? 'Connected' : 'Not tested — will connect on first use'}
                    </span>
                  </div>
                ))}
                {github.pat && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                    {github.status === 'ok' ? <CheckCircle2 size={16} color="var(--success)" /> : <AlertCircle size={16} color="var(--warning)" />}
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>GitHub</span>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: github.status === 'ok' ? 'var(--success)' : 'var(--text-muted)' }}>
                      {github.status === 'ok' ? github.msg : 'Token saved — will validate on use'}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            style={{ padding: '8px 20px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: step === 1 ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: '13px', cursor: step === 1 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >
            Back
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
              style={{
                padding: '8px 24px', background: canProceed() ? 'var(--accent)' : 'var(--bg-hover)',
                border: 'none', borderRadius: '6px', color: '#fff',
                fontSize: '13px', fontWeight: 600, cursor: canProceed() ? 'pointer' : 'not-allowed',
                boxShadow: canProceed() ? '0 0 16px var(--accent-glow)' : 'none', fontFamily: 'inherit',
              }}
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saving}
              style={{
                padding: '8px 24px', background: 'var(--accent)', border: 'none',
                borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: '6px',
                boxShadow: '0 0 16px var(--accent-glow)',
              }}
            >
              {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : 'Launch InfraPilot →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
