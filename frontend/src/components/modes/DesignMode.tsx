import { useCallback, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type ReactFlowInstance,
  BackgroundVariant,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Compass, AlertCircle, Layers, CheckSquare,
  GitBranch, TrendingUp, Shield, DollarSign, AlertTriangle, Sparkles,
  ChevronLeft, ArrowRight,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useStream } from '../../hooks/useStream';
import type { ArchitectureData } from '../../types';

// ─── Cloud providers ──────────────────────────────────────────────────────────

interface CloudProvider {
  id: string;
  label: string;
  emoji: string;
  color: string;
  description: string;
}

const CLOUD_PROVIDERS: CloudProvider[] = [
  { id: 'aws',            label: 'AWS',               emoji: '☁',  color: '#ff9900', description: 'EC2, EKS, RDS, S3, Lambda…' },
  { id: 'azure',          label: 'Azure',             emoji: '⬡',  color: '#0089d6', description: 'AKS, SQL, Blob, App Service…' },
  { id: 'gcp',            label: 'Google Cloud',      emoji: '◈',  color: '#4285f4', description: 'GKE, CloudSQL, GCS, BigQuery…' },
  { id: 'oracle',         label: 'Oracle Cloud',      emoji: '◉',  color: '#c74634', description: 'OKE, Autonomous DB, OCI…' },
  { id: 'digitalocean',   label: 'DigitalOcean',      emoji: '◎',  color: '#0080ff', description: 'Droplets, DOKS, Managed DB…' },
  { id: 'system',         label: 'System Architecture',emoji: '⬡',  color: '#818cf8', description: 'Generic system / microservices' },
  { id: 'multi_cloud',    label: 'Multi-Cloud',       emoji: '⊕',  color: '#34d399', description: 'Span across cloud providers' },
  { id: 'bare_metal',     label: 'Bare Metal',        emoji: '▣',  color: '#94a3b8', description: 'On-premise / physical servers' },
];

// ─── Container node colors by depth ──────────────────────────────────────────

const CONTAINER_DEPTH_COLORS: Record<number, { border: string; bg: string; text: string }> = {
  1: { border: '#3b82f6', bg: 'rgba(59,130,246,0.05)',  text: '#3b82f6' },
  2: { border: '#818cf8', bg: 'rgba(129,140,248,0.05)', text: '#818cf8' },
  3: { border: '#06b6d4', bg: 'rgba(6,182,212,0.05)',   text: '#06b6d4' },
  4: { border: '#8b5cf6', bg: 'rgba(139,92,246,0.05)',  text: '#8b5cf6' },
  5: { border: '#34d399', bg: 'rgba(52,211,153,0.04)',  text: '#34d399' },
};

function containerColors(depth: number) {
  return CONTAINER_DEPTH_COLORS[depth] ?? CONTAINER_DEPTH_COLORS[3];
}

// ─── Custom container node ────────────────────────────────────────────────────

function ContainerNode({ data }: { data: { label: string; color: string; textColor: string } }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 10,
        border: `1.5px dashed ${data.color}`,
        background: data.color + '0a',
        display: 'flex',
        alignItems: 'flex-start',
        padding: '8px 12px',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: data.textColor,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          background: 'var(--bg-base)',
          padding: '1px 7px',
          borderRadius: 4,
          border: `1px solid ${data.color}30`,
          whiteSpace: 'nowrap',
        }}
      >
        {data.label}
      </span>
    </div>
  );
}

const NODE_TYPES: NodeTypes = { container: ContainerNode };

// ─── Service node colors ──────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  loadbalancer: { bg: 'rgba(249,115,22,0.12)',  border: '#f97316', text: '#f97316' },
  lb:           { bg: 'rgba(249,115,22,0.12)',  border: '#f97316', text: '#f97316' },
  compute:      { bg: 'rgba(59,130,246,0.12)',  border: '#3b82f6', text: '#3b82f6' },
  server:       { bg: 'rgba(59,130,246,0.12)',  border: '#3b82f6', text: '#3b82f6' },
  kubernetes:   { bg: 'rgba(96,165,250,0.12)',  border: '#60a5fa', text: '#60a5fa' },
  container:    { bg: 'rgba(96,165,250,0.12)',  border: '#60a5fa', text: '#60a5fa' },
  database:     { bg: 'rgba(34,197,94,0.12)',   border: '#22c55e', text: '#22c55e' },
  db:           { bg: 'rgba(34,197,94,0.12)',   border: '#22c55e', text: '#22c55e' },
  cache:        { bg: 'rgba(168,85,247,0.12)',  border: '#a855f7', text: '#a855f7' },
  storage:      { bg: 'rgba(234,179,8,0.12)',   border: '#eab308', text: '#eab308' },
  cdn:          { bg: 'rgba(239,68,68,0.12)',   border: '#ef4444', text: '#ef4444' },
  network:      { bg: 'rgba(14,165,233,0.12)',  border: '#0ea5e9', text: '#0ea5e9' },
  vpc:          { bg: 'rgba(14,165,233,0.12)',  border: '#0ea5e9', text: '#0ea5e9' },
  gateway:      { bg: 'rgba(245,158,11,0.12)',  border: '#f59e0b', text: '#f59e0b' },
  queue:        { bg: 'rgba(6,182,212,0.12)',   border: '#06b6d4', text: '#06b6d4' },
  monitoring:   { bg: 'rgba(236,72,153,0.12)',  border: '#ec4899', text: '#ec4899' },
  dns:          { bg: 'rgba(99,102,241,0.12)',  border: '#6366f1', text: '#6366f1' },
  firewall:     { bg: 'rgba(251,146,60,0.12)',  border: '#fb923c', text: '#fb923c' },
  default:      { bg: 'rgba(99,102,241,0.12)',  border: '#6366f1', text: '#6366f1' },
};

const LEGEND_TYPES: { type: string; label: string }[] = [
  { type: 'loadbalancer', label: 'Load Balancer' },
  { type: 'compute',      label: 'Compute' },
  { type: 'database',     label: 'Database' },
  { type: 'cache',        label: 'Cache' },
  { type: 'queue',        label: 'Queue / Messaging' },
  { type: 'monitoring',   label: 'Observability' },
  { type: 'storage',      label: 'Object Storage' },
  { type: 'gateway',      label: 'API Gateway' },
];

// ─── ReactFlow builders ───────────────────────────────────────────────────────

function buildNodes(nodes: ArchitectureData['diagram_nodes']): Node[] {
  return nodes.map((n) => {
    const isContainer = n.type === 'container';

    if (isContainer) {
      const depth = n.depth ?? 3;
      const c = containerColors(depth);
      return {
        id: n.id,
        type: 'container',
        position: { x: n.x, y: n.y },
        style: {
          width: n.width ?? 300,
          height: n.height ?? 200,
          padding: 0,
          border: 'none',
          background: 'none',
          borderRadius: 10,
        },
        data: { label: n.label, color: c.border, textColor: c.text },
        zIndex: depth,
        selectable: false,
        focusable: false,
      };
    }

    const c = NODE_COLORS[n.type?.toLowerCase()] ?? NODE_COLORS.default;
    return {
      id: n.id,
      position: { x: n.x, y: n.y },
      data: {
        label: (
          <div style={{ textAlign: 'center', padding: '4px 2px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: c.text, lineHeight: 1.3 }}>
              {n.label}
            </div>
            {n.costPerMonth > 0 && (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>
                ${n.costPerMonth}/mo
              </div>
            )}
          </div>
        ),
      },
      style: {
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        borderRadius: 8,
        padding: '6px 14px',
        minWidth: 110,
      },
      zIndex: 10,
    };
  });
}

function buildEdges(edges: ArchitectureData['diagram_edges']): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
    labelStyle: { fill: 'var(--text-muted)', fontSize: 10 },
    zIndex: 20,
  }));
}

// ─── Section meta ─────────────────────────────────────────────────────────────

const SECTION_META: Record<string, { icon: React.ReactNode; color: string }> = {
  'Overview':                   { icon: <Layers size={12} />,        color: '#6366f1' },
  'What You Will Implement':    { icon: <CheckSquare size={12} />,   color: '#22c55e' },
  'Key Design Decisions':       { icon: <GitBranch size={12} />,     color: '#f59e0b' },
  'Scalability & Reliability':  { icon: <TrendingUp size={12} />,    color: '#3b82f6' },
  'Security Posture':           { icon: <Shield size={12} />,        color: '#ec4899' },
  'Monthly Cost Estimate':      { icon: <DollarSign size={12} />,    color: '#22c55e' },
  'Trade-offs & What to Watch': { icon: <AlertTriangle size={12} />, color: '#f97316' },
};

function sectionMeta(title: string) {
  return SECTION_META[title] ?? { icon: <Sparkles size={12} />, color: '#6366f1' };
}

// ─── Body renderer ────────────────────────────────────────────────────────────

function renderBody(body: string) {
  const lines = body.split('\n');
  const output: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      output.push(
        <ol key={output.length} style={{ margin: '0 0 8px 0', paddingLeft: 18 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.75, marginBottom: 3 }}>
              {item}
            </li>
          ))}
        </ol>
      );
    } else if (/^[•\-]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[•\-]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[•\-]\s+/, ''));
        i++;
      }
      output.push(
        <ul key={output.length} style={{ margin: '0 0 8px 0', paddingLeft: 16, listStyleType: 'disc' }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.75, marginBottom: 3 }}>
              {item}
            </li>
          ))}
        </ul>
      );
    } else {
      if (line.trim()) {
        output.push(
          <p key={output.length} style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.75, margin: '0 0 8px 0' }}>
            {line}
          </p>
        );
      }
      i++;
    }
  }
  return output;
}

// ─── Explanation panel ────────────────────────────────────────────────────────

function ExplanationPanel({ text }: { text: string }) {
  if (!text) return null;
  const rawParts = text.split(/(?=## )/g).filter(Boolean);
  const sections = rawParts.map((part) => {
    const m = part.match(/^## (.+)$/m);
    if (!m) return { title: '', body: part.trim() };
    const title = m[1].trim();
    const body = part.slice(part.indexOf('\n') + 1).trim();
    return { title, body };
  });
  return (
    <>
      {sections.map((sec, idx) => {
        const m = sectionMeta(sec.title);
        return (
          <div key={idx} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            {sec.title && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, background: `${m.color}18`, color: m.color, flexShrink: 0 }}>
                  {m.icon}
                </span>
                <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: m.color }}>
                  {sec.title}
                </span>
              </div>
            )}
            <div>{renderBody(sec.body)}</div>
          </div>
        );
      })}
    </>
  );
}

// ─── Cost panel ───────────────────────────────────────────────────────────────

function CostPanel({ rows }: { rows: ArchitectureData['cost_breakdown'] }) {
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  return (
    <div style={{ overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 1 }}>
        <DollarSign size={13} style={{ color: '#22c55e' }} />
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#22c55e' }}>Cost Breakdown</span>
        <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 700, color: '#22c55e' }}>${total.toLocaleString()}/mo</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Component', 'Monthly', 'Notes'].map((h) => (
              <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <td style={{ padding: '8px 12px', fontSize: '12.5px', color: 'var(--text-primary)', fontWeight: 500 }}>{row.service}</td>
              <td style={{ padding: '8px 12px', fontSize: '12.5px', fontWeight: 700, whiteSpace: 'nowrap', color: row.monthly === 0 ? 'var(--text-muted)' : row.monthly > 500 ? '#f97316' : '#22c55e' }}>
                {row.monthly === 0 ? 'Variable' : `$${row.monthly.toLocaleString()}`}
              </td>
              <td style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{row.description}</td>
            </tr>
          ))}
          <tr style={{ background: 'var(--bg-surface)', borderTop: '2px solid var(--border)' }}>
            <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Total estimate</td>
            <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 800, color: '#22c55e' }}>${total.toLocaleString()}/mo</td>
            <td style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)' }}>Indicative. Actual billing depends on region, tier, and usage.</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── JSON parse helpers ───────────────────────────────────────────────────────

function extractJsonCandidate(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    const firstNl = s.indexOf('\n');
    const lastFence = s.lastIndexOf('```');
    if (firstNl !== -1 && lastFence > firstNl) s = s.slice(firstNl + 1, lastFence).trim();
  }
  const openBrace = s.indexOf('{');
  if (openBrace > 0) s = s.slice(openBrace);
  const closeBrace = s.lastIndexOf('}');
  if (closeBrace !== -1) s = s.slice(0, closeBrace + 1);
  return s;
}

function tryParseJSON(raw: string): ArchitectureData | null {
  const candidates = [raw.trim(), extractJsonCandidate(raw)];
  for (const src of candidates) {
    if (!src) continue;
    try {
      const p = JSON.parse(src) as ArchitectureData;
      if (p.diagram_nodes?.length) return p;
    } catch { /* */ }
  }
  return null;
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function DiagramSkeleton() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[120, 100, 130, 110, 100].map((w, i) => (<div key={i} className="skeleton" style={{ width: w, height: 56, borderRadius: 8 }} />))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[100, 130, 110].map((w, i) => (<div key={i} className="skeleton" style={{ width: w, height: 56, borderRadius: 8 }} />))}
      </div>
      <p style={{ fontSize: 13, color: 'var(--accent)', marginTop: 8 }}>Designing architecture…</p>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[180, 220, 160, 200, 140, 190, 150].map((w, i) => (<div key={i} className="skeleton" style={{ height: 13, width: `${w}px`, maxWidth: '100%', borderRadius: 4 }} />))}
    </div>
  );
}

// ─── Diagram legend ───────────────────────────────────────────────────────────

function DiagramLegend({ nodes }: { nodes: ArchitectureData['diagram_nodes'] }) {
  const usedTypes = [...new Set(nodes.filter(n => n.type !== 'container').map((n) => n.type?.toLowerCase()))];
  const visible = LEGEND_TYPES.filter((t) => usedTypes.includes(t.type));
  if (visible.length === 0) return null;
  return (
    <div style={{ position: 'absolute', bottom: 48, left: 12, zIndex: 5, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
      <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Legend</p>
      {visible.map((t) => {
        const c = NODE_COLORS[t.type] ?? NODE_COLORS.default;
        return (
          <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: c.bg, border: `1.5px solid ${c.border}`, flexShrink: 0 }} />
            <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Cloud picker screen ──────────────────────────────────────────────────────

function CloudPickerScreen({ onSelect }: { onSelect: (id: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ width: '100%', maxWidth: 700 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', marginBottom: 18 }}>
            <Compass size={26} style={{ color: 'var(--accent)' }} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px 0', letterSpacing: '-0.01em' }}>
            Choose your infrastructure type
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Select the cloud platform or architecture style to generate a tailored diagram.
          </p>
        </div>

        {/* Provider grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {CLOUD_PROVIDERS.map((p) => {
            const isHovered = hovered === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                onMouseEnter={() => setHovered(p.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '18px 12px',
                  background: isHovered ? `${p.color}12` : 'var(--bg-surface)',
                  border: isHovered ? `1.5px solid ${p.color}60` : '1.5px solid var(--border)',
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 26, lineHeight: 1, color: p.color }}>{p.emoji}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: isHovered ? p.color : 'var(--text-primary)', lineHeight: 1.3 }}>
                  {p.label}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {p.description}
                </div>
              </button>
            );
          })}
        </div>

        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 20 }}>
          Selection shapes the VPC, AZ, and subnet hierarchy in the generated diagram.
        </p>
      </div>
    </div>
  );
}

// ─── Input screen (after provider selected, before generating) ────────────────

const EXAMPLES: Record<string, string[]> = {
  aws:          ['3-tier web app, 50k users/day, PostgreSQL, Redis, auto-scaling', 'Event-driven microservices, SQS, Lambda, Aurora Serverless'],
  azure:        ['AKS-based microservices, Azure SQL, Blob storage, App Gateway', 'Multi-region web app with Traffic Manager and Cosmos DB'],
  gcp:          ['GKE microservices, Cloud SQL, Pub/Sub, 1M events/day', 'BigQuery analytics platform, Dataflow, GCS, Looker'],
  oracle:       ['OKE workload with Autonomous DB and OCI Load Balancer', 'Enterprise app with OCI VCN, ATP, and Object Storage'],
  digitalocean: ['DOKS cluster with Managed PostgreSQL and Spaces', 'Droplet-based app with Load Balancer and Managed Redis'],
  system:       ['Real-time analytics pipeline, 500k events/sec, high availability', 'SaaS multi-tenant, isolated DB per tenant, global CDN'],
  multi_cloud:  ['AWS primary with GCP for ML inference, 99.99% SLA', 'Azure + AWS failover with active-active DNS routing'],
  bare_metal:   ['On-premise Kubernetes, Ceph storage, 10Gbps network', 'Physical rack with HAProxy, PostgreSQL HA, NFS'],
};

function DesignInputScreen({
  cloudProvider,
  designInput,
  onInputChange,
  onDesign,
  isDesigning,
  onBack,
}: {
  cloudProvider: string;
  designInput: string;
  onInputChange: (v: string) => void;
  onDesign: () => void;
  isDesigning: boolean;
  onBack: () => void;
}) {
  const provider = CLOUD_PROVIDERS.find((p) => p.id === cloudProvider);
  const examples = EXAMPLES[cloudProvider] ?? EXAMPLES.system;

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onDesign(); }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '40px 24px' }}>
      {/* Provider badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
        >
          <ChevronLeft size={12} /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 14px', background: provider ? `${provider.color}14` : 'var(--bg-surface)', border: `1px solid ${provider?.color ?? 'var(--border)'}40`, borderRadius: 20 }}>
          <span style={{ fontSize: 16, color: provider?.color }}>{provider?.emoji}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: provider?.color ?? 'var(--text-primary)' }}>{provider?.label}</span>
        </div>
      </div>

      {/* Header */}
      <div style={{ textAlign: 'center', maxWidth: 560 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px 0', letterSpacing: '-0.01em' }}>
          Describe your architecture
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
          Include scale, users, services, data requirements, and reliability goals.
          The more detail you give, the better the diagram.
        </p>
      </div>

      {/* Example chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 640 }}>
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onInputChange(ex)}
            style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = provider?.color ?? 'var(--accent)'; e.currentTarget.style.color = provider?.color ?? 'var(--accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            {ex}
          </button>
        ))}
      </div>

      {/* Text input */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div
          style={{ display: 'flex', gap: 12, alignItems: 'flex-end', background: 'var(--bg-surface)', border: '1.5px solid var(--border)', borderRadius: 12, padding: '12px 16px', transition: 'border-color 0.15s' }}
          onFocusCapture={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
          onBlurCapture={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <textarea
            value={designInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={`Describe your ${provider?.label ?? 'system'} architecture — scale, services, data model, reliability requirements…  (Cmd+Enter to generate)`}
            rows={3}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'none' }}
          />
          <button
            type="button"
            onClick={onDesign}
            disabled={isDesigning || !designInput.trim()}
            style={{
              flexShrink: 0, padding: '9px 20px',
              background: isDesigning || !designInput.trim() ? 'var(--bg-hover)' : (provider?.color ?? 'var(--accent)'),
              border: 'none', borderRadius: 9,
              color: isDesigning || !designInput.trim() ? 'var(--text-muted)' : '#fff',
              fontSize: 13, fontWeight: 600,
              cursor: isDesigning || !designInput.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: isDesigning || !designInput.trim() ? 'none' : `0 0 14px ${(provider?.color ?? 'var(--accent)')}50`,
              transition: 'all 0.15s', whiteSpace: 'nowrap',
            }}
          >
            <ArrowRight size={14} />
            {isDesigning ? 'Designing…' : 'Generate Diagram'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DesignMode() {
  const { designInput, setDesignInput, architectureData, setArchitectureData, appendArchitectureRaw, isDesigning, setIsDesigning } = useAppStore();

  const [error, setError] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [cloudProvider, setCloudProvider] = useState<string | null>(null);
  const rawRef = useRef('');

  const onChunk = useCallback((chunk: string) => {
    rawRef.current += chunk;
    appendArchitectureRaw(chunk);
    const parsed = tryParseJSON(rawRef.current);
    if (parsed) setArchitectureData(parsed);
  }, [appendArchitectureRaw, setArchitectureData]);

  const onDone = useCallback((meta: Record<string, unknown>) => {
    setIsDesigning(false);
    const cleaned = typeof meta.cleaned === 'string' ? meta.cleaned : rawRef.current;
    const parsed = tryParseJSON(cleaned) ?? tryParseJSON(rawRef.current);
    if (parsed) {
      setArchitectureData(parsed);
      setTimeout(() => rfInstance?.fitView({ padding: 0.1 }), 80);
    } else {
      setError('Could not parse the response. Please try a more specific description.');
    }
  }, [setIsDesigning, setArchitectureData, rfInstance]);

  const onError = useCallback((err: string) => {
    setIsDesigning(false);
    setError(err);
  }, [setIsDesigning]);

  const { start } = useStream('/api/design', { onChunk, onDone, onError });

  const handleDesign = useCallback(async () => {
    if (!designInput.trim() || isDesigning || !cloudProvider) return;
    setError(null);
    rawRef.current = '';
    setIsDesigning(true);
    setArchitectureData(null);
    await start({ requirements: designInput, cloud_provider: cloudProvider });
  }, [designInput, isDesigning, cloudProvider, start, setIsDesigning, setArchitectureData]);

  const rfNodes = useMemo(() => architectureData ? buildNodes(architectureData.diagram_nodes) : [], [architectureData]);
  const rfEdges = useMemo(() => architectureData ? buildEdges(architectureData.diagram_edges) : [], [architectureData]);

  const hasData = !!architectureData;
  const showPicker = !cloudProvider && !hasData && !isDesigning;
  const showInput = !!cloudProvider && !hasData && !isDesigning;

  function handleNewDesign() {
    setArchitectureData(null);
    setError(null);
    setCloudProvider(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', height: 50, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Compass size={14} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Architecture Designer</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Production-ready diagrams with cost estimates</div>
        </div>
        {(hasData || cloudProvider) && (
          <button
            type="button"
            onClick={handleNewDesign}
            style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            New Design
          </button>
        )}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Cloud picker */}
        {showPicker && <CloudPickerScreen onSelect={setCloudProvider} />}

        {/* Description input */}
        {showInput && (
          <DesignInputScreen
            cloudProvider={cloudProvider}
            designInput={designInput}
            onInputChange={setDesignInput}
            onDesign={handleDesign}
            isDesigning={isDesigning}
            onBack={() => setCloudProvider(null)}
          />
        )}

        {/* Loading */}
        {isDesigning && !hasData && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: '0 0 60%', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              <DiagramSkeleton />
            </div>
            <div style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <div className="skeleton" style={{ height: 12, width: 160, borderRadius: 4 }} />
              </div>
              <AnalysisSkeleton />
            </div>
          </div>
        )}

        {/* Diagram + analysis */}
        {hasData && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ flex: '0 0 62%', position: 'relative', borderRight: '1px solid var(--border)' }}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <ReactFlow
                  nodes={rfNodes}
                  edges={rfEdges}
                  nodeTypes={NODE_TYPES}
                  fitView
                  fitViewOptions={{ padding: 0.08 }}
                  onInit={(instance) => { setRfInstance(instance); instance.fitView({ padding: 0.08 }); }}
                  minZoom={0.1}
                  maxZoom={2}
                >
                  <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)" />
                  <Controls style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }} />
                </ReactFlow>
              </div>
              <DiagramLegend nodes={architectureData.diagram_nodes} />
            </div>
            <div style={{ flex: '0 0 38%', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, height: '100%' }}>
              <div style={{ flex: '0 0 60%', overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <Layers size={13} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Architecture Analysis</span>
                </div>
                <ExplanationPanel text={architectureData.architecture_explanation} />
              </div>
              <div style={{ flex: '0 0 40%', overflowY: 'auto' }}>
                <CostPanel rows={architectureData.cost_breakdown} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Error bar ── */}
      {error && (
        <div style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.08)', borderTop: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <AlertCircle size={13} style={{ color: 'var(--error)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--error)' }}>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
