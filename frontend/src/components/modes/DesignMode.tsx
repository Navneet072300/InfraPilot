import { useCallback, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Compass, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useStream } from '../../hooks/useStream';
import type { ArchitectureData } from '../../types';

// Generic service-type colours — no cloud vendor names
const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  loadbalancer:  { bg: 'color-mix(in srgb, #f97316 10%, var(--bg-surface))', border: '#f97316', text: '#f97316' },
  lb:            { bg: 'color-mix(in srgb, #f97316 10%, var(--bg-surface))', border: '#f97316', text: '#f97316' },
  compute:       { bg: 'color-mix(in srgb, #3b82f6 10%, var(--bg-surface))', border: '#3b82f6', text: '#3b82f6' },
  server:        { bg: 'color-mix(in srgb, #3b82f6 10%, var(--bg-surface))', border: '#3b82f6', text: '#3b82f6' },
  kubernetes:    { bg: 'color-mix(in srgb, #60a5fa 10%, var(--bg-surface))', border: '#60a5fa', text: '#60a5fa' },
  container:     { bg: 'color-mix(in srgb, #60a5fa 10%, var(--bg-surface))', border: '#60a5fa', text: '#60a5fa' },
  database:      { bg: 'color-mix(in srgb, var(--success) 10%, var(--bg-surface))', border: 'var(--success)', text: 'var(--success)' },
  db:            { bg: 'color-mix(in srgb, var(--success) 10%, var(--bg-surface))', border: 'var(--success)', text: 'var(--success)' },
  cache:         { bg: 'color-mix(in srgb, #a855f7 10%, var(--bg-surface))', border: '#a855f7', text: '#a855f7' },
  storage:       { bg: 'color-mix(in srgb, #eab308 10%, var(--bg-surface))', border: '#eab308', text: '#eab308' },
  cdn:           { bg: 'color-mix(in srgb, var(--error) 10%, var(--bg-surface))', border: 'var(--error)', text: 'var(--error)' },
  network:       { bg: 'color-mix(in srgb, #0ea5e9 10%, var(--bg-surface))', border: '#0ea5e9', text: '#0ea5e9' },
  vpc:           { bg: 'color-mix(in srgb, #0ea5e9 10%, var(--bg-surface))', border: '#0ea5e9', text: '#0ea5e9' },
  vnet:          { bg: 'color-mix(in srgb, #0ea5e9 10%, var(--bg-surface))', border: '#0ea5e9', text: '#0ea5e9' },
  gateway:       { bg: 'color-mix(in srgb, var(--warning) 10%, var(--bg-surface))', border: 'var(--warning)', text: 'var(--warning)' },
  queue:         { bg: 'color-mix(in srgb, #06b6d4 10%, var(--bg-surface))', border: '#06b6d4', text: '#06b6d4' },
  monitoring:    { bg: 'color-mix(in srgb, #ec4899 10%, var(--bg-surface))', border: '#ec4899', text: '#ec4899' },
  dns:           { bg: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))', border: 'var(--accent)', text: 'var(--accent)' },
  firewall:      { bg: 'color-mix(in srgb, #fb923c 10%, var(--bg-surface))', border: '#fb923c', text: '#fb923c' },
  default:       { bg: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))', border: 'var(--accent)', text: 'var(--accent)' },
};

const COMPLIANCE_OPTIONS = [
  { id: 'PCI DSS',   label: 'Payment Card Security (PCI DSS)' },
  { id: 'SOC 2',     label: 'Data Security & Privacy Audit (SOC 2)' },
  { id: 'HIPAA',     label: 'Healthcare Data Protection (HIPAA)' },
  { id: 'ISO 27001', label: 'Information Security Management (ISO 27001)' },
  { id: 'FedRAMP',   label: 'US Government Cloud Security (FedRAMP)' },
  { id: 'GDPR',      label: 'EU Data Privacy (GDPR)' },
];

function buildReactFlowNodes(nodes: ArchitectureData['diagram_nodes']): Node[] {
  return nodes.map((n) => {
    const colors = NODE_COLORS[n.type?.toLowerCase()] ?? NODE_COLORS['default'];
    return {
      id: n.id,
      position: { x: n.x, y: n.y },
      data: {
        label: (
          <div style={{ textAlign: 'center', padding: '4px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: colors.text }}>{n.label}</div>
            {n.costPerMonth > 0 && (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>${n.costPerMonth}/mo</div>
            )}
          </div>
        ),
      },
      style: {
        background: colors.bg,
        border: `1.5px solid ${colors.border}`,
        borderRadius: '8px',
        padding: '10px 14px',
        minWidth: '130px',
      },
    };
  });
}

function buildReactFlowEdges(edges: ArchitectureData['diagram_edges']): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
    labelStyle: { fill: 'var(--text-muted)', fontSize: 10 },
  }));
}

const DESIGN_TABS = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'cost', label: 'Cost Breakdown' },
];

// Render architecture_explanation as structured paragraphs
function ArchitectureExplanation({ text }: { text: string }) {
  if (!text) return null;
  const sections = text.split(/\n(?=#{1,3} |\*\*[A-Z])/).filter(Boolean);
  return (
    <div style={{ overflowY: 'auto', height: '100%', padding: '4px 8px' }}>
      {sections.map((block, i) => {
        // Heading lines (## or **Title**)
        const headingMatch = block.match(/^#{1,3} (.+)/) || block.match(/^\*\*(.+?)\*\*/);
        if (headingMatch) {
          const heading = headingMatch[1];
          const rest = block.replace(/^#{1,3} .+\n?/, '').replace(/^\*\*.+?\*\*\n?/, '');
          return (
            <div key={i} style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {heading}
              </p>
              {rest.trim() && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {rest.trim()}
                </p>
              )}
            </div>
          );
        }
        // Bullet lists
        if (block.startsWith('- ') || block.startsWith('• ')) {
          const bullets = block.split('\n').filter((l) => l.trim());
          return (
            <ul key={i} style={{ margin: '0 0 14px 0', padding: '0 0 0 18px' }}>
              {bullets.map((b, j) => (
                <li key={j} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 3 }}>
                  {b.replace(/^[-•]\s*/, '')}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 14, whiteSpace: 'pre-wrap' }}>
            {block.trim()}
          </p>
        );
      })}
    </div>
  );
}

export function DesignMode() {
  const {
    designInput, setDesignInput,
    designBudget, setDesignBudget,
    designCloud, setDesignCloud,
    designCompliance, setDesignCompliance,
    architectureData, setArchitectureData,
    appendArchitectureRaw,
    isDesigning, setIsDesigning,
    designActiveTab, setDesignActiveTab,
  } = useAppStore();

  const [error, setError] = useState<string | null>(null);
  const rawRef = useRef('');

  const onChunk = useCallback(
    (chunk: string) => {
      rawRef.current += chunk;
      appendArchitectureRaw(chunk);
      try {
        const parsed = JSON.parse(rawRef.current) as ArchitectureData;
        if (parsed.diagram_nodes) setArchitectureData(parsed);
      } catch {
        // Not complete JSON yet
      }
    },
    [appendArchitectureRaw, setArchitectureData]
  );

  const onDone = useCallback(() => {
    setIsDesigning(false);
    try {
      const parsed = JSON.parse(rawRef.current) as ArchitectureData;
      if (parsed.diagram_nodes) setArchitectureData(parsed);
    } catch {
      // Raw fallback
    }
  }, [setIsDesigning, setArchitectureData]);

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
    useAppStore.getState().setArchitectureData(null);
    await start({
      requirements: designInput,
      budget: designBudget,
      cloud: designCloud || 'any',
      compliance: designCompliance,
    });
  }, [designInput, designBudget, designCloud, designCompliance, isDesigning, start, setIsDesigning, setArchitectureData]);

  const toggleCompliance = (c: string) =>
    setDesignCompliance(
      designCompliance.includes(c)
        ? designCompliance.filter((x) => x !== c)
        : [...designCompliance, c]
    );

  const rfNodes = architectureData ? buildReactFlowNodes(architectureData.diagram_nodes) : [];
  const rfEdges = architectureData ? buildReactFlowEdges(architectureData.diagram_edges) : [];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: input panel */}
      <div
        style={{
          width: '300px',
          minWidth: '300px',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px',
          gap: '14px',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Compass size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Architecture Designer</span>
        </div>

        <textarea
          value={designInput}
          onChange={(e) => setDesignInput(e.target.value)}
          placeholder="Describe your system — e.g. 'Real-time analytics platform handling 500k events/sec, high availability, disaster recovery across two data centres, PostgreSQL with read replicas, Redis caching layer'..."
          rows={7}
          style={{
            width: '100%',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            padding: '10px',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.6,
          }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
        />

        {/* Cloud / Platform */}
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Cloud / Platform
          </label>
          <input
            type="text"
            value={designCloud}
            onChange={(e) => setDesignCloud(e.target.value)}
            placeholder="e.g. AWS, GCP, Azure, on-premise, bare metal…"
            style={{
              width: '100%',
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: '5px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              padding: '7px 10px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
          />
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>
            Leave blank for cloud-neutral recommendations
          </p>
        </div>

        {/* Budget */}
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Monthly Budget</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: 'var(--text-muted)', pointerEvents: 'none' }}>$</span>
            <input
              type="number"
              min={0}
              value={designBudget === 0 ? '' : designBudget}
              placeholder="Enter amount (leave blank for no limit)"
              onChange={(e) => setDesignBudget(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
              style={{
                width: '100%', padding: '8px 10px 8px 22px',
                background: 'var(--bg-base)', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>Leave blank for no budget limit</p>
        </div>

        {/* Compliance */}
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Compliance Requirements</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {COMPLIANCE_OPTIONS.map(({ id, label }) => {
              const checked = designCompliance.includes(id);
              return (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCompliance(id)}
                    style={{ accentColor: 'var(--accent)', width: '14px', height: '14px', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '12px', color: checked ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--error)', borderRadius: '6px', color: 'var(--error)', fontSize: '12px', display: 'flex', gap: '6px' }}>
            <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleDesign}
          disabled={isDesigning || !designInput.trim()}
          style={{
            padding: '9px',
            background: isDesigning ? 'var(--bg-hover)' : 'var(--accent)',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 600,
            cursor: isDesigning ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: isDesigning ? 'none' : '0 0 12px var(--accent-glow)',
          }}
        >
          <Compass size={14} />
          {isDesigning ? 'Designing...' : 'Design Architecture'}
        </button>
      </div>

      {/* Right: diagram + analysis */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Empty state */}
        {!architectureData && !isDesigning && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--text-muted)' }}>
            <Compass size={40} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: '14px' }}>Describe your requirements and click Design Architecture</p>
            <p style={{ fontSize: '12px', maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
              Works with any cloud, on-premise, bare metal, or hybrid setup.
              Specify a platform above for targeted recommendations, or leave it blank for cloud-neutral advice.
            </p>
          </div>
        )}

        {/* Loading */}
        {isDesigning && !architectureData && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px' }}>
            <p style={{ color: 'var(--accent)', fontSize: '13px' }}>● Designing architecture...</p>
            {[320, 260, 290, 200, 240, 180].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: '14px', width: `${w}px`, maxWidth: '100%' }} />
            ))}
          </div>
        )}

        {architectureData && (
          <>
            {/* React Flow diagram */}
            <div style={{ height: '360px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <ReactFlow nodes={rfNodes} edges={rfEdges} fitView>
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
                <Controls style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
              </ReactFlow>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {DESIGN_TABS.map((tab) => {
                const active = designActiveTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDesignActiveTab(tab.id)}
                    style={{
                      padding: '8px 20px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '12px',
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflow: 'hidden', padding: '16px' }}>
              {designActiveTab === 'architecture' ? (
                <ArchitectureExplanation text={architectureData.architecture_explanation} />
              ) : (
                <div style={{ overflow: 'auto', height: '100%' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-surface)' }}>
                        {['Component', 'Est. Monthly Cost', 'Notes'].map((h) => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {architectureData.cost_breakdown.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '9px 12px', fontSize: '13px', color: 'var(--text-primary)' }}>{row.service}</td>
                          <td style={{ padding: '9px 12px', fontSize: '13px', color: 'var(--accent)', fontWeight: 600 }}>
                            {row.monthly === 0 ? 'Variable' : `$${row.monthly.toLocaleString()}/mo`}
                          </td>
                          <td style={{ padding: '9px 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>{row.description}</td>
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--bg-surface)' }}>
                        <td style={{ padding: '9px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Total estimate</td>
                        <td style={{ padding: '9px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--success)' }}>
                          ${architectureData.cost_breakdown.reduce((s, r) => s + r.monthly, 0).toLocaleString()}/mo
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          Costs are estimates. Actual pricing depends on provider, region, and usage.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
