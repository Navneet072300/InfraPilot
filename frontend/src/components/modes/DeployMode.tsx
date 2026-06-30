import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GitBranch, Search, CheckCircle2, XCircle, AlertCircle,
  ChevronRight, Loader2, FileCode2, Rocket, Copy, Check,
  Server, Container, Shield, Database, Globe,
  Zap, Lock, Cloud, Package, Settings2, Terminal, RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { useStream } from '../../hooks/useStream';
import { toast } from '../../store/toastStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Repo {
  id: number;
  full_name: string;
  name: string;
  description: string;
  private: boolean;
  language: string;
  default_branch: string;
  updated_at: string;
}

interface ScanResult {
  language: string;
  framework: string;
  build_tool: string;
  port: number;
  app_name: string;
  default_branch: string;
  private: boolean;
  has_dockerfile: boolean;
  has_compose: boolean;
  has_jenkinsfile: boolean;
  has_github_actions: boolean;
  has_gitlab_ci: boolean;
}

interface Choices {
  ciTool: string | null;
  registry: string | null;
  secrets: string | null;
  deployTarget: string | null;
}

interface GeneratedFile { path: string; content: string }

type Step = 'repo' | 'scan' | 'dockerfile' | 'ci' | 'registry' | 'secrets' | 'target' | 'generate';

const STEPS: { id: Step; label: string }[] = [
  { id: 'repo',       label: 'Repository' },
  { id: 'scan',       label: 'Scan' },
  { id: 'ci',         label: 'CI/CD Tool' },
  { id: 'registry',   label: 'Registry' },
  { id: 'secrets',    label: 'Secrets' },
  { id: 'target',     label: 'Deploy To' },
  { id: 'generate',   label: 'Generate' },
];

// ── Constants ─────────────────────────────────────────────────────────────────

const CI_OPTIONS = [
  {
    id: 'github-actions',
    label: 'GitHub Actions',
    sub: 'Cloud-native, no server needed. Best for GitHub repos.',
    icon: <Globe size={22} />,
    badge: 'Recommended',
  },
  {
    id: 'jenkins',
    label: 'Jenkins',
    sub: 'Self-hosted CI. Declarative Jenkinsfile in repo root.',
    icon: <Server size={22} />,
  },
  {
    id: 'gitlab-ci',
    label: 'GitLab CI',
    sub: 'GitLab native pipelines with .gitlab-ci.yml.',
    icon: <GitBranch size={22} />,
  },
];

const REGISTRY_OPTIONS = [
  {
    id: 'ghcr',
    label: 'GHCR',
    sub: 'GitHub Container Registry — free, built-in with GitHub.',
    icon: <Package size={22} />,
    badge: 'Free',
  },
  {
    id: 'docker-hub',
    label: 'Docker Hub',
    sub: 'The default public registry. Free tier available.',
    icon: <Container size={22} />,
  },
  {
    id: 'ecr',
    label: 'AWS ECR',
    sub: 'Amazon Elastic Container Registry. Best for AWS deployments.',
    icon: <Cloud size={22} />,
  },
  {
    id: 'none',
    label: 'Build Only',
    sub: 'Build image locally, no registry push.',
    icon: <FileCode2 size={22} />,
  },
];

const SECRETS_OPTIONS = [
  {
    id: 'native',
    label: 'Native Secrets',
    sub: 'GitHub Secrets / Jenkins Credentials / GitLab Variables. Zero extra setup.',
    icon: <Lock size={22} />,
    badge: 'Recommended',
  },
  {
    id: 'vault',
    label: 'HashiCorp Vault',
    sub: 'Self-hosted secrets engine. Full audit trail.',
    icon: <Shield size={22} />,
  },
  {
    id: 'infisical',
    label: 'Infisical',
    sub: 'Open-source secrets manager. Easy to self-host or use cloud.',
    icon: <Database size={22} />,
  },
  {
    id: 'aws-sm',
    label: 'AWS Secrets Manager',
    sub: 'AWS-managed secrets. Best when already on AWS.',
    icon: <Cloud size={22} />,
  },
];

const TARGET_OPTIONS = [
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    sub: 'Deploy via kubectl to any K8s cluster (EKS, GKE, AKS, bare-metal).',
    icon: <Rocket size={22} />,
  },
  {
    id: 'docker-ssh',
    label: 'Docker Host',
    sub: 'SSH into a VM and run docker compose up. Simple single-server deploy.',
    icon: <Terminal size={22} />,
  },
  {
    id: 'ecs',
    label: 'AWS ECS / Fargate',
    sub: 'Serverless containers on AWS. No cluster management.',
    icon: <Cloud size={22} />,
  },
  {
    id: 'build-only',
    label: 'Build & Push Only',
    sub: 'Just build and push the image — add your own deploy step later.',
    icon: <Package size={22} />,
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
  if (d === 0) return 'today';
  if (d === 1) return '1 day ago';
  return `${d} days ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBar({ steps, current }: { steps: typeof STEPS; current: Step }) {
  const idx = steps.findIndex(s => s.id === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 2px' }}>
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-hover)',
                border: `2px solid ${done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)'}`,
                fontSize: 11, fontWeight: 700,
                color: done || active ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s',
              }}>
                {done ? <Check size={13} /> : i + 1}
              </div>
              <span style={{ fontSize: 9.5, color: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--text-muted)', fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? 'var(--success)' : 'var(--border)', margin: '0 4px', marginBottom: 18, transition: 'background 0.2s' }} />
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
  id?: string; label: string; sub: string; icon: React.ReactNode;
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

function ScanBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 8, border: `1px solid ${ok ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
      {ok
        ? <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
        : <XCircle size={14} style={{ color: 'var(--error)', flexShrink: 0 }} />}
      <span style={{ fontSize: 12, color: ok ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
      {!ok && <span style={{ fontSize: 10, color: 'var(--warning)', marginLeft: 'auto', fontStyle: 'italic' }}>will be generated</span>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DeployMode() {
  const [step, setStep] = useState<Step>('repo');

  // Step 1 — Repos
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);

  // Step 2 — Scan
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Step 2b — Dockerfile (conditional)
  const [dockerfileContent, setDockerfileContent] = useState('');
  const [dockerfileCommitting, setDockerfileCommitting] = useState(false);
  const [dockerfileCommitted, setDockerfileCommitted] = useState(false);

  // Steps 3-6 — Choices
  const [choices, setChoices] = useState<Choices>({ ciTool: null, registry: null, secrets: null, deployTarget: null });

  // Step 7 — Generate
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const rawRef = useRef('');

  // Filter steps — skip dockerfile step in the indicator if has dockerfile
  const visibleSteps = STEPS.filter(s => s.id !== 'dockerfile');

  // Load repos on mount
  useEffect(() => {
    fetch('/api/github/repos', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setRepos(d.repos ?? []))
      .catch(() => {})
      .finally(() => setReposLoading(false));
  }, []);

  // Streaming for pipeline generation
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
    if (files.length > 0) {
      setGeneratedFiles(files);
      setActiveFile(files[0].path);
    }
    toast.success('Pipeline generated!', 'Review and commit to your repo below.');
  }, []);

  const onError = useCallback((err: string) => {
    setIsGenerating(false);
    setGenerateError(err);
  }, []);

  const { start } = useStream('/api/deploy/pipeline', { onChunk, onDone, onError });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectRepo = (repo: Repo) => setSelectedRepo(repo);

  const handleScan = useCallback(async () => {
    if (!selectedRepo) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    setDockerfileCommitted(false);
    try {
      const r = await fetch(`/api/deploy/scan?full_name=${encodeURIComponent(selectedRepo.full_name)}`, { credentials: 'include' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Scan failed');
      setScanResult(data);

      // Auto-generate Dockerfile if missing
      if (!data.has_dockerfile) {
        const dr = await fetch('/api/deploy/dockerfile', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: data.language, framework: data.framework, port: data.port }),
        });
        const dd = await dr.json();
        setDockerfileContent(dd.content ?? '');
      }
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanning(false);
    }
  }, [selectedRepo]);

  const handleCommitDockerfile = useCallback(async () => {
    if (!selectedRepo || !scanResult) return;
    setDockerfileCommitting(true);
    try {
      const r = await fetch('/api/deploy/commit', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_full_name: selectedRepo.full_name,
          branch: scanResult.default_branch,
          files: [{ path: 'Dockerfile', content: dockerfileContent }],
          message: 'ci: add Dockerfile generated by InfraPilot',
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Commit failed');
      setDockerfileCommitted(true);
      setScanResult(prev => prev ? { ...prev, has_dockerfile: true } : prev);
      toast.success('Dockerfile committed!', `Pushed to ${selectedRepo.full_name}`);
    } catch (e) {
      toast.error('Commit failed', String(e));
    } finally {
      setDockerfileCommitting(false);
    }
  }, [selectedRepo, scanResult, dockerfileContent]);

  const handleGenerate = useCallback(async () => {
    if (!selectedRepo || !scanResult || !choices.ciTool) return;
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
      ci_tool: choices.ciTool,
      registry: choices.registry ?? 'none',
      secrets_manager: choices.secrets ?? 'native',
      deploy_target: choices.deployTarget ?? 'build-only',
      has_dockerfile: scanResult.has_dockerfile || dockerfileCommitted,
      port: scanResult.port,
      app_name: scanResult.app_name,
    });
  }, [selectedRepo, scanResult, choices, dockerfileCommitted, start]);

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
          message: `ci: add ${choices.ciTool} pipeline via InfraPilot`,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Commit failed');
      toast.success('Pipeline committed!', `Pushed ${pipelineFiles.length} file(s) to ${selectedRepo.full_name}`);

      // Save config
      await fetch('/api/deploy/configs', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_full_name: selectedRepo.full_name,
          branch: scanResult.default_branch,
          language: scanResult.language,
          framework: scanResult.framework,
          ci_tool: choices.ciTool,
          registry: choices.registry,
          secrets_manager: choices.secrets,
          deploy_target: choices.deployTarget,
          port: scanResult.port,
        }),
      });
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
    else if (step === 'scan') {
      if (!scanResult?.has_dockerfile && !dockerfileCommitted && dockerfileContent) {
        setStep('dockerfile');
      } else {
        setStep('ci');
      }
    }
    else if (step === 'dockerfile') setStep('ci');
    else if (step === 'ci') setStep('registry');
    else if (step === 'registry') setStep('secrets');
    else if (step === 'secrets') setStep('target');
    else if (step === 'target') { setStep('generate'); handleGenerate(); }
  };

  const goBack = () => {
    if (step === 'scan') setStep('repo');
    else if (step === 'dockerfile') setStep('scan');
    else if (step === 'ci') setStep('scan');
    else if (step === 'registry') setStep('ci');
    else if (step === 'secrets') setStep('registry');
    else if (step === 'target') setStep('secrets');
    else if (step === 'generate') setStep('target');
  };

  const canGoNext = () => {
    if (step === 'repo') return !!selectedRepo;
    if (step === 'scan') return !!scanResult && !scanning;
    if (step === 'dockerfile') return true;
    if (step === 'ci') return !!choices.ciTool;
    if (step === 'registry') return !!choices.registry;
    if (step === 'secrets') return !!choices.secrets;
    if (step === 'target') return !!choices.deployTarget;
    return false;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const filteredRepos = repos.filter(r =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    r.description?.toLowerCase().includes(repoSearch.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Rocket size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Deploy Wizard</h2>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>Scan your repo → generate a production CI/CD pipeline → commit directly</p>
          </div>
        </div>
        <StepBar steps={visibleSteps} current={step === 'dockerfile' ? 'scan' : step} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

          {/* ── Step: Repo selection ───────────────────────────────────── */}
          {step === 'repo' && (
            <div style={{ maxWidth: 720 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Select a Repository</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
                We'll scan it to detect language, Dockerfile, and existing CI configs.
              </p>

              {/* Search */}
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
                      key={repo.id}
                      type="button"
                      onClick={() => handleSelectRepo(repo)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                        background: sel ? 'rgba(99,102,241,0.08)' : 'var(--bg-surface)',
                        border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 9, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                        transition: 'all 0.1s',
                      }}
                    >
                      <GitBranch size={16} style={{ color: sel ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {repo.full_name}
                          </span>
                          {repo.private && <Lock size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                          {repo.language && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)', flexShrink: 0 }}>
                              {repo.language}
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {repo.description}
                          </p>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(repo.updated_at)}</div>
                      {sel && <CheckCircle2 size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step: Scan ─────────────────────────────────────────────── */}
          {step === 'scan' && (
            <div style={{ maxWidth: 600 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Scanning {selectedRepo?.full_name}
              </h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
                Detecting language, framework, and existing DevOps files.
              </p>

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
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--error)' }}>Scan failed</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{scanError}</p>
                  </div>
                  <button type="button" onClick={() => { setScanError(null); handleScan(); }} style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <RefreshCw size={11} /> Retry
                  </button>
                </div>
              )}

              {scanResult && !scanning && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Language card */}
                  <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Settings2 size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Detected Stack</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { label: scanResult.language, col: 'var(--accent)' },
                        scanResult.framework && { label: scanResult.framework, col: 'var(--warning)' },
                        scanResult.build_tool && { label: scanResult.build_tool, col: 'var(--success)' },
                        { label: `Port ${scanResult.port}`, col: 'var(--text-muted)' },
                        { label: `Branch: ${scanResult.default_branch}`, col: 'var(--text-muted)' },
                      ].filter(Boolean).map((item: any, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, background: `${item.col}18`, color: item.col, border: `1px solid ${item.col}30` }}>
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* File checklist */}
                  <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <FileCode2 size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>DevOps Files</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <ScanBadge ok={scanResult.has_dockerfile} label="Dockerfile" />
                      <ScanBadge ok={scanResult.has_compose} label="docker-compose.yml" />
                      <ScanBadge ok={scanResult.has_github_actions} label=".github/workflows/" />
                      <ScanBadge ok={scanResult.has_jenkinsfile} label="Jenkinsfile" />
                      <ScanBadge ok={scanResult.has_gitlab_ci} label=".gitlab-ci.yml" />
                    </div>
                  </div>

                  {!scanResult.has_dockerfile && !dockerfileCommitted && (
                    <div style={{ padding: '12px 14px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 9, display: 'flex', gap: 10 }}>
                      <AlertCircle size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        No Dockerfile found. Clicking <strong>Next</strong> will show you a generated one — review and optionally commit it before setting up the CI/CD pipeline.
                      </p>
                    </div>
                  )}

                  {dockerfileCommitted && (
                    <div style={{ padding: '10px 14px', background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 9, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Dockerfile committed to repo.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step: Dockerfile ──────────────────────────────────────── */}
          {step === 'dockerfile' && (
            <div style={{ maxWidth: 680 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Generated Dockerfile</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                No Dockerfile was found in your repo. We've generated one for <strong>{scanResult?.language} / {scanResult?.framework}</strong>. Review, edit if needed, then commit or skip.
              </p>
              <textarea
                value={dockerfileContent}
                onChange={e => setDockerfileContent(e.target.value)}
                style={{
                  width: '100%', minHeight: 320, background: 'var(--bg-surface)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-primary)', fontSize: 12.5,
                  padding: '14px 16px', resize: 'vertical', outline: 'none',
                  fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={handleCommitDockerfile}
                  disabled={dockerfileCommitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {dockerfileCommitting ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <GitBranch size={13} />}
                  {dockerfileCommitting ? 'Committing…' : 'Commit to Repo'}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('ci'); }}
                  style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {/* ── Step: CI/CD Tool ──────────────────────────────────────── */}
          {step === 'ci' && (
            <div style={{ maxWidth: 620 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Choose CI/CD Tool</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>Select the pipeline tool to generate. You can add more pipelines later.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {CI_OPTIONS.map(opt => (
                  <OptionCard key={opt.id} {...opt} selected={choices.ciTool === opt.id} onClick={() => setChoices(c => ({ ...c, ciTool: opt.id }))} />
                ))}
              </div>
            </div>
          )}

          {/* ── Step: Registry ────────────────────────────────────────── */}
          {step === 'registry' && (
            <div style={{ maxWidth: 620 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Container Registry</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>Where should the built Docker image be pushed?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {REGISTRY_OPTIONS.map(opt => (
                  <OptionCard key={opt.id} {...opt} selected={choices.registry === opt.id} onClick={() => setChoices(c => ({ ...c, registry: opt.id }))} />
                ))}
              </div>
            </div>
          )}

          {/* ── Step: Secrets ─────────────────────────────────────────── */}
          {step === 'secrets' && (
            <div style={{ maxWidth: 620 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Secrets Management</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>How will your pipeline access sensitive credentials and environment variables?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {SECRETS_OPTIONS.map(opt => (
                  <OptionCard key={opt.id} {...opt} selected={choices.secrets === opt.id} onClick={() => setChoices(c => ({ ...c, secrets: opt.id }))} />
                ))}
              </div>
            </div>
          )}

          {/* ── Step: Deploy Target ───────────────────────────────────── */}
          {step === 'target' && (
            <div style={{ maxWidth: 620 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Deploy Target</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>Where should the pipeline deploy the container after building?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {TARGET_OPTIONS.map(opt => (
                  <OptionCard key={opt.id} {...opt} selected={choices.deployTarget === opt.id} onClick={() => setChoices(c => ({ ...c, deployTarget: opt.id }))} />
                ))}
              </div>
            </div>
          )}

          {/* ── Step: Generate ────────────────────────────────────────── */}
          {step === 'generate' && (
            <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>
              {/* File list sidebar */}
              <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Generated Files</p>

                {isGenerating && generatedFiles.length === 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[100, 80, 90].map((w, i) => (
                      <div key={i} className="skeleton" style={{ height: 32, width: `${w}%`, borderRadius: 6 }} />
                    ))}
                  </div>
                )}

                {generatedFiles.map(f => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setActiveFile(f.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px',
                      background: activeFile === f.path ? 'var(--bg-hover)' : 'transparent',
                      border: `1px solid ${activeFile === f.path ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                      color: activeFile === f.path ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <FileCode2 size={12} style={{ flexShrink: 0, color: 'var(--accent)' }} />
                    <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path.split('/').pop()}</span>
                  </button>
                ))}

                {generatedFiles.length > 0 && !isGenerating && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button
                      type="button"
                      onClick={handleCommitPipeline}
                      disabled={committing}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {committing ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <GitBranch size={11} />}
                      {committing ? 'Committing…' : 'Commit to Repo'}
                    </button>
                    <a
                      href={`https://github.com/${selectedRepo?.full_name}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', textDecoration: 'none', justifyContent: 'center' }}
                    >
                      <ExternalLink size={11} /> Open on GitHub
                    </a>
                  </div>
                )}
              </div>

              {/* File content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {/* Content header */}
                {activeFile && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', flex: 1 }}>{activeFile}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const f = generatedFiles.find(x => x.path === activeFile);
                        if (f) handleCopy(f.path, f.content);
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                    >
                      {copiedFile === activeFile ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
                      {copiedFile === activeFile ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}

                {/* Streaming indicator */}
                {isGenerating && (
                  <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(99,102,241,0.06)', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                    <Zap size={11} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>Generating pipeline…</span>
                    <span style={{ animation: 'pulse 1.2s ease-in-out infinite', color: 'var(--accent)' }}>●</span>
                  </div>
                )}

                {generateError && (
                  <div style={{ padding: 16, color: 'var(--error)', fontSize: 13 }}>
                    <AlertCircle size={14} style={{ marginRight: 6 }} />
                    {generateError}
                  </div>
                )}

                {/* Code content */}
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
            type="button"
            onClick={goBack}
            disabled={step === 'repo'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: step === 'repo' ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 13, cursor: step === 'repo' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: step === 'repo' ? 0.4 : 1 }}
          >
            ← Back
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            {selectedRepo && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{selectedRepo.name}</span>}
            {scanResult && <><span>·</span><span>{scanResult.language}</span></>}
            {choices.ciTool && <><span>·</span><span>{choices.ciTool}</span></>}
          </div>

          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext() || scanning}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 20px',
              background: canGoNext() && !scanning ? 'var(--accent)' : 'var(--bg-hover)',
              border: 'none', borderRadius: 7, color: canGoNext() && !scanning ? '#fff' : 'var(--text-muted)',
              fontSize: 13, fontWeight: 600, cursor: !canGoNext() || scanning ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', boxShadow: canGoNext() && !scanning ? '0 0 12px var(--accent-glow)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {step === 'target' ? (
              <><Zap size={13} /> Generate Pipeline</>
            ) : step === 'scan' && scanning ? (
              <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Scanning…</>
            ) : (
              <>Next <ChevronRight size={13} /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
