import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, AlertCircle, Rocket, ChevronRight, ChevronDown,
  Folder, FolderOpen, Zap, CheckCircle, Terminal, FileText,
  Plus, Trash2, Clock, MessageSquare,
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
  tf: 'var(--accent)', hcl: 'var(--accent)',
  yaml: 'var(--accent)', yml: 'var(--accent)',
  json: 'var(--warning)',
  md: 'var(--warning)',
  sh: 'var(--success)',
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

interface HistorySession {
  id: number;
  title: string;
  prompt: string;
  tools: string[];
  context: string[];
  files: GeneratedFile[];
  meta: { elapsed?: number; lines?: number; costEstimate?: string };
  created_at: string;
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
  if (blob.includes('azurerm') || blob.includes('aks')) return 'azure';
  if (blob.includes('google_') || blob.includes('gke')) return 'gcp';
  if (blob.includes('aws_') || blob.includes('eks')) return 'aws';
  return 'k8s';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupSessions(sessions: HistorySession[]): { label: string; items: HistorySession[] }[] {
  const now = Date.now();
  const today: HistorySession[] = [], yesterday: HistorySession[] = [],
    week: HistorySession[] = [], older: HistorySession[] = [];
  for (const s of sessions) {
    const diff = now - new Date(s.created_at).getTime();
    const days = diff / 86400000;
    if (days < 1) today.push(s);
    else if (days < 2) yesterday.push(s);
    else if (days < 7) week.push(s);
    else older.push(s);
  }
  return [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'Last 7 days', items: week },
    { label: 'Older', items: older },
  ].filter(g => g.items.length > 0);
}

/* ── Markdown renderer ──────────────────────────────────────────────────── */
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent)' }}>{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
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
      elems.push(<pre key={`cb-${i}`} style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', overflowX: 'auto', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', margin: '8px 0', color: 'var(--text-primary)', lineHeight: 1.6 }}>{codeLines.join('\n')}</pre>);
    } else if (line.startsWith('# ')) {
      elems.push(<h1 key={i} style={{ fontSize: 16, color: 'var(--text-primary)', margin: '20px 0 10px', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith('## ')) {
      elems.push(<h2 key={i} style={{ fontSize: 13, color: 'var(--warning)', margin: '16px 0 8px', fontWeight: 700 }}>{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('### ')) {
      elems.push(<h3 key={i} style={{ fontSize: 12, color: 'var(--text-primary)', margin: '12px 0 6px', fontWeight: 600 }}>{renderInline(line.slice(4))}</h3>);
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1];
      elems.push(<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 4 }}><span style={{ color: 'var(--accent)', minWidth: 18, flexShrink: 0 }}>{num}.</span><span>{renderInline(line.replace(/^\d+\. /, ''))}</span></div>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elems.push(<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 4 }}><span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span><span>{renderInline(line.slice(2))}</span></div>);
    } else if (line === '') {
      elems.push(<div key={i} style={{ height: 6 }} />);
    } else {
      elems.push(<p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0', lineHeight: 1.7 }}>{renderInline(line)}</p>);
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
  const col = EXT_COLOR[ext] ?? 'var(--text-secondary)';
  if (node.isFile) {
    return (
      <button type="button" onClick={() => onSelect(node.path)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 5, padding: `3px 8px 3px ${8 + depth * 12}px`, border: 'none', background: isActive ? 'var(--bg-hover)' : 'transparent', color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left', borderLeft: isActive ? `2px solid ${col}` : '2px solid transparent', fontFamily: 'JetBrains Mono, monospace' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
        {node.name}
      </button>
    );
  }
  return (
    <div>
      <button type="button" onClick={() => toggleOpen(node.path)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: `3px 8px 3px ${8 + depth * 12}px`, border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left' }}>
        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {isOpen ? <FolderOpen size={12} style={{ color: 'var(--warning)', opacity: 0.8 }} /> : <Folder size={12} style={{ color: 'var(--warning)', opacity: 0.6 }} />}
        {node.name}
      </button>
      {isOpen && node.children.map(c => <FileTreeNode key={c.path} node={c} depth={depth + 1} activeTab={activeTab} onSelect={onSelect} open={open} toggleOpen={toggleOpen} />)}
    </div>
  );
}

function FileExplorer({ files, activeTab, onSelect }: { files: GeneratedFile[]; activeTab: string; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(files), [files]);
  const toggleOpen = (p: string) => setOpen(prev => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });
  useEffect(() => {
    const dirs = new Set<string>();
    files.forEach(f => {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    });
    setOpen(dirs);
  }, [files]);

  return (
    <div style={{ width: 180, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 8px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>EXPLORER</div>
      {tree.map(n => <FileTreeNode key={n.path} node={n} depth={0} activeTab={activeTab} onSelect={onSelect} open={open} toggleOpen={toggleOpen} />)}
    </div>
  );
}

/* ── TerminalPanel ──────────────────────────────────────────────────────── */
function TerminalPanel({ lines, done, onClose }: { lines: TermLine[]; done: boolean; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: '#0d0d14', height: 240, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '5px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <Terminal size={12} style={{ color: 'var(--success)', marginRight: 6 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>TERMINAL</span>
        {!done && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }}>● running</span>}
        {done && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--success)' }}>✓ done</span>}
        <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, lineHeight: 1.8 }}>
        {lines.map((l, i) => {
          if (l.type === 'start') return <div key={i} style={{ color: 'var(--accent)', marginBottom: 6 }}>▶ {l.label}</div>;
          if (l.type === 'cmd') return (
            <div key={i} style={{ marginBottom: 2 }}>
              <span style={{ color: 'var(--success)' }}>$ </span>
              <span style={{ color: '#e2e8f0' }}>{l.cmd}</span>
            </div>
          );
          if (l.type === 'output') return <div key={i} style={{ color: '#94a3b8', marginLeft: 12 }}>{l.text}</div>;
          if (l.type === 'error') return <div key={i} style={{ color: 'var(--error)', marginTop: 4 }}>✗ {l.text}</div>;
          if (l.type === 'done') return <div key={i} style={{ color: 'var(--success)', marginTop: 10, fontWeight: 700, fontSize: 13 }}>✓ {l.message}</div>;
          return <div key={i} style={{ color: 'var(--text-secondary)' }}>{l.text}</div>;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ── CredentialModal ────────────────────────────────────────────────────── */
function CredentialModal({ cloud, onSubmit, onClose }: { cloud: string; onSubmit: (c: Record<string, string>) => void; onClose: () => void }) {
  const fields = CLOUD_FIELDS[cloud] ?? CLOUD_FIELDS.k8s;
  const [vals, setVals] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }));
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px', width: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)', fontWeight: 700 }}>Cloud Credentials</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Credentials are used only for this session and never stored.</p>
        {fields.map(f => (
          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{f.label}</label>
            {f.textarea ? (
              <textarea value={vals[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} rows={4}
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', resize: 'none', outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
            ) : (
              <input type={f.secret ? 'password' : 'text'} value={vals[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder}
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '7px 10px', outline: 'none' }} />
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={() => onSubmit(vals)} style={{ padding: '7px 16px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Deploy</button>
        </div>
      </div>
    </div>
  );
}

/* ── History Sidebar ────────────────────────────────────────────────────── */
function HistorySidebar({
  sessions, activeId, loadingSessions, onSelect, onNew, onDelete,
}: {
  sessions: HistorySession[];
  activeId: number | null;
  loadingSessions: boolean;
  onSelect: (s: HistorySession) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
}) {
  const [hoverId, setHoverId] = useState<number | null>(null);
  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  return (
    <div style={{
      width: 220, flexShrink: 0, background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* New Chat button */}
      <div style={{ padding: '10px 10px 8px' }}>
        <button
          type="button"
          onClick={onNew}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 10px', background: 'var(--accent)',
            border: 'none', borderRadius: 7, color: '#fff',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 0 10px var(--accent-glow)',
          }}
        >
          <Plus size={13} /> New Chat
        </button>
      </div>

      {/* Header */}
      <div style={{ padding: '4px 12px 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Clock size={11} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>History</span>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loadingSessions && (
          <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
        )}
        {!loadingSessions && sessions.length === 0 && (
          <div style={{ padding: '24px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={24} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
              Your generations will appear here
            </p>
          </div>
        )}
        {groups.map(group => (
          <div key={group.label}>
            <div style={{ padding: '8px 12px 3px', fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {group.label}
            </div>
            {group.items.map(s => {
              const isActive = s.id === activeId;
              const isHover = hoverId === s.id;
              return (
                <div
                  key={s.id}
                  onMouseEnter={() => setHoverId(s.id)}
                  onMouseLeave={() => setHoverId(null)}
                  style={{
                    position: 'relative', display: 'flex', alignItems: 'flex-start',
                    margin: '1px 6px', borderRadius: 6,
                    background: isActive ? 'var(--bg-hover)' : isHover ? 'var(--bg-hover)' : 'transparent',
                    cursor: 'pointer', transition: 'background 0.1s',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                  onClick={() => onSelect(s)}
                >
                  <div style={{ flex: 1, padding: '6px 8px', minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                      {s.title}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
                      {relativeTime(s.created_at)}
                    </p>
                  </div>
                  {isHover && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                      style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
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

  // History state
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const rawRef = useRef('');

  const cloud = useMemo(() => detectCloud(generatedFiles), [generatedFiles]);

  // Load history on mount
  useEffect(() => {
    fetch('/api/generate/sessions', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { sessions: [] })
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  const onChunk = useCallback((chunk: string) => {
    rawRef.current += chunk;
    const parsed = parseLlmFiles(rawRef.current);
    setGeneratedFiles(parsed.length > 0 ? parsed : [{ path: 'main.tf', content: rawRef.current, language: 'hcl' }]);
  }, [setGeneratedFiles]);

  const onDone = useCallback(async (meta: Record<string, unknown>) => {
    setIsGenerating(false);
    const finalMeta = {
      elapsed: typeof meta.elapsed === 'number' ? meta.elapsed : undefined,
      lines: typeof meta.lines === 'number' ? meta.lines : undefined,
      costEstimate: typeof meta.cost_estimate === 'string' ? meta.cost_estimate : undefined,
    };
    setGenerateMeta(finalMeta);
    const final = parseLlmFiles(rawRef.current);
    if (final.length > 0) setGeneratedFiles(final);

    // Auto-save to history
    const prompt = rawRef.current ? generateInput : '';
    if (prompt) {
      try {
        const resp = await fetch('/api/generate/sessions', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: prompt.slice(0, 80),
            prompt,
            tools: selectedTools,
            context: selectedContext,
            files: final,
            meta: finalMeta,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const newSession: HistorySession = {
            id: data.id,
            title: data.title,
            prompt,
            tools: selectedTools,
            context: selectedContext,
            files: final,
            meta: finalMeta,
            created_at: data.created_at,
          };
          setSessions(prev => [newSession, ...prev]);
          setActiveSessionId(data.id);
        }
      } catch { /* non-critical */ }
    }
  }, [setIsGenerating, setGenerateMeta, setGeneratedFiles, generateInput, selectedTools, selectedContext]);

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
    setActiveSessionId(null);
    const ctx = activeCluster ? `\n\nActive cluster: ${activeCluster}, namespace: ${activeNamespace || 'default'}.` : '';
    await start({ prompt: generateInput + ctx, tools: selectedTools, context: selectedContext });
  }, [generateInput, isGenerating, selectedTools, selectedContext, activeCluster, activeNamespace, start, setIsGenerating, setGeneratedFiles, setGenerateMeta]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerate();
  }, [handleGenerate]);

  const handleNewChat = useCallback(() => {
    setGenerateInput('');
    setGeneratedFiles([]);
    setGenerateMeta(null);
    setActiveSessionId(null);
    setError(null);
    setTermVisible(false);
    setTermLines([]);
    rawRef.current = '';
  }, [setGenerateInput, setGeneratedFiles, setGenerateMeta]);

  const handleLoadSession = useCallback((s: HistorySession) => {
    setGenerateInput(s.prompt);
    setGeneratedFiles(s.files);
    setGenerateMeta(s.meta);
    setActiveSessionId(s.id);
    setError(null);
    setTermVisible(false);
    if (s.files.length > 0) setActiveFileTab(s.files[0].path);
    rawRef.current = '';
  }, [setGenerateInput, setGeneratedFiles, setGenerateMeta, setActiveFileTab]);

  const handleDeleteSession = useCallback(async (id: number) => {
    try {
      await fetch(`/api/generate/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) handleNewChat();
    } catch { /* non-critical */ }
  }, [activeSessionId, handleNewChat]);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* ── Main workspace ───────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* History Sidebar — always visible */}
        <HistorySidebar
          sessions={sessions}
          activeId={activeSessionId}
          loadingSessions={loadingSessions}
          onSelect={handleLoadSession}
          onNew={handleNewChat}
          onDelete={handleDeleteSession}
        />

        {/* Empty state */}
        {!hasFiles && !isGenerating && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 10 }}>
            <Sparkles size={42} style={{ opacity: 0.15 }} />
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Describe your infrastructure and click Generate</p>
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

        {/* VS Code layout — File Explorer + Editor (no tab bar) */}
        {hasFiles && (
          <>
            <FileExplorer files={generatedFiles} activeTab={activeFileTab} onSelect={setActiveFileTab} />

            {/* Editor column */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

              {/* Breadcrumb bar (replaces tab bar) */}
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '0 12px', height: 32, flexShrink: 0, gap: 6 }}>
                {activeFile && (() => {
                  const ext = activeFile.path.split('.').pop()?.toLowerCase() ?? '';
                  const col = EXT_COLOR[ext] ?? 'var(--text-secondary)';
                  const parts = activeFile.path.split('/');
                  return (
                    <>
                      {parts.map((p, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {i > 0 && <ChevronRight size={11} style={{ color: 'var(--text-muted)' }} />}
                          <span style={{ fontSize: 12, color: i === parts.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {i === parts.length - 1 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: col, display: 'inline-block' }} />}
                            {p}
                          </span>
                        </span>
                      ))}
                    </>
                  );
                })()}
                <button type="button" onClick={() => navigate('/app/pipeline')}
                  style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: 'rgba(99,102,241,0.1)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <Rocket size={10} /> Add to Pipeline
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
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {generateMeta && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span style={{ color: 'var(--success)' }}>Generated in {generateMeta.elapsed}s</span>
              {generateMeta.lines && <><span style={{ color: 'var(--border)' }}>·</span><span>{generateMeta.lines} lines</span></>}
              {generateMeta.costEstimate && <><span style={{ color: 'var(--border)' }}>·</span><span>Est. {generateMeta.costEstimate}</span></>}
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => {
              const guide = generatedFiles.find(f => f.path === 'guideme.md');
              if (guide) setActiveFileTab('guideme.md');
            }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              <FileText size={13} style={{ color: 'var(--warning)' }} /> Implement Myself
            </button>
            <button type="button" onClick={() => setShowCredModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 12px var(--accent-glow)' }}>
              <Zap size={13} /> Auto-Implement
            </button>
          </div>
        </div>
      )}

      {/* ── Input / chat panel (bottom) ──────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '10px 14px', flexShrink: 0 }}>
        {error && (
          <div style={{ padding: '6px 10px', background: 'color-mix(in srgb, var(--error) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--error) 35%, transparent)', borderRadius: 6, color: 'var(--error)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertCircle size={13} /> {error}
            <button type="button" onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )}
        <textarea
          value={generateInput}
          onChange={e => setGenerateInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the infrastructure you want to build…"
          rows={2}
          style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 13, padding: '9px 12px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
          {CONTEXT_PILLS.map(pill => {
            const on = selectedContext.includes(pill);
            return <button key={pill} type="button" onClick={() => toggleCtx(pill)} style={{ padding: '2px 8px', borderRadius: 100, border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-glow)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>{pill}</button>;
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            {TOOLS.map(t => {
              const on = selectedTools.includes(t);
              return <button key={t} type="button" onClick={() => toggleTool(t)} style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-glow)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 11, fontWeight: on ? 600 : 400, cursor: 'pointer' }}>{t}</button>;
            })}
            {isGenerating && (
              <span style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span>
                {generatedFiles.length} file{generatedFiles.length !== 1 ? 's' : ''}…
              </span>
            )}
            <button type="button" onClick={handleGenerate} disabled={isGenerating || !generateInput.trim()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', background: isGenerating ? 'var(--bg-hover)' : 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: isGenerating ? 'not-allowed' : 'pointer', boxShadow: isGenerating ? 'none' : '0 0 12px var(--accent-glow)', opacity: !generateInput.trim() && !isGenerating ? 0.4 : 1 }}>
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
