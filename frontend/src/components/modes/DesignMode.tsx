import { useCallback, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Compass, AlertCircle, Layers, CheckSquare,
  GitBranch, TrendingUp, Shield, DollarSign, AlertTriangle, Sparkles,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useStream } from '../../hooks/useStream';
import type { ArchitectureData } from '../../types';

// ─── Colour palette ──────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  loadbalancer: { bg: 'rgba(249,115,22,0.10)',  border: '#f97316', text: '#f97316' },
  lb:           { bg: 'rgba(249,115,22,0.10)',  border: '#f97316', text: '#f97316' },
  compute:      { bg: 'rgba(59,130,246,0.10)',  border: '#3b82f6', text: '#3b82f6' },
  server:       { bg: 'rgba(59,130,246,0.10)',  border: '#3b82f6', text: '#3b82f6' },
  kubernetes:   { bg: 'rgba(96,165,250,0.10)',  border: '#60a5fa', text: '#60a5fa' },
  container:    { bg: 'rgba(96,165,250,0.10)',  border: '#60a5fa', text: '#60a5fa' },
  database:     { bg: 'rgba(34,197,94,0.10)',   border: '#22c55e', text: '#22c55e' },
  db:           { bg: 'rgba(34,197,94,0.10)',   border: '#22c55e', text: '#22c55e' },
  cache:        { bg: 'rgba(168,85,247,0.10)',  border: '#a855f7', text: '#a855f7' },
  storage:      { bg: 'rgba(234,179,8,0.10)',   border: '#eab308', text: '#eab308' },
  cdn:          { bg: 'rgba(239,68,68,0.10)',   border: '#ef4444', text: '#ef4444' },
  network:      { bg: 'rgba(14,165,233,0.10)',  border: '#0ea5e9', text: '#0ea5e9' },
  vpc:          { bg: 'rgba(14,165,233,0.10)',  border: '#0ea5e9', text: '#0ea5e9' },
  gateway:      { bg: 'rgba(245,158,11,0.10)',  border: '#f59e0b', text: '#f59e0b' },
  queue:        { bg: 'rgba(6,182,212,0.10)',   border: '#06b6d4', text: '#06b6d4' },
  monitoring:   { bg: 'rgba(236,72,153,0.10)',  border: '#ec4899', text: '#ec4899' },
  dns:          { bg: 'rgba(99,102,241,0.10)',  border: '#6366f1', text: '#6366f1' },
  firewall:     { bg: 'rgba(251,146,60,0.10)',  border: '#fb923c', text: '#fb923c' },
  default:      { bg: 'rgba(99,102,241,0.10)',  border: '#6366f1', text: '#6366f1' },
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
  const sections: { title: string; body: string }[] = rawParts.map((part) => {
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
          <div
            key={idx}
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {sec.title && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: 6,
                  background: `${m.color}18`, color: m.color, flexShrink: 0,
                }}>
                  {m.icon}
                </span>
                <span style={{
                  fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.07em',
                  textTransform: 'uppercase', color: m.color,
                }}>
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

// ─── Cost breakdown panel ─────────────────────────────────────────────────────

function CostPanel({ rows }: { rows: ArchitectureData['cost_breakdown'] }) {
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  return (
    <div style={{ overflowY: 'auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <DollarSign size={13} style={{ color: '#22c55e' }} />
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#22c55e' }}>
          Cost Breakdown
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 700, color: '#22c55e' }}>
          ${total.toLocaleString()}/mo
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Component', 'Monthly', 'Notes'].map((h) => (
              <th key={h} style={{
                padding: '7px 12px', textAlign: 'left', fontSize: '10px',
                fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '0.07em', borderBottom: '1px solid var(--border)',
                background: 'var(--bg-base)',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <td style={{ padding: '8px 12px', fontSize: '12.5px', color: 'var(--text-primary)', fontWeight: 500 }}>
                {row.service}
              </td>
              <td style={{ padding: '8px 12px', fontSize: '12.5px', fontWeight: 700, whiteSpace: 'nowrap',
                color: row.monthly === 0 ? 'var(--text-muted)' : row.monthly > 500 ? '#f97316' : '#22c55e' }}>
                {row.monthly === 0 ? 'Variable' : `$${row.monthly.toLocaleString()}`}
              </td>
              <td style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {row.description}
              </td>
            </tr>
          ))}
          <tr style={{ background: 'var(--bg-surface)', borderTop: '2px solid var(--border)' }}>
            <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Total estimate
            </td>
            <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 800, color: '#22c55e' }}>
              ${total.toLocaleString()}/mo
            </td>
            <td style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)' }}>
              Indicative costs. Actual billing depends on region, tier, and usage.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Parse helper (strips markdown fences) ────────────────────────────────────

function tryParseJSON(raw: string): ArchitectureData | null {
  for (const src of [raw, raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()]) {
    try {
      const p = JSON.parse(src) as ArchitectureData;
      if (p.diagram_nodes?.length) return p;
    } catch { /* */ }
  }
  return null;
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const EXAMPLES = [
  '3-tier web app, 50k users/day, PostgreSQL, Redis, auto-scaling',
  'Event-driven microservices, Kafka, 1M events/day, Kubernetes',
  'Real-time analytics pipeline, 500k events/sec, high availability',
  'SaaS multi-tenant, isolated DB per tenant, global CDN, 99.99% SLA',
];

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DiagramSkeleton() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[120, 100, 130, 110, 100].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 56, borderRadius: 8 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[100, 130, 110].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 56, borderRadius: 8 }} />
        ))}
      </div>
      <p style={{ fontSize: 13, color: 'var(--accent)', marginTop: 8 }}>
        Designing architecture...
      </p>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[180, 220, 160, 200, 140, 190, 150].map((w, i) => (
        <div key={i} className="skeleton" style={{ height: 13, width: `${w}px`, maxWidth: '100%', borderRadius: 4 }} />
      ))}
    </div>
  );
}

// ─── Diagram legend ───────────────────────────────────────────────────────────

function DiagramLegend({ nodes }: { nodes: ArchitectureData['diagram_nodes'] }) {
  const usedTypes = [...new Set(nodes.map((n) => n.type?.toLowerCase()))];
  const visible = LEGEND_TYPES.filter((t) => usedTypes.includes(t.type));
  if (visible.length === 0) return null;
  return (
    <div style={{
      position: 'absolute', bottom: 48, left: 12, zIndex: 5,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
        Legend
      </p>
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

// ─── Main component ───────────────────────────────────────────────────────────

export function DesignMode() {
  const {
    designInput, setDesignInput,
    architectureData, setArchitectureData,
    appendArchitectureRaw,
    isDesigning, setIsDesigning,
  } = useAppStore();

  const [error, setError] = useState<string | null>(null);
  const rawRef = useRef('');

  const onChunk = useCallback(
    (chunk: string) => {
      rawRef.current += chunk;
      appendArchitectureRaw(chunk);
      const parsed = tryParseJSON(rawRef.current);
      if (parsed) setArchitectureData(parsed);
    },
    [appendArchitectureRaw, setArchitectureData]
  );

  const onDone = useCallback(
    (meta: Record<string, unknown>) => {
      setIsDesigning(false);
      const cleaned = typeof meta.cleaned === 'string' ? meta.cleaned : rawRef.current;
      const parsed = tryParseJSON(cleaned) ?? tryParseJSON(rawRef.current);
      if (parsed) {
        setArchitectureData(parsed);
      } else {
        setError('Could not parse the response. Please try a more specific description.');
      }
    },
    [setIsDesigning, setArchitectureData]
  );

  const onError = useCallback(
    (err: string) => {
      setIsDesigning(false);
      setError(err);
    },
    [setIsDesigning]
  );

  const { start } = useStream('/api/design', { onChunk, onDone, onError });

  const handleDesign = useCallback(async () => {
    if (!designInput.trim() || isDesigning) return;
    setError(null);
    rawRef.current = '';
    setIsDesigning(true);
    setArchitectureData(null);
    await start({ requirements: designInput });
  }, [designInput, isDesigning, start, setIsDesigning, setArchitectureData]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleDesign();
    }
  };

  const rfNodes = architectureData ? buildNodes(architectureData.diagram_nodes) : [];
  const rfEdges = architectureData ? buildEdges(architectureData.diagram_edges) : [];

  const hasData = !!architectureData;
  const showEmpty = !hasData && !isDesigning;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* ── Page header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'rgba(99,102,241,0.12)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Compass size={14} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Architecture Designer</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Production-ready system design with cost estimates
          </div>
        </div>
        {hasData && (
          <button
            type="button"
            onClick={() => { setArchitectureData(null); setError(null); }}
            style={{
              marginLeft: 'auto', padding: '5px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--bg-hover)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            New Design
          </button>
        )}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Empty state */}
        {showEmpty && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '40px 24px' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: 'rgba(99,102,241,0.10)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(99,102,241,0.2)',
            }}>
              <Compass size={28} style={{ color: 'var(--accent)' }} />
            </div>
            <div style={{ textAlign: 'center', maxWidth: 520 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>
                Design Your Architecture
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
                Describe your system — scale, users, data requirements, reliability goals — and
                get a production-ready architecture diagram with implementation guide and monthly cost breakdown.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 620 }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setDesignInput(ex)}
                  style={{
                    padding: '6px 12px', fontSize: '11.5px', fontWeight: 500,
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 20, color: 'var(--text-secondary)', cursor: 'pointer',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.color = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
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

        {/* Full layout when we have data */}
        {hasData && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

            {/* Left: ReactFlow diagram */}
            <div style={{ flex: '0 0 60%', position: 'relative', borderRight: '1px solid var(--border)' }}>
              <ReactFlow nodes={rfNodes} edges={rfEdges} fitView fitViewOptions={{ padding: 0.15 }}>
                <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border)" />
                <Controls
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  }}
                />
              </ReactFlow>
              <DiagramLegend nodes={architectureData.diagram_nodes} />
            </div>

            {/* Right: Analysis panel */}
            <div style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Explanation — top 60% */}
              <div style={{ flex: '0 0 60%', overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', background: 'var(--bg-surface)',
                  borderBottom: '1px solid var(--border)',
                  position: 'sticky', top: 0, zIndex: 1,
                }}>
                  <Layers size={13} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Architecture Analysis
                  </span>
                </div>
                <ExplanationPanel text={architectureData.architecture_explanation} />
              </div>

              {/* Cost breakdown — bottom 40% */}
              <div style={{ flex: '0 0 40%', overflowY: 'auto' }}>
                <CostPanel rows={architectureData.cost_breakdown} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Error bar ── */}
      {error && (
        <div style={{
          padding: '8px 16px', background: 'rgba(239,68,68,0.08)',
          borderTop: '1px solid rgba(239,68,68,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
          flexShrink: 0,
        }}>
          <AlertCircle size={13} style={{ color: 'var(--error)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--error)' }}>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Input bar ── */}
      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        padding: '14px 20px',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-end',
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '10px 14px',
          transition: 'border-color 0.15s',
        }}
          onFocusCapture={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
          onBlurCapture={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <textarea
            value={designInput}
            onChange={(e) => setDesignInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Describe your system — scale, users, data model, reliability requirements, geographic spread…  (Cmd+Enter to generate)"
            rows={2}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit',
              lineHeight: 1.6, resize: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleDesign}
            disabled={isDesigning || !designInput.trim()}
            style={{
              flexShrink: 0,
              padding: '8px 18px',
              background: isDesigning || !designInput.trim() ? 'var(--bg-hover)' : 'var(--accent)',
              border: 'none', borderRadius: 8,
              color: isDesigning || !designInput.trim() ? 'var(--text-muted)' : '#fff',
              fontSize: 13, fontWeight: 600,
              cursor: isDesigning || !designInput.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: isDesigning || !designInput.trim() ? 'none' : '0 0 12px var(--accent-glow)',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            <Compass size={13} />
            {isDesigning ? 'Designing…' : 'Design Architecture'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
          Describe any stack — cloud-native, on-premise, hybrid, microservices, monolith
        </p>
      </div>
    </div>
  );
}
