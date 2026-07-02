import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GitBranch, Search, CheckCircle2, AlertCircle,
  ChevronRight, ChevronDown, Loader2, FileCode2, Copy, Check,
  Server, Container, Shield, Database, Globe, Lock,
  Zap, Cloud, Package, Settings2, ExternalLink, RefreshCw,
  Layers, FolderOpen, Folder, File,
} from 'lucide-react';
import { useStream } from '../../hooks/useStream';
import { toast } from '../../store/toastStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Repo {
  id: number; full_name: string; name: string; description: string;
  private: boolean; language: string; default_branch: string; updated_at: string;
}

interface DetectedService {
  name: string; path: string; language: string; framework: string; port: number;
}

interface ScanResult {
  language: string; framework: string; build_tool: string; port: number;
  app_name: string; default_branch: string; private: boolean;
  has_dockerfile: boolean; has_compose: boolean;
  has_jenkinsfile: boolean; has_github_actions: boolean; has_gitlab_ci: boolean;
  services: DetectedService[];
}

interface Choices {
  ciTool: string | null;
  cdTool: string | null;
  configTool: string | null;
  environments: string[];
  vault: string | null;
  vaultDeployed: boolean;
  registry: string | null;
}

interface GeneratedFile { path: string; content: string }

interface TreeNode {
  name: string; path: string; isDir: boolean; children: TreeNode[];
}

type Step = 'repo' | 'scan' | 'containers' | 'pipeline' | 'envs' | 'vault' | 'generate';

const STEPS: { id: Step; label: string }[] = [
  { id: 'repo',       label: 'Repository' },
  { id: 'scan',       label: 'Scan' },
  { id: 'containers', label: 'Docker Files' },
  { id: 'pipeline',   label: 'CI / CD' },
  { id: 'envs',       label: 'Environments' },
  { id: 'vault',      label: 'Vault & Registry' },
  { id: 'generate',   label: 'Generate' },
];

const ENV_BRANCH: Record<string, string> = { dev: 'dev', staging: 'staging', prod: 'main' };

// ── Option data ───────────────────────────────────────────────────────────────

const CI_OPTIONS = [
  { id: 'github-actions', label: 'GitHub Actions', sub: 'Built-in CI for GitHub repos. Free for public. YAML workflows in .github/workflows/.', badge: 'Recommended', icon: <GitBranch size={20} /> },
  { id: 'gitlab-ci',      label: 'GitLab CI',      sub: 'Built-in GitLab CI. .gitlab-ci.yml at repo root. Powerful stage-based pipeline.', icon: <Layers size={20} /> },
  { id: 'jenkins',        label: 'Jenkins',         sub: 'Self-hosted open-source CI/CD. Declarative Jenkinsfile. Full control.', icon: <Server size={20} /> },
];

const CD_OPTIONS = [
  { id: 'argocd',  label: 'ArgoCD',          sub: 'Pull-based GitOps CD. Watches your repo and syncs K8s state continuously.', badge: 'GitOps', icon: <Zap size={20} /> },
  { id: 'fluxcd',  label: 'FluxCD',          sub: 'CNCF GitOps operator. Lightweight, supports Helm + Kustomize natively.', badge: 'GitOps', icon: <RefreshCw size={20} /> },
  { id: 'inline',  label: 'Inline Deploy',   sub: 'CI pipeline deploys directly via kubectl/helm — no separate CD operator.', icon: <Server size={20} /> },
];

const CONFIG_OPTIONS = [
  { id: 'helm',      label: 'Helm',      sub: 'K8s package manager. Per-env values files (values-dev.yaml, values-prod.yaml). Best for complex apps.', badge: 'Recommended', icon: <Package size={20} /> },
  { id: 'kustomize', label: 'Kustomize', sub: 'Native K8s overlay system. Patch-based per-env customisation. No templating language.', icon: <Settings2 size={20} /> },
];

const ENV_OPTIONS = [
  { id: 'prod',             label: 'Production only',        sub: 'main branch → prod namespace. Simple protected-branch deploy.', envs: ['prod'] },
  { id: 'dev-prod',         label: 'Dev + Production',       sub: 'dev branch → dev namespace, main → prod. Standard GitFlow.', envs: ['dev', 'prod'], badge: 'Recommended' },
  { id: 'staging-prod',     label: 'Staging + Production',   sub: 'staging branch → staging namespace, main → prod.', envs: ['staging', 'prod'] },
  { id: 'dev-staging-prod', label: 'Dev + Staging + Prod',   sub: 'Full pipeline: dev → dev, staging → staging, main → prod.', envs: ['dev', 'staging', 'prod'] },
];

const VAULT_OPTIONS = [
  { id: 'none',      label: 'K8s Secrets',        sub: 'Native Kubernetes Secrets. Zero extra setup. Good for most apps.',      badge: 'Simplest', icon: <Lock size={20} /> },
  { id: 'hashicorp', label: 'HashiCorp Vault',     sub: 'Self-hosted secrets engine. Audit trail, dynamic secrets, rotation.',              icon: <Shield size={20} /> },
  { id: 'infisical', label: 'Infisical',           sub: 'Open-source secrets manager. K8s operator, easy self-host or cloud.',             icon: <Database size={20} /> },
  { id: 'aws-sm',    label: 'AWS Secrets Manager', sub: 'AWS-managed via External Secrets Operator. Best for AWS deployments.',            icon: <Cloud size={20} /> },
];

const REGISTRY_OPTIONS = [
  { id: 'ghcr',       label: 'GHCR',       sub: 'GitHub Container Registry — free, built-in. No extra secret for GitHub Actions.', badge: 'Free', icon: <Globe size={20} /> },
  { id: 'docker-hub', label: 'Docker Hub', sub: 'Default public registry. Widely supported. Free tier available.',                       icon: <Container size={20} /> },
  { id: 'ecr',        label: 'AWS ECR',    sub: 'Amazon Elastic Container Registry. Best for AWS + EKS deployments.',                    icon: <Cloud size={20} /> },
];

const DEPLOY_TARGETS = [
  { id: 'aws-eks',     label: 'AWS EKS',           sub: 'Amazon Elastic Kubernetes Service',          icon: <Cloud size={18} /> },
  { id: 'gcp-gke',    label: 'GCP GKE',            sub: 'Google Kubernetes Engine',                   icon: <Cloud size={18} /> },
  { id: 'azure-aks',  label: 'Azure AKS',          sub: 'Azure Kubernetes Service',                   icon: <Cloud size={18} /> },
  { id: 'do-k8s',     label: 'DigitalOcean K8s',   sub: 'DOKS — simple managed Kubernetes',          icon: <Server size={18} /> },
  { id: 'self-hosted',label: 'Self-hosted K8s',     sub: 'Bare metal or on-prem cluster',              icon: <Server size={18} /> },
  { id: 'fly',        label: 'fly.io',             sub: 'Deploy containers globally via flyctl',      icon: <Globe size={18} /> },
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

function buildFileTree(files: GeneratedFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  function getOrMakeDir(segs: string[]): TreeNode[] {
    if (segs.length === 0) return root;
    const key = segs.join('/');
    if (dirMap.has(key)) return dirMap.get(key)!.children;
    const parent = getOrMakeDir(segs.slice(0, -1));
    const node: TreeNode = { name: segs[segs.length - 1], path: key, isDir: true, children: [] };
    dirMap.set(key, node);
    parent.push(node);
    return node.children;
  }

  for (const file of files) {
    const parts = file.path.split('/');
    const parentList = getOrMakeDir(parts.slice(0, -1));
    parentList.push({ name: parts[parts.length - 1], path: file.path, isDir: false, children: [] });
  }
  return root;
}

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d === 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`;
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['yml', 'yaml'].includes(ext)) return <FileCode2 size={11} style={{ color: '#f59e0b' }} />;
  if (ext === 'md')   return <FileCode2 size={11} style={{ color: '#60a5fa' }} />;
  if (ext === 'json') return <FileCode2 size={11} style={{ color: '#34d399' }} />;
  if (name === 'Dockerfile' || name.startsWith('Dockerfile.')) return <Container size={11} style={{ color: '#818cf8' }} />;
  if (name === 'Jenkinsfile') return <Server size={11} style={{ color: '#f59e0b' }} />;
  return <File size={11} style={{ color: 'var(--text-muted)' }} />;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex(s => s.id === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {STEPS.map((s, i) => {
        const done = i < idx; const active = i === idx;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-hover)', border: `2px solid ${done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)'}`, fontSize: 9, fontWeight: 700, color: done || active ? '#fff' : 'var(--text-muted)', transition: 'all 0.2s' }}>
                {done ? <Check size={10} /> : i + 1}
              </div>
              <span style={{ fontSize: 9, color: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--text-muted)', fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: done ? 'var(--success)' : 'var(--border)', margin: '0 2px', marginBottom: 15, transition: 'background 0.2s' }} />}
          </div>
        );
      })}
    </div>
  );
}

function OptionCard({ label, sub, icon, badge, selected, onClick }: {
  label: string; sub: string; icon: React.ReactNode;
  badge?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 13px', background: selected ? 'rgba(99,102,241,0.08)' : 'var(--bg-hover)', border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 9, cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.15s', fontFamily: 'inherit' }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: selected ? 'rgba(99,102,241,0.15)' : 'var(--bg-surface)', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: selected ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
          {badge && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{badge}</span>}
          {selected && <CheckCircle2 size={12} style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{sub}</p>
      </div>
    </button>
  );
}

function EnvCard({ option, selected, onClick }: { option: typeof ENV_OPTIONS[number]; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: selected ? 'rgba(99,102,241,0.08)' : 'var(--bg-hover)', border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 9, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit', transition: 'all 0.15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{option.label}</span>
        {option.badge && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)', textTransform: 'uppercase' }}>{option.badge}</span>}
        {selected && <CheckCircle2 size={12} style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{option.sub}</p>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {option.envs.map(env => (
          <div key={env} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', borderRadius: 5, background: env === 'prod' ? 'rgba(248,113,113,0.1)' : env === 'staging' ? 'rgba(251,191,36,0.1)' : 'rgba(52,211,153,0.1)', border: `1px solid ${env === 'prod' ? 'rgba(248,113,113,0.3)' : env === 'staging' ? 'rgba(251,191,36,0.3)' : 'rgba(52,211,153,0.3)'}`, color: env === 'prod' ? '#f87171' : env === 'staging' ? '#fbbf24' : '#34d399' }}>
            <GitBranch size={9} />
            <span>{ENV_BRANCH[env] ?? env} → {env}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

// ── File Tree ─────────────────────────────────────────────────────────────────

function TreeView({ nodes, onSelect, selectedPath }: {
  nodes: TreeNode[];
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const dirs = new Set<string>();
    function collect(ns: TreeNode[]) { ns.forEach(n => { if (n.isDir) { dirs.add(n.path); collect(n.children); } }); }
    collect(nodes);
    setExpanded(dirs);
  }, [nodes]);

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const isExp = expanded.has(node.path);
    const isSel = !node.isDir && node.path === selectedPath;
    return (
      <div key={node.path}>
        <button type="button" onClick={() => { if (node.isDir) setExpanded(e => { const n = new Set(e); n.has(node.path) ? n.delete(node.path) : n.add(node.path); return n; }); else onSelect(node.path); }} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: `4px 6px 4px ${6 + depth * 12}px`, background: isSel ? 'rgba(99,102,241,0.1)' : 'transparent', border: 'none', borderRadius: 5, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: isSel ? 'var(--accent)' : 'var(--text-secondary)', transition: 'background 0.1s' }}>
          {node.isDir
            ? <>{isExp ? <ChevronDown size={10} style={{ flexShrink: 0 }} /> : <ChevronRight size={10} style={{ flexShrink: 0 }} />}{isExp ? <FolderOpen size={12} style={{ color: '#fbbf24', flexShrink: 0 }} /> : <Folder size={12} style={{ color: '#fbbf24', flexShrink: 0 }} />}</>
            : <span style={{ paddingLeft: 3 }}>{fileIcon(node.name)}</span>}
          <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </button>
        {node.isDir && isExp && node.children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{nodes.map(n => renderNode(n, 0))}</div>;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DeployMode() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('repo');

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [svcDockerfiles, setSvcDockerfiles] = useState<Record<string, string>>({});
  const [composeContent, setComposeContent] = useState('');
  const [containersFetching, setContainersFetching] = useState(false);
  const [activeContainerTab, setActiveContainerTab] = useState('');
  const [containersCommitting, setContainersCommitting] = useState(false);
  const [containersCommitted, setContainersCommitted] = useState(false);

  const [choices, setChoices] = useState<Choices>({ ciTool: null, cdTool: null, configTool: null, environments: [], vault: null, vaultDeployed: false, registry: null });
  const [selectedEnvOption, setSelectedEnvOption] = useState<string | null>(null);

  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [savingDeployment, setSavingDeployment] = useState(false);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const rawRef = useRef('');

  useEffect(() => {
    fetch('/api/github/repos', { credentials: 'include' })
      .then(r => r.json()).then(d => setRepos(d.repos ?? []))
      .catch(() => {}).finally(() => setReposLoading(false));
  }, []);

  const onChunk = useCallback((chunk: string) => {
    rawRef.current += chunk;
    const files = parsePipelineFiles(rawRef.current);
    if (files.length > 0) { setGeneratedFiles(files); setFileTree(buildFileTree(files)); if (!activeFile) setActiveFile(files[0].path); }
  }, [activeFile]);

  const onDone = useCallback(() => {
    setIsGenerating(false);
    const files = parsePipelineFiles(rawRef.current);
    if (files.length > 0) { setGeneratedFiles(files); setFileTree(buildFileTree(files)); setActiveFile(files[0].path); }
    toast.success('Pipeline generated!', 'Review files, then commit to your repo.');
  }, []);

  const onError = useCallback((err: string) => { setIsGenerating(false); setGenerateError(err); }, []);
  const { start } = useStream('/api/deploy/pipeline', { onChunk, onDone, onError });

  const handleScan = useCallback(async () => {
    if (!selectedRepo) return;
    setScanning(true); setScanError(null); setScanResult(null);
    try {
      const r = await fetch(`/api/deploy/scan?full_name=${encodeURIComponent(selectedRepo.full_name)}`, { credentials: 'include' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Scan failed');
      setScanResult(data);
    } catch (e) { setScanError(String(e)); } finally { setScanning(false); }
  }, [selectedRepo]);

  const fetchContainerFiles = useCallback(async () => {
    if (!scanResult) return;
    setContainersFetching(true);
    try {
      const svcs = scanResult.services;
      const dfResults = await Promise.all(svcs.map(svc =>
        fetch('/api/deploy/dockerfile', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: svc.language, framework: svc.framework, port: svc.port }) }).then(r => r.json())
      ));
      const dfMap: Record<string, string> = {};
      svcs.forEach((svc, i) => { dfMap[svc.name] = dfResults[i]?.content ?? ''; });
      setSvcDockerfiles(dfMap);

      const composeRes = await fetch('/api/deploy/compose', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ services: svcs, app_name: scanResult.app_name }) });
      const cd = await composeRes.json();
      setComposeContent(cd.content ?? '');
      setActiveContainerTab(svcs[0]?.name ?? 'compose');
    } catch (e) { toast.error('Failed to generate container files', String(e)); }
    finally { setContainersFetching(false); }
  }, [scanResult]);

  const handleCommitContainers = useCallback(async () => {
    if (!selectedRepo || !scanResult) return;
    setContainersCommitting(true);
    try {
      const files: { path: string; content: string }[] = [];
      const svcs = scanResult.services;
      if (svcs.length === 1 && svcs[0].path === '.') {
        if (svcDockerfiles[svcs[0].name]) files.push({ path: 'Dockerfile', content: svcDockerfiles[svcs[0].name] });
      } else {
        svcs.forEach(svc => { const df = svcDockerfiles[svc.name]; if (df) files.push({ path: `${svc.path.replace(/\/$/, '')}/Dockerfile`, content: df }); });
      }
      if (composeContent) files.push({ path: 'docker-compose.yml', content: composeContent });

      const r = await fetch('/api/deploy/commit', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo_full_name: selectedRepo.full_name, branch: scanResult.default_branch, files, message: 'ci: add Dockerfiles and docker-compose.yml via InfraPilot' }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Commit failed');
      setContainersCommitted(true);
      toast.success('Docker files committed!', `Pushed ${files.length} file(s) to ${selectedRepo.full_name}`);
    } catch (e) { toast.error('Commit failed', String(e)); } finally { setContainersCommitting(false); }
  }, [selectedRepo, scanResult, svcDockerfiles, composeContent]);

  const handleGenerate = useCallback(async () => {
    if (!selectedRepo || !scanResult || !choices.ciTool || !choices.cdTool) return;
    setIsGenerating(true); setGenerateError(null);
    setGeneratedFiles([]); setFileTree([]); setActiveFile(null); rawRef.current = '';
    await start({
      repo_full_name: selectedRepo.full_name,
      services: scanResult.services,
      ci_tool: choices.ciTool,
      cd_tool: choices.cdTool,
      config_tool: choices.configTool ?? 'helm',
      vault: choices.vault ?? 'none',
      vault_deployed: choices.vaultDeployed,
      registry: choices.registry ?? 'ghcr',
      environments: choices.environments,
      app_name: scanResult.app_name,
    });
  }, [selectedRepo, scanResult, choices, start]);

  const handleCommitPipeline = useCallback(async () => {
    if (!selectedRepo || !scanResult || generatedFiles.length === 0) return;
    setCommitting(true);
    try {
      const files = generatedFiles.filter(f => f.path !== 'setup-guide.md');
      const r = await fetch('/api/deploy/commit', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo_full_name: selectedRepo.full_name, branch: scanResult.default_branch, files, message: `ci: add ${choices.ciTool}+${choices.cdTool}+${choices.configTool} pipeline via InfraPilot` }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Commit failed');
      toast.success('Pipeline committed!', `Pushed ${files.length} file(s) to ${selectedRepo.full_name}`);
      setCommitted(true);
      setShowTargetModal(true);
    } catch (e) { toast.error('Commit failed', String(e)); } finally { setCommitting(false); }
  }, [selectedRepo, scanResult, choices, generatedFiles]);

  const handleSaveDeployment = useCallback(async () => {
    if (!selectedRepo || !scanResult) return;
    setSavingDeployment(true);
    try {
      const r = await fetch('/api/deployments', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_full_name: selectedRepo.full_name,
          branch: scanResult.default_branch,
          ci_tool: choices.ciTool ?? '',
          cd_tool: choices.cdTool ?? '',
          config_tool: choices.configTool ?? '',
          environments: choices.environments,
          registry: choices.registry ?? 'ghcr',
          vault: choices.vault ?? 'none',
          deploy_target: selectedTarget ?? '',
          app_name: scanResult.app_name,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? 'Failed');
      toast.success('Deployment tracked!', 'You can now monitor CI logs and get AI fixes.');
      navigate('/app/deployments');
    } catch (e) { toast.error('Failed to save deployment', String(e)); }
    finally { setSavingDeployment(false); }
  }, [selectedRepo, scanResult, choices, selectedTarget, navigate]);

  const handleCopy = (path: string, content: string) => { navigator.clipboard.writeText(content); setCopiedFile(path); setTimeout(() => setCopiedFile(null), 1800); };

  const goNext = () => {
    if (step === 'repo')       { setStep('scan'); handleScan(); }
    else if (step === 'scan')       { setStep('containers'); fetchContainerFiles(); }
    else if (step === 'containers') setStep('pipeline');
    else if (step === 'pipeline')   setStep('envs');
    else if (step === 'envs')       setStep('vault');
    else if (step === 'vault')      { setStep('generate'); handleGenerate(); }
  };

  const goBack = () => {
    if (step === 'scan')       setStep('repo');
    else if (step === 'containers') setStep('scan');
    else if (step === 'pipeline')   setStep('containers');
    else if (step === 'envs')       setStep('pipeline');
    else if (step === 'vault')      setStep('envs');
    else if (step === 'generate')   setStep('vault');
  };

  const canGoNext = () => {
    if (step === 'repo')       return !!selectedRepo;
    if (step === 'scan')       return !!scanResult && !scanning;
    if (step === 'containers') return !containersFetching;
    if (step === 'pipeline')   return !!choices.ciTool && !!choices.cdTool && !!choices.configTool;
    if (step === 'envs')       return choices.environments.length > 0;
    if (step === 'vault')      return !!choices.vault && !!choices.registry;
    return false;
  };

  const filteredRepos = repos.filter(r =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    (r.description ?? '').toLowerCase().includes(repoSearch.toLowerCase())
  );

  const containerTabs = [
    ...(scanResult?.services ?? []).map(s => ({ id: s.name, label: s.path === '.' ? 'Dockerfile' : `${s.path.replace(/\/$/, '')}/Dockerfile`, svc: s as DetectedService | null })),
    { id: 'compose', label: 'docker-compose.yml', svc: null as DetectedService | null },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '12px 24px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={15} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Deploy Wizard</h2>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>Dockerfiles per service → CI/CD pipeline → K8s manifests per environment</p>
          </div>
          {selectedRepo && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{selectedRepo.name}</span>
              {scanResult?.services && scanResult.services.length > 1 && <><span>·</span><span>{scanResult.services.length} services</span></>}
              {choices.ciTool && <><span>·</span><span>{choices.ciTool}</span></>}
              {choices.environments.length > 0 && <><span>·</span><span>{choices.environments.join('+')}</span></>}
            </div>
          )}
        </div>
        <StepBar current={step} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px' }}>

          {/* ── STEP 1: Repo ────────────────────────────────────────────── */}
          {step === 'repo' && (
            <div style={{ maxWidth: 700 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Select Repository</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>We'll scan to detect services (backend/frontend/admin), languages, and existing DevOps files.</p>

              <div style={{ position: 'relative', marginBottom: 12 }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input value={repoSearch} onChange={e => setRepoSearch(e.target.value)} placeholder="Search repositories…" style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 13, padding: '8px 12px 8px 32px', outline: 'none', boxSizing: 'border-box' }} />
              </div>

              {reposLoading && <div style={{ display: 'flex', gap: 8, color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', alignItems: 'center' }}><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Loading…</div>}
              {!reposLoading && repos.length === 0 && <div style={{ padding: 24, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}><GitBranch size={26} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 8 }} /><p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>No GitHub repositories found.</p><p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Go to Settings → GitHub and add a Personal Access Token first.</p></div>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredRepos.map(repo => {
                  const sel = selectedRepo?.id === repo.id;
                  return (
                    <button key={repo.id} type="button" onClick={() => setSelectedRepo(repo)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: sel ? 'rgba(99,102,241,0.08)' : 'var(--bg-surface)', border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.1s' }}>
                      <GitBranch size={13} style={{ color: sel ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.full_name}</span>
                          {repo.private && <Lock size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                          {repo.language && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)', flexShrink: 0 }}>{repo.language}</span>}
                        </div>
                        {repo.description && <p style={{ margin: '1px 0 0', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.description}</p>}
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{timeAgo(repo.updated_at)}</span>
                      {sel && <CheckCircle2 size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STEP 2: Scan ────────────────────────────────────────────── */}
          {step === 'scan' && (
            <div style={{ maxWidth: 580 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Scanning {selectedRepo?.name}</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>Detecting services (backend/frontend/admin), languages, and existing configs.</p>

              {scanning && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['Fetching repository file tree…', 'Detecting services and languages…', 'Checking for existing DevOps files…'].map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7 }}>
                      <Loader2 size={13} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t}</span>
                    </div>
                  ))}
                </div>
              )}

              {scanError && (
                <div style={{ padding: 14, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 9, display: 'flex', gap: 10 }}>
                  <AlertCircle size={14} style={{ color: 'var(--error)', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1 }}><p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--error)' }}>Scan failed</p><p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{scanError}</p></div>
                  <button type="button" onClick={() => { setScanError(null); handleScan(); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}><RefreshCw size={11} /> Retry</button>
                </div>
              )}

              {scanResult && !scanning && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Detected services */}
                  <div style={{ padding: '13px 15px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                      <Layers size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Detected Services ({scanResult.services.length})</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {scanResult.services.map(svc => (
                        <div key={svc.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 11px', background: 'var(--bg-hover)', borderRadius: 7, border: '1px solid var(--border)' }}>
                          <Container size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{svc.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{svc.path}</span>
                          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.25)' }}>{svc.language}</span>
                            {svc.framework && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}>{svc.framework}</span>}
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>:{svc.port}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Existing files */}
                  <div style={{ padding: '13px 15px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                      <FileCode2 size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Existing DevOps Files</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {[
                        { ok: scanResult.has_dockerfile,     label: 'Dockerfile',          gen: true },
                        { ok: scanResult.has_compose,        label: 'docker-compose.yml',  gen: true },
                        // CI files — only show if already present in the repo
                        ...(scanResult.has_github_actions ? [{ ok: true,  label: '.github/workflows/', gen: false }] : []),
                        ...(scanResult.has_jenkinsfile    ? [{ ok: true,  label: 'Jenkinsfile',        gen: false }] : []),
                        ...(scanResult.has_gitlab_ci      ? [{ ok: true,  label: '.gitlab-ci.yml',     gen: false }] : []),
                      ].map(({ ok, label, gen }) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', background: 'var(--bg-hover)', borderRadius: 6, border: `1px solid ${ok ? 'rgba(52,211,153,0.2)' : 'rgba(99,102,241,0.2)'}` }}>
                          {ok ? <CheckCircle2 size={11} style={{ color: 'var(--success)', flexShrink: 0 }} /> : <Zap size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                          <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)' }}>{label}</span>
                          {!ok && gen && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 'auto' }}>will generate</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 7, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Zap size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Next: generate a <strong>Dockerfile per service</strong> + a combined <strong>docker-compose.yml</strong>.</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Containers ──────────────────────────────────────── */}
          {step === 'containers' && (
            <div style={{ maxWidth: 860 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Docker Files</h3>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>
                {scanResult && scanResult.services.length > 1
                  ? `Generated a Dockerfile for each of the ${scanResult.services.length} detected services, plus a docker-compose.yml.`
                  : 'Generated a Dockerfile and docker-compose.yml. Review and edit if needed.'}
              </p>

              {containersFetching && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating container files…</div>}

              {!containersFetching && (
                <>
                  {/* Service tabs */}
                  <div style={{ display: 'flex', gap: 0, marginBottom: 12, background: 'var(--bg-hover)', borderRadius: 8, padding: 3, width: 'fit-content', flexWrap: 'wrap' }}>
                    {containerTabs.map(tab => (
                      <button key={tab.id} type="button" onClick={() => setActiveContainerTab(tab.id)} style={{ padding: '5px 13px', fontSize: 11, fontWeight: activeContainerTab === tab.id ? 700 : 400, background: activeContainerTab === tab.id ? 'var(--bg-surface)' : 'transparent', border: 'none', borderRadius: 6, color: activeContainerTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Active svc info */}
                  {activeContainerTab !== 'compose' && (() => {
                    const svc = scanResult?.services.find(s => s.name === activeContainerTab);
                    return svc ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, padding: '6px 11px', background: 'var(--bg-hover)', borderRadius: 7, border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                        <Container size={11} style={{ color: 'var(--accent)' }} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          <strong>{svc.name}</strong> · {svc.language} / {svc.framework || svc.language} · :{svc.port}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          → <code style={{ fontSize: 11, background: 'var(--bg-base)', padding: '1px 5px', borderRadius: 3 }}>{svc.path === '.' ? 'Dockerfile' : `${svc.path.replace(/\/$/, '')}/Dockerfile`}</code>
                        </span>
                      </div>
                    ) : null;
                  })()}

                  <textarea
                    value={activeContainerTab === 'compose' ? composeContent : (svcDockerfiles[activeContainerTab] ?? '')}
                    onChange={e => {
                      if (activeContainerTab === 'compose') setComposeContent(e.target.value);
                      else setSvcDockerfiles(prev => ({ ...prev, [activeContainerTab]: e.target.value }));
                    }}
                    style={{ width: '100%', minHeight: 320, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 12, padding: '12px 14px', resize: 'vertical', outline: 'none', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7, boxSizing: 'border-box', marginBottom: 12 }}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" onClick={handleCommitContainers} disabled={containersCommitting || containersCommitted} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: containersCommitted ? 'var(--success)' : 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 600, cursor: containersCommitting || containersCommitted ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: containersCommitting ? 0.7 : 1 }}>
                      {containersCommitting ? <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> : containersCommitted ? <CheckCircle2 size={12} /> : <GitBranch size={12} />}
                      {containersCommitting ? 'Committing…' : containersCommitted ? 'Committed!' : `Commit All to ${selectedRepo?.name}`}
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>or continue without committing</span>
                  </div>

                  {containersCommitted && (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 7, display: 'flex', gap: 7, alignItems: 'center' }}>
                      <CheckCircle2 size={12} style={{ color: 'var(--success)' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Dockerfiles and docker-compose.yml committed to <strong>{selectedRepo?.full_name}</strong>.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── STEP 4: Pipeline (CI + CD + Config) ──────────────────── */}
          {step === 'pipeline' && (
            <div style={{ maxWidth: 640 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>CI / CD Pipeline</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>Choose your CI tool (build &amp; push image) and CD method (deploy to Kubernetes).</p>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: choices.ciTool ? 'var(--success)' : 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{choices.ciTool ? '✓' : '1'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>CI Tool — Build, Test &amp; Push Image</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {CI_OPTIONS.map(opt => <OptionCard key={opt.id} {...opt} selected={choices.ciTool === opt.id} onClick={() => setChoices(c => ({ ...c, ciTool: opt.id }))} />)}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: choices.cdTool ? 'var(--success)' : 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{choices.cdTool ? '✓' : '2'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>CD Method — Deploy to Kubernetes</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {CD_OPTIONS.map(opt => <OptionCard key={opt.id} {...opt} selected={choices.cdTool === opt.id} onClick={() => setChoices(c => ({ ...c, cdTool: opt.id }))} />)}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: choices.configTool ? 'var(--success)' : 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{choices.configTool ? '✓' : '3'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Kubernetes Config Management</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {CONFIG_OPTIONS.map(opt => <OptionCard key={opt.id} {...opt} selected={choices.configTool === opt.id} onClick={() => setChoices(c => ({ ...c, configTool: opt.id }))} />)}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 5: Environments ───────────────────────────────────── */}
          {step === 'envs' && (
            <div style={{ maxWidth: 640 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Deployment Environments</h3>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>Which environments do you need? CI will deploy to the matching K8s namespace when the corresponding branch is pushed.</p>
              <div style={{ marginBottom: 16, padding: '8px 12px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 7, display: 'flex', gap: 7, alignItems: 'center' }}>
                <Lock size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong>main is protected</strong> — production deploys only happen via merge to <code style={{ fontSize: 11 }}>main</code>.
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ENV_OPTIONS.map(opt => <EnvCard key={opt.id} option={opt} selected={selectedEnvOption === opt.id} onClick={() => { setSelectedEnvOption(opt.id); setChoices(c => ({ ...c, environments: opt.envs })); }} />)}
              </div>
            </div>
          )}

          {/* ── STEP 6: Vault & Registry ───────────────────────────────── */}
          {step === 'vault' && (
            <div style={{ maxWidth: 640 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Vault &amp; Container Registry</h3>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>Configure secrets management and where Docker images are pushed.</p>

              <div style={{ marginBottom: 22 }}>
                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Secrets Manager</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {VAULT_OPTIONS.map(opt => <OptionCard key={opt.id} {...opt} selected={choices.vault === opt.id} onClick={() => setChoices(c => ({ ...c, vault: opt.id }))} />)}
                </div>
              </div>

              {choices.vault && choices.vault !== 'none' && (
                <div style={{ padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 22 }}>
                  <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Is {choices.vault === 'hashicorp' ? 'HashiCorp Vault' : choices.vault === 'infisical' ? 'Infisical' : 'AWS Secrets Manager'} already deployed?</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[{ val: true, label: 'Yes, already running' }, { val: false, label: 'No, include setup steps' }].map(({ val, label }) => (
                      <button key={String(val)} type="button" onClick={() => setChoices(c => ({ ...c, vaultDeployed: val }))} style={{ flex: 1, padding: '8px', fontSize: 12, fontWeight: choices.vaultDeployed === val ? 700 : 400, background: choices.vaultDeployed === val ? 'rgba(99,102,241,0.1)' : 'var(--bg-hover)', border: `1.5px solid ${choices.vaultDeployed === val ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 7, cursor: 'pointer', color: choices.vaultDeployed === val ? 'var(--accent)' : 'var(--text-secondary)', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Container Registry</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {REGISTRY_OPTIONS.map(opt => <OptionCard key={opt.id} {...opt} selected={choices.registry === opt.id} onClick={() => setChoices(c => ({ ...c, registry: opt.id }))} />)}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 7: Generate ───────────────────────────────────────── */}
          {step === 'generate' && (
            <div style={{ display: 'flex', gap: 14, height: 'calc(100vh - 200px)', minHeight: 420 }}>
              {/* File tree sidebar */}
              <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Files</span>
                  {generatedFiles.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{generatedFiles.length} generated</span>}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
                  {isGenerating && generatedFiles.length === 0 && (
                    <div style={{ padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {[90, 70, 85, 60, 75, 80, 65, 90].map((w, i) => <div key={i} className="skeleton" style={{ height: 20, width: `${w}%`, borderRadius: 4 }} />)}
                    </div>
                  )}
                  <TreeView nodes={fileTree} onSelect={setActiveFile} selectedPath={activeFile} />
                </div>

                {generatedFiles.length > 0 && !isGenerating && (
                  <div style={{ padding: '8px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    {!committed ? (
                      <button type="button" onClick={handleCommitPipeline} disabled={committing} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 11, fontWeight: 600, cursor: committing ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                        {committing ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <GitBranch size={11} />}
                        {committing ? 'Committing…' : 'Commit to Repo'}
                      </button>
                    ) : (
                      <button type="button" onClick={() => setShowTargetModal(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 7, color: 'var(--success)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <CheckCircle2 size={11} /> Pushed — Set Up Monitoring →
                      </button>
                    )}
                    <a href={`https://github.com/${selectedRepo?.full_name}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)', fontSize: 11, textDecoration: 'none' }}>
                      <ExternalLink size={10} /> Open on GitHub
                    </a>
                  </div>
                )}
              </div>

              {/* File content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {isGenerating && (
                  <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(99,102,241,0.06)', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                    <Loader2 size={11} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>Generating {choices.ciTool} + {choices.cdTool} + {choices.configTool} for [{choices.environments.join(', ')}]…</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>{generatedFiles.length} file{generatedFiles.length !== 1 ? 's' : ''}</span>
                  </div>
                )}

                {activeFile && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '7px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', flexShrink: 0 }}>
                    {fileIcon(activeFile.split('/').pop() ?? '')}
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', flex: 1, marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeFile}</span>
                    <button type="button" onClick={() => { const f = generatedFiles.find(x => x.path === activeFile); if (f) handleCopy(f.path, f.content); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, flexShrink: 0 }}>
                      {copiedFile === activeFile ? <Check size={11} style={{ color: 'var(--success)' }} /> : <Copy size={11} />}
                      {copiedFile === activeFile ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}

                {generateError && <div style={{ padding: 14, color: 'var(--error)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}><AlertCircle size={14} />{generateError}</div>}

                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
                  {activeFile
                    ? <pre style={{ margin: 0, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{generatedFiles.find(f => f.path === activeFile)?.content ?? ''}</pre>
                    : !isGenerating && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>Select a file from the tree to preview</div>
                  }
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Deploy target modal ─────────────────────────────────────────────── */}
      {showTargetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 560, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Where are you deploying?</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
              InfraPilot will monitor your CI runs, stream logs, and suggest fixes automatically.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {DEPLOY_TARGETS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTarget(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    background: selectedTarget === t.id ? 'rgba(99,102,241,0.12)' : 'var(--bg-hover)',
                    border: `1px solid ${selectedTarget === t.id ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                >
                  <span style={{ color: selectedTarget === t.id ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}>{t.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: selectedTarget === t.id ? 'var(--accent)' : 'var(--text-primary)' }}>{t.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{t.sub}</div>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowTargetModal(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Skip for now
              </button>
              <button
                type="button"
                onClick={handleSaveDeployment}
                disabled={savingDeployment}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 20px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600, cursor: savingDeployment ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: '0 0 12px var(--accent-glow)' }}
              >
                {savingDeployment ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Zap size={13} />}
                {savingDeployment ? 'Setting up…' : 'Start Monitoring →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer navigation */}
      {step !== 'generate' && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button type="button" onClick={goBack} disabled={step === 'repo'} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: step === 'repo' ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 13, cursor: step === 'repo' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: step === 'repo' ? 0.4 : 1 }}>← Back</button>

          <button type="button" onClick={goNext} disabled={!canGoNext() || scanning || containersFetching} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 22px', background: canGoNext() && !scanning && !containersFetching ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 7, color: canGoNext() && !scanning && !containersFetching ? '#fff' : 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: !canGoNext() || scanning || containersFetching ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: canGoNext() && !scanning && !containersFetching ? '0 0 12px var(--accent-glow)' : 'none', transition: 'all 0.15s' }}>
            {step === 'vault'
              ? <><Zap size={13} /> Generate Pipeline</>
              : scanning
              ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Scanning…</>
              : containersFetching
              ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating…</>
              : <>Next <ChevronRight size={13} /></>}
          </button>
        </div>
      )}
    </div>
  );
}
