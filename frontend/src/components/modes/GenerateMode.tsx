import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, AlertCircle, Rocket, ChevronRight, ChevronDown,
  Folder, FolderOpen, Zap, CheckCircle, Terminal, FileText,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { useClusterStore } from '../../store/clusterStore';
import { useStream } from '../../hooks/useStream';
import { CodeBlock } from '../shared/CodeBlock';
import type { GeneratedFile } from '../../types';

/* ── constants ─────────────────────────────────────────────────────────── */
const TOOLS = ['Terraform', 'Kubernetes', 'Ansible', 'CDK', 'Pulumi'];
const CONTEXT_PILLS = ['AWS', 'Azure', 'GCP', 'Terraform', 'High Availability', 'Multi-AZ', 'Kubernetes'];

const EXT_COLOR: Record<string, string> = {
  tf: '#bc8cff', hcl: '#bc8cff',
  yaml: '#79c0ff', yml: '#79c0ff',
  json: '#d2a679',
  md: '#f59e0b',
  sh: '#3fb950',
  py: '#ffa657',
};

const CLOUD_FIELDS: Record<string, { label: string; key: string; secret?: boolean; placeholder?: string; textarea?: boolean }[]> = {
  aws: [
    { label: 'Access Key ID', key: 'AWS_ACCESS_KEY_ID', placeholder: 'AKIA…' },
    { label: 'Secret Access Key', key: 'AWS_SECRET_ACCESS_KEY', secret: true },
    { label: 'Region', key: 'AWS_REGION', placeholder: 'us-east-1' },
  ],
  azure: [
    { label: 'Subscription ID', key: 'ARM_SUBSCRIPTION_ID', placeholder: 'xxxxxxxx-xxxx-…' },
    { label: 'Client ID (App ID)', key: 'ARM_CLIENT_ID' },
    { label: 'Client Secret', key: 'ARM_CLIENT_SECRET', secret: true },
    { label: 'Tenant ID', key: 'ARM_TENANT_ID' },
  ],
  gcp: [
    { label: 'Project ID', key: 'GOOGLE_PROJECT' },
    { label: 'Service Account JSON', key: 'GOOGLE_CREDENTIALS', secret: true, textarea: true, placeholder: '{ "type": "service_account", … }' },
  ],
  k8s: [
    { label: 'Kubeconfig (paste YAML)', key: 'KUBECONFIG_CONTENT', secret: true, textarea: true, placeholder: 'apiVersion: v1\nclusters:\n…' },
  ],
};

/* ── types ──────────────────────────────────────────────────────────────── */
interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
  file?: GeneratedFile;
}

interface TermLine {
  type: 'start' | 'cmd' | 'output' | 'error' | 'done';
  text?: string;
  cmd?: string;
  label?: string;
  message?: string;
}

/* ── helpers ────────────────────────────────────────────────────────────── */
function parseLlmFiles(raw: string): GeneratedFile[] {
  const map = new Map<string, GeneratedFile>();
  const parts = raw.split(/---\s*FILE:\s*(.+?)\s*---/);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const filename = parts[i].trim();
    const content = parts[i + 1].trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '');
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const langMap: Record<string, GeneratedFile['language']> = {
      tf: 'hcl', hcl: 'hcl', yaml: 'yaml', yml: 'yaml',
      json: 'json', md: 'markdown', sh: 'bash',
    };
    map.set(filename, { path: filename, content, language: langMap[ext] ?? 'bash' });
  }
  if (map.size === 0 && raw.trim()) {
    map.set('main.tf', { path: 'main.tf', content: raw.trim(), language: 'hcl' });
  }
  return Array.from(map.values());
}

function insertNode(nodes: TreeNode[], parts: string[], file: GeneratedFile, depth: number) {
  const name = parts[depth];
  const isLast = depth === parts.length - 1;
  let node = nodes.find(n => n.name === name && n.isFile === isLast);
  if (!node) {
    node = { name, path: parts.slice(0, depth + 1).join('/'), isFile: isLast, children: [], file: isLast ? file : undefined };
    nodes.push(node);
  }
  if (!isLast) insertNode(node.children, parts, file, depth + 1);
}

function buildTree(files: GeneratedFile[]): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const f of files) insertNode(roots, f.path.split('/'), f, 0);
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => a.isFile !== b.isFile ? (a.isFile ? 1 : -1) : a.name.localeCompare(b.name));
    ns.forEach(n => sort(n.children));
  };
  sort(roots);
  return roots;
}

function detectCloud(files: GeneratedFile[]): string {
  const blob = files.map(f => f.path + ' ' + (f.content ?? '')).join(' ').toLowerCase();
  if (blob.includes('azurerm') || blob.includes('azurerm') || blob.includes('aks')) return 'azure';
  if (blob.includes('google_') || blob.includes('gke')) return 'gcp';
  if (blob.includes('aws_') || blob.includes('eks')) return 'aws';
  return 'k8s';
}

/* ── Markdown renderer ──────────────────────────────────────────────────── */
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 3, padding: '1px 5px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#79c0ff' }}>{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i} style={{ color: '#e6edf3', fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });
}

function MarkdownView({ content }: { content: string }) {
  const elems: React.ReactNode[] = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      elems.push(<pre key={`cb-${i}`} style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '10px 14px', overflowX: 'auto', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', margin: '8px 0', color: '#e6edf3', lineHeight: 1.6 }}>{codeLines.join('\n')}</pre>);
    } else if (line.startsWith('# ')) {
      elems.push(<h1 key={i} style={{ fontSize: 16, color: '#e6edf3', margin: '20px 0 10px', borderBottom: '1px solid #30363d', paddingBottom: 8 }}>{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith('## ')) {
      elems.push(<h2 key={i} style={{ fontSize: 13, color: '#f59e0b', margin: '16px 0 8px', fontWeight: 700 }}>{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('### ')) {
      elems.push(<h3 key={i} style={{ fontSize: 12, color: '#e6edf3', margin: '12px 0 6px', fontWeight: 600 }}>{renderInline(line.slice(4))}</h3>);
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1];
      elems.push(<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 13, color: '#8b949e', paddingLeft: 4 }}><span style={{ color: '#58a6ff', minWidth: 18, flexShrink: 0 }}>{num}.</span><span>{renderInline(line.replace(/^\d+\. /, ''))}</span></div>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elems.push(<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: '#8b949e', paddingLeft: 4 }}><span style={{ color: '#58a6ff', flexShrink: 0 }}>•</span><span>{renderInline(line.slice(2))}</span></div>);
    } else if (line === '') {
      elems.push(<div key={i} style={{ height: 6 }} />);
    } else {
      elems.push(<p key={i} style={{ fontSize: 13, color: '#8b949e', margin: '2px 0', lineHeight: 1.7 }}>{renderInline(line)}</p>);
    }
    i++;
  }
  return <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, lineHeight: 1.6 }}>{elems}</div>;
}

/* ── FileNode (recursive) ───────────────────────────────────────────────── */
function FileTreeNode({ node, depth, activeTab, onSelect, open, toggleOpen }: {
  node: TreeNode; depth: number; activeTab: string;
  onSelect: (p: string) => void; open: Set<string>; toggleOpen: (p: string) => void;
}) {
  const isOpen = open.has(node.path);
  const isActive = node.isFile && node.path === activeTab;
  const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
  const dotColor = EXT_COLOR[ext] ?? '#8b949e';
  const pad = 10 + depth * 14;

  if (!node.isFile) {
    return (
      <div>
        <button type="button" onClick={() => toggleOpen(node.path)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: `4px 8px 4px ${pad}px`, background: 'none', border: 'none', cursor: 'pointer', color: '#c9d1d9', fontSize: 12, textAlign: 'left', fontFamily: 'inherit' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
          {isOpen ? <ChevronDown size={11} style={{ color: '#8b949e', flexShrink: 0 }} /> : <ChevronRight size={11} style={{ color: '#8b949e', flexShrink: 0 }} />}
          {isOpen ? <FolderOpen size={13} style={{ color: '#d2a679', flexShrink: 0 }} /> : <Folder size={13} style={{ color: '#d2a679', flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </button>
        {isOpen && node.children.map(c => <FileTreeNode key={c.path} node={c} depth={depth + 1} activeTab={activeTab} onSelect={onSelect} open={open} toggleOpen={toggleOpen} />)}
      </div>
    );
  }

  return (
    <button type="button" onClick={() => onSelect(node.path)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: `4px 8px 4px ${pad + 16}px`, background: isActive ? 'rgba(88,166,255,0.1)' : 'none', border: 'none', borderLeft: `2px solid ${isActive ? dotColor : 'transparent'}`, cursor: 'pointer', color: isActive ? '#e6edf3' : '#8b949e', fontSize: 12, textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.1s' }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none'; }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{node.name}</span>
    </button>
  );
}

/* ── FileExplorer ───────────────────────────────────────────────────────── */
function FileExplorer({ files, activeTab, onSelect }: { files: GeneratedFile[]; activeTab: string; onSelect: (p: string) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const collect = (ns: TreeNode[]) => ns.forEach(n => { if (!n.isFile) { s.add(n.path); collect(n.children); } });
    collect(buildTree(files));
    return s;
  });

  // Auto-open new folders as files arrive
  useEffect(() => {
    const s = new Set(open);
    const collect = (ns: TreeNode[]) => ns.forEach(n => { if (!n.isFile) { s.add(n.path); collect(n.children); } });
    collect(buildTree(files));
    setOpen(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length]);

  const toggleOpen = (p: string) => setOpen(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });

  return (
    <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid #30363d', overflowY: 'auto', overflowX: 'hidden', background: '#161b22', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 10px 4px', fontSize: 10, fontWeight: 700, color: '#8b949e', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
        Explorer
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tree.map(n => <FileTreeNode key={n.path} node={n} depth={0} activeTab={activeTab} onSelect={onSelect} open={open} toggleOpen={toggleOpen} />)}
      </div>
    </div>
  );
}

/* ── CredentialModal ────────────────────────────────────────────────────── */
function CredentialModal({ cloud, onSubmit, onClose }: { cloud: string; onSubmit: (c: Record<string, string>) => void; onClose: () => void }) {
  const fields = CLOUD_FIELDS[cloud] ?? CLOUD_FIELDS.aws;
  const [vals, setVals] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: 24, width: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Zap size={15} style={{ color: '#58a6ff' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>Auto-Implement · {cloud.toUpperCase()}</span>
        </div>
        <p style={{ fontSize: 11, color: '#8b949e', margin: '0 0 16px' }}>Credentials are used once and never stored or logged.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fields.map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', display: 'block', marginBottom: 4 }}>{f.label}</label>
              {f.textarea ? (
                <textarea rows={4} placeholder={f.placeholder} value={vals[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}
                  style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 11, padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
              ) : (
                <input type={f.secret ? 'password' : 'text'} placeholder={f.placeholder} value={vals[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}
                  style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 12, padding: '8px 10px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: 8, background: 'transparent', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button type="button" onClick={() => onSubmit(vals)} style={{ flex: 2, padding: 8, background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Zap size={13} /> Run Implementation
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── TerminalPanel ──────────────────────────────────────────────────────── */
function TerminalPanel({ lines, done, onClose }: { lines: TermLine[]; done: boolean; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length]);

  return (
    <div style={{ borderTop: '1px solid #30363d', background: '#0d1117', display: 'flex', flexDirection: 'column', height: 260, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderBottom: '1px solid #21262d', background: '#161b22', flexShrink: 0 }}>
        <Terminal size={12} style={{ color: '#8b949e' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Terminal</span>
        {!done && <span style={{ fontSize: 11, color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span> Running</span>}
        {done && <span style={{ fontSize: 11, color: '#3fb950' }}>✓ Done</span>}
        <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.8 }}>
        {lines.map((l, i) => {
          if (l.type === 'start') return <div key={i} style={{ color: '#8b949e', marginBottom: 4 }}>{l.message}</div>;
          if (l.type === 'cmd') return (
            <div key={i} style={{ marginTop: 10, marginBottom: 2 }}>
              <span style={{ color: '#3fb950' }}>$ </span>
              <span style={{ color: '#79c0ff', fontWeight: 600 }}>{l.cmd}</span>
              {l.label && <span style={{ color: '#8b949e', marginLeft: 10, fontSize: 10 }}>  — {l.label}</span>}
            </div>
          );
          if (l.type === 'error') return <div key={i} style={{ color: '#f85149', marginTop: 4 }}>✗ {l.text}</div>;
          if (l.type === 'done') return <div key={i} style={{ color: '#3fb950', marginTop: 10, fontWeight: 700, fontSize: 13 }}>✓ {l.message}</div>;
          return <div key={i} style={{ color: '#8b949e' }}>{l.text}</div>;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */
export function GenerateMode() {
  const navigate = useNavigate();
  const {
    generateInput, setGenerateInput,
    generatedFiles, setGeneratedFiles,
    activeFileTab, setActiveFileTab,
    isGenerating, setIsGenerating,
    generateMeta, setGenerateMeta,
  } = useAppStore();
  const { activeCluster, activeNamespace } = useClusterStore();

  const [selectedTools, setSelectedTools] = useState(['Terraform']);
  const [selectedContext, setSelectedContext] = useState(['AWS', 'Terraform', 'High Availability']);
  const [error, setError] = useState<string | null>(null);
  const [showCredModal, setShowCredModal] = useState(false);
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termVisible, setTermVisible] = useState(false);
  const [termDone, setTermDone] = useState(false);

  const rawRef = useRef('');

  const cloud = useMemo(() => detectCloud(generatedFiles), [generatedFiles]);

  const onChunk = useCallback((chunk: string) => {
    rawRef.current += chunk;
    const parsed = parseLlmFiles(rawRef.current);
    setGeneratedFiles(parsed.length > 0 ? parsed : [{ path: 'main.tf', content: rawRef.current, language: 'hcl' }]);
  }, [setGeneratedFiles]);

  const onDone = useCallback((meta: Record<string, unknown>) => {
    setIsGenerating(false);
    setGenerateMeta({
      elapsed: typeof meta.elapsed === 'number' ? meta.elapsed : undefined,
      lines: typeof meta.lines === 'number' ? meta.lines : undefined,
      costEstimate: typeof meta.cost_estimate === 'string' ? meta.cost_estimate : undefined,
    });
    const final = parseLlmFiles(rawRef.current);
    if (final.length > 0) setGeneratedFiles(final);
  }, [setIsGenerating, setGenerateMeta, setGeneratedFiles]);

  const onError = useCallback((err: string) => {
    setIsGenerating(false);
    setError(err);
  }, [setIsGenerating]);

  const { start } = useStream('/api/generate', { onChunk, onDone, onError });

  const handleGenerate = useCallback(async () => {
    if (!generateInput.trim() || isGenerating) return;
    setError(null);
    rawRef.current = '';
    setIsGenerating(true);
    setGeneratedFiles([]);
    setGenerateMeta(null);
    setTermLines([]);
    setTermVisible(false);
    setTermDone(false);
    const ctx = activeCluster ? `\n\nActive cluster: ${activeCluster}, namespace: ${activeNamespace || 'default'}.` : '';
    await start({ prompt: generateInput + ctx, tools: selectedTools, context: selectedContext });
  }, [generateInput, isGenerating, selectedTools, selectedContext, activeCluster, activeNamespace, start, setIsGenerating, setGeneratedFiles, setGenerateMeta]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerate();
  }, [handleGenerate]);

  const toggleTool = (t: string) => setSelectedTools(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleCtx = (c: string) => setSelectedContext(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c]);

  const activeFile = generatedFiles.find(f => f.path === activeFileTab);

  const handleAutoImplement = async (creds: Record<string, string>) => {
    setShowCredModal(false);
    setTermVisible(true);
    setTermDone(false);
    setTermLines([]);

    const payload: Record<string, string> = {};
    for (const f of generatedFiles) {
      if (f.path !== 'guideme.md') payload[f.path] = f.content;
    }

    try {
      const resp = await fetch('/api/implement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payload, cloud, credentials: creds }),
      });
      if (!resp.body) throw new Error('No response stream');
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          if (!line.startsWith('data:')) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as TermLine;
            setTermLines(prev => [...prev, data]);
            if (data.type === 'done' || data.type === 'error') setTermDone(true);
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setTermLines(prev => [...prev, { type: 'error', text: String(e) }]);
      setTermDone(true);
    }
  };

  const hasFiles = generatedFiles.length > 0;
  const showActionBar = hasFiles && !isGenerating;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0d1117' }}>

      {/* ── Main workspace ───────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Empty state */}
        {!hasFiles && !isGenerating && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#484f58', gap: 10 }}>
            <Sparkles size={42} style={{ opacity: 0.15 }} />
            <p style={{ fontSize: 14, color: '#8b949e' }}>Describe your infrastructure and click Generate</p>
            <p style={{ fontSize: 12 }}>Supports Terraform · Kubernetes · Ansible · CDK · Pulumi</p>
          </div>
        )}

        {/* Skeleton while waiting for first file */}
        {isGenerating && !hasFiles && (
          <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[75, 50, 85, 40, 65, 55, 70].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: 14, width: `${w}%`, maxWidth: 520 }} />
            ))}
          </div>
        )}

        {/* VS Code layout */}
        {hasFiles && (
          <>
            {/* File Explorer */}
            <FileExplorer files={generatedFiles} activeTab={activeFileTab} onSelect={setActiveFileTab} />

            {/* Editor column */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

              {/* Tab bar */}
              <div style={{ display: 'flex', alignItems: 'center', background: '#161b22', borderBottom: '1px solid #30363d', overflowX: 'auto', flexShrink: 0 }}>
                {generatedFiles.map(f => {
                  const active = f.path === activeFileTab;
                  const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
                  const col = EXT_COLOR[ext] ?? '#8b949e';
                  const tabName = f.path.split('/').pop() ?? f.path;
                  return (
                    <button key={f.path} type="button" onClick={() => setActiveFileTab(f.path)}
                      style={{ padding: '6px 14px', background: active ? '#0d1117' : 'transparent', border: 'none', borderBottom: `2px solid ${active ? col : 'transparent'}`, color: active ? '#e6edf3' : '#8b949e', fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 5, transition: 'color 0.1s' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0, opacity: active ? 1 : 0.5 }} />
                      {tabName}
                    </button>
                  );
                })}
                <button type="button" onClick={() => navigate('/app/pipeline')}
                  style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'rgba(99,102,241,0.1)', border: '1px solid #6366f1', borderRadius: 5, color: '#a5b4fc', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', margin: '4px 8px', flexShrink: 0 }}>
                  <Rocket size={11} /> Add to Pipeline
                </button>
              </div>

              {/* Content */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {activeFile?.language === 'markdown' ? (
                  <MarkdownView content={activeFile.content} />
                ) : activeFile ? (
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <CodeBlock
                      content={activeFile.content}
                      language={activeFile.language}
                      streaming={isGenerating && activeFile.path === generatedFiles[generatedFiles.length - 1]?.path}
                      filename={activeFile.path}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Terminal panel ───────────────────────────────────────────── */}
      {termVisible && (
        <TerminalPanel lines={termLines} done={termDone} onClose={() => setTermVisible(false)} />
      )}

      {/* ── Action bar (post-generation) ─────────────────────────────── */}
      {showActionBar && !termVisible && (
        <div style={{ borderTop: '1px solid #30363d', background: '#161b22', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {generateMeta && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8b949e' }}>
              <CheckCircle size={13} style={{ color: '#3fb950', flexShrink: 0 }} />
              <span style={{ color: '#3fb950' }}>Generated in {generateMeta.elapsed}s</span>
              {generateMeta.lines && <><span style={{ color: '#30363d' }}>·</span><span>{generateMeta.lines} lines</span></>}
              {generateMeta.costEstimate && <><span style={{ color: '#30363d' }}>·</span><span>Est. {generateMeta.costEstimate}</span></>}
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => {
              const guide = generatedFiles.find(f => f.path === 'guideme.md');
              if (guide) setActiveFileTab('guideme.md');
            }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'transparent', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              <FileText size={13} style={{ color: '#f59e0b' }} /> Implement Myself
            </button>
            <button type="button" onClick={() => setShowCredModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#1f6feb', border: '1px solid #388bfd55', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 12px rgba(31,111,235,0.35)' }}>
              <Zap size={13} /> Auto-Implement
            </button>
          </div>
        </div>
      )}

      {/* ── Input / chat panel (bottom) ──────────────────────────────── */}
      <div style={{ borderTop: '1px solid #30363d', background: '#161b22', padding: '10px 14px', flexShrink: 0 }}>
        {error && (
          <div style={{ padding: '6px 10px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6, color: '#f85149', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertCircle size={13} /> {error}
            <button type="button" onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )}
        <textarea
          value={generateInput}
          onChange={e => setGenerateInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the infrastructure you want to build…"
          rows={2}
          style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 7, color: '#e6edf3', fontSize: 13, padding: '9px 12px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
          onFocus={e => (e.target.style.borderColor = '#58a6ff')}
          onBlur={e => (e.target.style.borderColor = '#30363d')}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
          {CONTEXT_PILLS.map(pill => {
            const on = selectedContext.includes(pill);
            return <button key={pill} type="button" onClick={() => toggleCtx(pill)} style={{ padding: '2px 8px', borderRadius: 100, border: `1px solid ${on ? '#58a6ff' : '#30363d'}`, background: on ? 'rgba(88,166,255,0.1)' : 'transparent', color: on ? '#58a6ff' : '#8b949e', fontSize: 11, cursor: 'pointer' }}>{pill}</button>;
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            {TOOLS.map(t => {
              const on = selectedTools.includes(t);
              return <button key={t} type="button" onClick={() => toggleTool(t)} style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${on ? '#58a6ff' : '#30363d'}`, background: on ? 'rgba(88,166,255,0.1)' : 'transparent', color: on ? '#58a6ff' : '#8b949e', fontSize: 11, fontWeight: on ? 600 : 400, cursor: 'pointer' }}>{t}</button>;
            })}
            {isGenerating && (
              <span style={{ fontSize: 11, color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span>
                {generatedFiles.length} file{generatedFiles.length !== 1 ? 's' : ''}…
              </span>
            )}
            <button type="button" onClick={handleGenerate} disabled={isGenerating || !generateInput.trim()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', background: isGenerating ? '#21262d' : '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: isGenerating ? 'not-allowed' : 'pointer', boxShadow: isGenerating ? 'none' : '0 0 12px rgba(31,111,235,0.4)', opacity: !generateInput.trim() && !isGenerating ? 0.4 : 1 }}>
              <Sparkles size={13} style={{ animation: isGenerating ? 'spin 2s linear infinite' : 'none' }} />
              {isGenerating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {showCredModal && <CredentialModal cloud={cloud} onSubmit={handleAutoImplement} onClose={() => setShowCredModal(false)} />}
    </div>
  );
}
