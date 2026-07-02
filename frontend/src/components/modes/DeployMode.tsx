import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GitBranch, Search, CheckCircle2, XCircle, AlertCircle,
  ChevronRight, Loader2, FileCode2, Rocket, Copy, Check,
  Server, Container, Shield, Database, Globe, Lock,
  Zap, Cloud, Package, Settings2, ExternalLink, RefreshCw,
} from 'lucide-react';
import { useStream } from '../../hooks/useStream';
import { toast } from '../../store/toastStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Repo {
  id: number; full_name: string; name: string; description: string;
  private: boolean; language: string; default_branch: string; updated_at: string;
}

interface ScanResult {
  language: string; framework: string; build_tool: string; port: number;
  app_name: string; default_branch: string; private: boolean;
  has_dockerfile: boolean; has_compose: boolean;
  has_jenkinsfile: boolean; has_github_actions: boolean; has_gitlab_ci: boolean;
}

interface Choices {
  cdTool: string | null;       // argocd | fluxcd | jenkins
  configTool: string | null;   // helm | kustomize
  vault: string | null;        // none | hashicorp | infisical | aws-sm
  vaultDeployed: boolean;
  registry: string | null;     // ghcr | docker-hub | ecr
}

interface GeneratedFile { path: string; content: string }

type Step = 'repo' | 'scan' | 'containers' | 'pipeline' | 'config' | 'vault' | 'generate';

const STEPS: { id: Step; label: string }[] = [
  { id: 'repo',       label: 'Repository' },
  { id: 'scan',       label: 'Scan' },
  { id: 'containers', label: 'Docker Files' },
  { id: 'pipeline',   label: 'CD Pipeline' },
  { id: 'config',     label: 'Config' },
  { id: 'vault',      label: 'Vault' },
  { id: 'generate',   label: 'Generate' },
];

// ── Options ───────────────────────────────────────────────────────────────────

const CD_OPTIONS = [
  {
    id: 'argocd',
    label: 'ArgoCD',
    sub: 'GitOps CD for Kubernetes. Declarative, Git-driven deployments. Recommended for K8s.',
    icon: <Rocket size={22} />,
    badge: 'GitOps',
  },
  {
    id: 'fluxcd',
    label: 'FluxCD',
    sub: 'CNCF GitOps tool. Lightweight alternative to ArgoCD with Helm + Kustomize support.',
    icon: <Zap size={22} />,
    badge: 'GitOps',
  },
  {
    id: 'jenkins',
    label: 'Jenkins',
    sub: 'Self-hosted CI/CD. Declarative Jenkinsfile handles build, test, push, and deploy.',
    icon: <Server size={22} />,
  },
];

const CONFIG_OPTIONS = [
  {
    id: 'helm',
    label: 'Helm',
    sub: 'Package manager for Kubernetes. Templated charts with values.yaml overrides. Best for complex apps.',
    icon: <Package size={22} />,
    badge: 'Recommended',
  },
  {
    id: 'kustomize',
    label: 'Kustomize',
    sub: 'Native K8s config customisation. Patch-based overlays for dev/staging/prod. Zero templating.',
    icon: <Settings2 size={22} />,
  },
];

const VAULT_OPTIONS = [
  {
    id: 'none',
    label: 'Native K8s Secrets',
    sub: 'Standard Kubernetes Secrets. Zero extra setup. Good for simple apps.',
    icon: <Lock size={22} />,
    badge: 'Simplest',
  },
  {
    id: 'hashicorp',
    label: 'HashiCorp Vault',
    sub: 'Self-hosted secrets engine. Full audit trail, dynamic secrets, rotation.',
    icon: <Shield size={22} />,
  },
  {
    id: 'infisical',
    label: 'Infisical',
    sub: 'Open-source secrets manager. Easy self-host or cloud. K8s operator available.',
    icon: <Database size={22} />,
  },
  {
    id: 'aws-sm',
    label: 'AWS Secrets Manager',
    sub: 'AWS-managed secrets. Best if you\'re already on AWS. External Secrets Operator.',
    icon: <Cloud size={22} />,
  },
];

const REGISTRY_OPTIONS = [
  {
    id: 'ghcr',
    label: 'GHCR',
    sub: 'GitHub Container Registry — free, built-in. No extra secret needed for GitHub Actions.',
    icon: <Globe size={22} />,
    badge: 'Free',
  },
  {
    id: 'docker-hub',
    label: 'Docker Hub',
    sub: 'Default public registry. Widely supported. Free tier available.',
    icon: <Container size={22} />,
  },
  {
    id: 'ecr',
    label: 'AWS ECR',
    sub: 'Amazon Elastic Container Registry. Best for AWS + EKS deployments.',
    icon: <Cloud size={22} />,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePipelineFiles(raw: string): GeneratedFile[] {
  const map = new Map<string, string>();
  const parts = raw.split(/---\s*FILE:\s*(.+?)\s*---/);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const path = parts[i].trim();
    const content = parts[i + 1].trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '');
    map.set(path, content);
  }
  return Array.from(map.entries()).map(([path, content]) => ({ path, content }));
}

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex(s => s.id === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-hover)',
                border: `2px solid ${done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)'}`,
                fontSize: 10, fontWeight: 700, color: done || active ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s',
              }}>
                {done ? <Check size={12} /> : i + 1}
              </div>
              <span style={{ fontSize: 9, color: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--text-muted)', fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? 'var(--success)' : 'var(--border)', margin: '0 3px', marginBottom: 17, transition: 'background 0.2s' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OptionCard({
  label, sub, icon, badge, selected, onClick,
}: {
  label: string; sub: string; icon: React.ReactNode;
  badge?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
        background: selected ? 'rgba(99,102,241,0.08)' : 'var(--bg-hover)',
        border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
        transition: 'all 0.15s', fontFamily: 'inherit',
      }}
    >
      <div style={{
        width: 42, height: 42, borderRadius: 9, flexShrink: 0,
        background: selected ? 'rgba(99,102,241,0.15)' : 'var(--bg-surface)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: selected ? 'var(--accent)' : 'var(--text-secondary)',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {label}
          </span>
          {badge && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {badge}
            </span>
          )}
          {selected && <CheckCircle2 size={14} style={{ color: 'var(--accent)', marginLeft: 'auto', flexShrink: 0 }} />}
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{sub}</p>
      </div>
    </button>
  );
}

function ScanBadge({ ok, label, generated }: { ok: boolean; label: string; generated?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--bg-hover)', borderRadius: 8, border: `1px solid ${ok || generated ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
      {ok || generated
        ? <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
        : <XCircle size={13} style={{ color: 'var(--error)', flexShrink: 0 }} />}
      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
      {generated && !ok && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 'auto' }}>will be generated</span>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DeployMode() {
  const [step, setStep] = useState<Step>('repo');

  // Repo
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);

  // Scan
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Containers (step 3)
  const [dockerfileContent, setDockerfileContent] = useState('');
  const [composeContent, setComposeContent] = useState('');
  const [containersFetching, setContainersFetching] = useState(false);
  const [activeContainerFile, setActiveContainerFile] = useState<'dockerfile' | 'compose'>('dockerfile');
  const [containersCommitting, setContainersCommitting] = useState(false);
  const [containersCommitted, setContainersCommitted] = useState(false);

  // Choices
  const [choices, setChoices] = useState<Choices>({
    cdTool: null, configTool: null, vault: null, vaultDeployed: false, registry: null,
  });

  // Generate (step 7)
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const rawRef = useRef('');

  // ── Load repos ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/github/repos', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setRepos(d.repos ?? []))
      .catch(() => {})
      .finally(() => setReposLoading(false));
  }, []);

  // ── Streaming ──────────────────────────────────────────────────────────────

  const onChunk = useCallback((chunk: string) => {
    rawRef.current += chunk;
    const files = parsePipelineFiles(rawRef.current);
    if (files.length > 0) {
      setGeneratedFiles(files);
      if (!activeFile) setActiveFile(files[0].path);
    }
  }, [activeFile]);

  const onDone = useCallback(() => {
    setIsGenerating(false);
    const files = parsePipelineFiles(rawRef.current);
    if (files.length > 0) { setGeneratedFiles(files); setActiveFile(files[0].path); }
    toast.success('Pipeline generated!', 'Review files and commit to your repo.');
  }, []);

  const onError = useCallback((err: string) => {
    setIsGenerating(false);
    setGenerateError(err);
  }, []);

  const { start } = useStream('/api/deploy/pipeline', { onChunk, onDone, onError });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    if (!selectedRepo) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/deploy/scan?full_name=${encodeURIComponent(selectedRepo.full_name)}`, { credentials: 'include' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Scan failed');
      setScanResult(data);
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanning(false);
    }
  }, [selectedRepo]);

  const fetchContainerFiles = useCallback(async () => {
    if (!scanResult) return;
    setContainersFetching(true);
    try {
      const [dfRes, composeRes] = await Promise.all([
        fetch('/api/deploy/dockerfile', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: scanResult.language, framework: scanResult.framework, port: scanResult.port }),
        }),
        fetch('/api/deploy/compose', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: scanResult.language, framework: scanResult.framework, port: scanResult.port, app_name: scanResult.app_name }),
        }),
      ]);
      const dfData = await dfRes.json();
      const composeData = await composeRes.json();
      setDockerfileContent(dfData.content ?? '');
      setComposeContent(composeData.content ?? '');
    } catch (e) {
      toast.error('Failed to generate container files', String(e));
    } finally {
      setContainersFetching(false);
    }
  }, [scanResult]);

  const handleCommitContainers = useCallback(async () => {
    if (!selectedRepo || !scanResult) return;
    setContainersCommitting(true);
    try {
      const files = [
        { path: 'Dockerfile', content: dockerfileContent },
        { path: 'docker-compose.yml', content: composeContent },
      ].filter(f => f.content);
      const r = await fetch('/api/deploy/commit', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_full_name: selectedRepo.full_name,
          branch: scanResult.default_branch,
          files,
          message: 'ci: add Dockerfile and docker-compose.yml via InfraPilot',
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Commit failed');
      setContainersCommitted(true);
      toast.success('Docker files committed!', `Pushed to ${selectedRepo.full_name}`);
    } catch (e) {
      toast.error('Commit failed', String(e));
    } finally {
      setContainersCommitting(false);
    }
  }, [selectedRepo, scanResult, dockerfileContent, composeContent]);

  const handleGenerate = useCallback(async () => {
    if (!selectedRepo || !scanResult || !choices.cdTool || !choices.configTool) return;
    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedFiles([]);
    setActiveFile(null);
    rawRef.current = '';
    await start({
      repo_full_name: selectedRepo.full_name,
      branch: scanResult.default_branch,
      language: scanResult.language,
      framework: scanResult.framework,
      cd_tool: choices.cdTool,
      config_tool: choices.configTool,
      vault: choices.vault ?? 'none',
      vault_deployed: choices.vaultDeployed,
      registry: choices.registry ?? 'ghcr',
      port: scanResult.port,
      app_name: scanResult.app_name,
    });
  }, [selectedRepo, scanResult, choices, start]);

  const handleCommitPipeline = useCallback(async () => {
    if (!selectedRepo || !scanResult || generatedFiles.length === 0) return;
    setCommitting(true);
    try {
      const pipelineFiles = generatedFiles.filter(f => f.path !== 'setup-guide.md');
      const r = await fetch('/api/deploy/commit', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_full_name: selectedRepo.full_name,
          branch: scanResult.default_branch,
          files: pipelineFiles,
          message: `ci: add ${choices.cdTool} + ${choices.configTool} pipeline via InfraPilot`,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Commit failed');
      toast.success('Pipeline committed!', `Pushed ${pipelineFiles.length} file(s) to ${selectedRepo.full_name}`);
    } catch (e) {
      toast.error('Commit failed', String(e));
    } finally {
      setCommitting(false);
    }
  }, [selectedRepo, scanResult, choices, generatedFiles]);

  const handleCopy = (path: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedFile(path);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  // ── Step navigation ────────────────────────────────────────────────────────

  const goNext = () => {
    if (step === 'repo') { setStep('scan'); handleScan(); }
    else if (step === 'scan') { setStep('containers'); fetchContainerFiles(); }
    else if (step === 'containers') setStep('pipeline');
    else if (step === 'pipeline') setStep('config');
    else if (step === 'config') setStep('vault');
    else if (step === 'vault') { setStep('generate'); handleGenerate(); }
  };

  const goBack = () => {
    if (step === 'scan') setStep('repo');
    else if (step === 'containers') setStep('scan');
    else if (step === 'pipeline') setStep('containers');
    else if (step === 'config') setStep('pipeline');
    else if (step === 'vault') setStep('config');
    else if (step === 'generate') setStep('vault');
  };

  const canGoNext = () => {
    if (step === 'repo') return !!selectedRepo;
    if (step === 'scan') return !!scanResult && !scanning;
    if (step === 'containers') return !containersFetching;
    if (step === 'pipeline') return !!choices.cdTool;
    if (step === 'config') return !!choices.configTool;
    if (step === 'vault') return !!choices.vault && !!choices.registry;
    return false;
  };

  const filteredRepos = repos.filter(r =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    r.description?.toLowerCase().includes(repoSearch.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '14px 24px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Deploy Wizard</h2>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
              Dockerfile + Compose → CD Pipeline (ArgoCD / FluxCD / Jenkins) → Helm / Kustomize → Vault
            </p>
          </div>
          {selectedRepo && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <GitBranch size={12} />
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{selectedRepo.name}</span>
              {scanResult && <><span>·</span><span>{scanResult.language}</span></>}
              {choices.cdTool && <><span>·</span><span>{choices.cdTool}</span></>}
              {choices.configTool && <><span>·</span><span>{choices.configTool}</span></>}
            </div>
          )}
        </div>
        <StepBar current={step} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

          {/* ── Step 1: Repo ───────────────────────────────────────────── */}
          {step === 'repo' && (
            <div style={{ maxWidth: 720 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Select a Repository</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
                We'll scan it to detect language, framework, and existing DevOps files.
              </p>

              <div style={{ position: 'relative', marginBottom: 14 }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  value={repoSearch}
                  onChange={e => setRepoSearch(e.target.value)}
                  placeholder="Search repositories…"
                  style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 13, padding: '8px 12px 8px 32px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {reposLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>
                  <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Loading repositories…
                </div>
              )}

              {!reposLoading && repos.length === 0 && (
                <div style={{ padding: '24px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
                  <GitBranch size={28} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 10 }} />
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>No GitHub repositories found.</p>
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Go to <strong>Settings → GitHub</strong> and add a Personal Access Token first.</p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredRepos.map(repo => {
                  const sel = selectedRepo?.id === repo.id;
                  return (
                    <button
                      key={repo.id} type="button" onClick={() => setSelectedRepo(repo)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                        background: sel ? 'rgba(99,102,241,0.08)' : 'var(--bg-surface)',
                        border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 9, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.1s',
                      }}
                    >
                      <GitBranch size={15} style={{ color: sel ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.full_name}</span>
                          {repo.private && <Lock size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                          {repo.language && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)', flexShrink: 0 }}>{repo.language}</span>}
                        </div>
                        {repo.description && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.description}</p>}
                      </div>
                      <div style={{ flexShrink: 0, fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(repo.updated_at)}</div>
                      {sel && <CheckCircle2 size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Scan ───────────────────────────────────────────── */}
          {step === 'scan' && (
            <div style={{ maxWidth: 600 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Scanning {selectedRepo?.full_name}</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>Detecting language, framework, and existing DevOps files.</p>

              {scanning && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {['Fetching repository tree…', 'Detecting language and framework…', 'Checking for Dockerfile, CI configs…'].map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <Loader2 size={13} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t}</span>
                    </div>
                  ))}
                </div>
              )}

              {scanError && (
                <div style={{ padding: '14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 9, display: 'flex', gap: 10 }}>
                  <AlertCircle size={15} style={{ color: 'var(--error)', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--error)' }}>Scan failed</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{scanError}</p>
                  </div>
                  <button type="button" onClick={() => { setScanError(null); handleScan(); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <RefreshCw size={11} /> Retry
                  </button>
                </div>
              )}

              {scanResult && !scanning && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Settings2 size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Detected Stack</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { label: scanResult.language, col: 'var(--accent)' },
                        scanResult.framework && { label: scanResult.framework, col: 'var(--warning)' },
                        { label: `Port ${scanResult.port}`, col: 'var(--text-muted)' },
                        { label: `Branch: ${scanResult.default_branch}`, col: 'var(--text-muted)' },
                      ].filter(Boolean).map((item: any, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, background: `${item.col}18`, color: item.col, border: `1px solid ${item.col}30` }}>{item.label}</span>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <FileCode2 size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>DevOps Files</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <ScanBadge ok={scanResult.has_dockerfile} generated label="Dockerfile" />
                      <ScanBadge ok={scanResult.has_compose} generated label="docker-compose.yml" />
                      <ScanBadge ok={scanResult.has_github_actions} label=".github/workflows/" />
                      <ScanBadge ok={scanResult.has_jenkinsfile} label="Jenkinsfile" />
                      <ScanBadge ok={scanResult.has_gitlab_ci} label=".gitlab-ci.yml" />
                    </div>
                  </div>

                  <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 9, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Zap size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      Next: we'll generate a <strong>Dockerfile</strong> and <strong>docker-compose.yml</strong> for you to review and commit.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Containers ─────────────────────────────────────── */}
          {step === 'containers' && (
            <div style={{ maxWidth: 780 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Docker Files</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                Generated <strong>Dockerfile</strong> and <strong>docker-compose.yml</strong> for <strong>{scanResult?.language} / {scanResult?.framework || scanResult?.language}</strong>. Review, edit if needed, then commit to your repo.
              </p>

              {containersFetching && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13, padding: '30px 0' }}>
                  <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating container files…
                </div>
              )}

              {!containersFetching && (dockerfileContent || composeContent) && (
                <>
                  {/* Tab toggle */}
                  <div style={{ display: 'flex', gap: 0, marginBottom: 12, background: 'var(--bg-hover)', borderRadius: 8, padding: 3, width: 'fit-content' }}>
                    {(['dockerfile', 'compose'] as const).map(tab => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveContainerFile(tab)}
                        style={{
                          padding: '6px 16px', fontSize: 12, fontWeight: activeContainerFile === tab ? 700 : 400,
                          background: activeContainerFile === tab ? 'var(--bg-surface)' : 'transparent',
                          border: 'none', borderRadius: 6,
                          color: activeContainerFile === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                        }}
                      >
                        {tab === 'dockerfile' ? 'Dockerfile' : 'docker-compose.yml'}
                      </button>
                    ))}
                  </div>

                  <div style={{ position: 'relative', marginBottom: 14 }}>
                    <textarea
                      value={activeContainerFile === 'dockerfile' ? dockerfileContent : composeContent}
                      onChange={e => {
                        if (activeContainerFile === 'dockerfile') setDockerfileContent(e.target.value);
                        else setComposeContent(e.target.value);
                      }}
                      style={{
                        width: '100%', minHeight: 340, background: 'var(--bg-surface)',
                        border: '1px solid var(--border)', borderRadius: 8,
                        color: 'var(--text-primary)', fontSize: 12.5,
                        padding: '14px 16px', resize: 'vertical', outline: 'none',
                        fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleCommitContainers}
                      disabled={containersCommitting || containersCommitted}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px',
                        background: containersCommitted ? 'var(--success)' : 'var(--accent)',
                        border: 'none', borderRadius: 7, color: '#fff',
                        fontSize: 12, fontWeight: 600, cursor: containersCommitting || containersCommitted ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', opacity: containersCommitting ? 0.7 : 1,
                      }}
                    >
                      {containersCommitting ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : containersCommitted ? <CheckCircle2 size={13} /> : <GitBranch size={13} />}
                      {containersCommitting ? 'Committing…' : containersCommitted ? 'Committed!' : 'Commit Both Files to Repo'}
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      or continue without committing
                    </span>
                  </div>

                  {containersCommitted && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Dockerfile and docker-compose.yml committed to <strong>{selectedRepo?.full_name}</strong>.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step 4: CD Pipeline ────────────────────────────────────── */}
          {step === 'pipeline' && (
            <div style={{ maxWidth: 620 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Choose CD Pipeline</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
                Select your continuous delivery tool. ArgoCD and FluxCD use GitOps (pull-based). Jenkins handles the full CI+CD pipeline in one Jenkinsfile.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {CD_OPTIONS.map(opt => (
                  <OptionCard key={opt.id} {...opt} selected={choices.cdTool === opt.id} onClick={() => setChoices(c => ({ ...c, cdTool: opt.id }))} />
                ))}
              </div>
            </div>
          )}

          {/* ── Step 5: Config ─────────────────────────────────────────── */}
          {step === 'config' && (
            <div style={{ maxWidth: 620 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Kubernetes Config</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
                How should Kubernetes manifests be managed? Helm uses templates and a values file. Kustomize uses patch-based overlays on top of plain YAML.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {CONFIG_OPTIONS.map(opt => (
                  <OptionCard key={opt.id} {...opt} selected={choices.configTool === opt.id} onClick={() => setChoices(c => ({ ...c, configTool: opt.id }))} />
                ))}
              </div>
            </div>
          )}

          {/* ── Step 6: Vault ──────────────────────────────────────────── */}
          {step === 'vault' && (
            <div style={{ maxWidth: 640 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Secrets & Vault</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
                Choose how your app will access secrets in Kubernetes. We'll generate the appropriate integration code.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {VAULT_OPTIONS.map(opt => (
                  <OptionCard key={opt.id} {...opt} selected={choices.vault === opt.id} onClick={() => setChoices(c => ({ ...c, vault: opt.id }))} />
                ))}
              </div>

              {choices.vault && choices.vault !== 'none' && (
                <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 24 }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Is {choices.vault === 'hashicorp' ? 'HashiCorp Vault' : choices.vault === 'infisical' ? 'Infisical' : 'AWS Secrets Manager'} already deployed?
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[{ val: true, label: 'Yes, already running' }, { val: false, label: 'No, generate setup steps too' }].map(({ val, label }) => (
                      <button
                        key={String(val)}
                        type="button"
                        onClick={() => setChoices(c => ({ ...c, vaultDeployed: val }))}
                        style={{
                          flex: 1, padding: '10px', fontSize: 12, fontWeight: choices.vaultDeployed === val ? 700 : 400,
                          background: choices.vaultDeployed === val ? 'rgba(99,102,241,0.1)' : 'var(--bg-hover)',
                          border: `1.5px solid ${choices.vaultDeployed === val ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 8, cursor: 'pointer', color: choices.vaultDeployed === val ? 'var(--accent)' : 'var(--text-secondary)',
                          fontFamily: 'inherit', transition: 'all 0.15s',
                        }}
                      >
                        {choices.vaultDeployed === val && <CheckCircle2 size={12} style={{ marginRight: 5 }} />}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Container Registry</p>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>Where should built Docker images be pushed?</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {REGISTRY_OPTIONS.map(opt => (
                    <OptionCard key={opt.id} {...opt} selected={choices.registry === opt.id} onClick={() => setChoices(c => ({ ...c, registry: opt.id }))} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 7: Generate ───────────────────────────────────────── */}
          {step === 'generate' && (
            <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>
              {/* File list */}
              <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Generated Files</p>

                {isGenerating && generatedFiles.length === 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[100, 80, 90, 70, 85].map((w, i) => (
                      <div key={i} className="skeleton" style={{ height: 32, width: `${w}%`, borderRadius: 6 }} />
                    ))}
                  </div>
                )}

                {generatedFiles.map(f => (
                  <button
                    key={f.path} type="button" onClick={() => setActiveFile(f.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px',
                      background: activeFile === f.path ? 'var(--bg-hover)' : 'transparent',
                      border: `1px solid ${activeFile === f.path ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                      color: activeFile === f.path ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <FileCode2 size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />
                    <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.path.split('/').pop()}</span>
                  </button>
                ))}

                {generatedFiles.length > 0 && !isGenerating && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button
                      type="button" onClick={handleCommitPipeline} disabled={committing}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 11, fontWeight: 600, cursor: committing ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                    >
                      {committing ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <GitBranch size={11} />}
                      {committing ? 'Committing…' : 'Commit to Repo'}
                    </button>
                    <a
                      href={`https://github.com/${selectedRepo?.full_name}`}
                      target="_blank" rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', textDecoration: 'none', justifyContent: 'center' }}
                    >
                      <ExternalLink size={11} /> Open on GitHub
                    </a>
                  </div>
                )}
              </div>

              {/* File content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {activeFile && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', flex: 1 }}>{activeFile}</span>
                    <button
                      type="button"
                      onClick={() => { const f = generatedFiles.find(x => x.path === activeFile); if (f) handleCopy(f.path, f.content); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                    >
                      {copiedFile === activeFile ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
                      {copiedFile === activeFile ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}

                {isGenerating && (
                  <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(99,102,241,0.06)', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                    <Zap size={11} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>Generating {choices.cdTool} + {choices.configTool} pipeline…</span>
                    <span style={{ animation: 'pulse 1.2s ease-in-out infinite', color: 'var(--accent)' }}>●</span>
                  </div>
                )}

                {generateError && (
                  <div style={{ padding: 16, color: 'var(--error)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={14} />{generateError}
                  </div>
                )}

                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
                  {activeFile && (
                    <pre style={{ margin: 0, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {generatedFiles.find(f => f.path === activeFile)?.content ?? ''}
                    </pre>
                  )}
                  {!activeFile && !isGenerating && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
                      Select a file to preview
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer navigation */}
      {step !== 'generate' && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            type="button" onClick={goBack} disabled={step === 'repo'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: step === 'repo' ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 13, cursor: step === 'repo' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: step === 'repo' ? 0.4 : 1 }}
          >
            ← Back
          </button>

          <button
            type="button" onClick={goNext} disabled={!canGoNext() || scanning || containersFetching}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 22px',
              background: canGoNext() && !scanning && !containersFetching ? 'var(--accent)' : 'var(--bg-hover)',
              border: 'none', borderRadius: 7,
              color: canGoNext() && !scanning && !containersFetching ? '#fff' : 'var(--text-muted)',
              fontSize: 13, fontWeight: 600,
              cursor: !canGoNext() || scanning || containersFetching ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              boxShadow: canGoNext() && !scanning && !containersFetching ? '0 0 12px var(--accent-glow)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {step === 'vault' ? (
              <><Zap size={13} /> Generate Pipeline</>
            ) : step === 'scan' && scanning ? (
              <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Scanning…</>
            ) : step === 'containers' && containersFetching ? (
              <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating…</>
            ) : (
              <>Next <ChevronRight size={13} /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
