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
import { CodeBlock } from '../shared/CodeBlock';

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  alb:        { bg: '#1a1a2e', border: '#f97316', text: '#fdba74' },
  eks:        { bg: '#0f1b2e', border: '#3b82f6', text: '#93c5fd' },
  rds:        { bg: '#0d1f18', border: '#22c55e', text: '#86efac' },
  redis:      { bg: '#1f1520', border: '#a855f7', text: '#d8b4fe' },
  s3:         { bg: '#1a1a0e', border: '#eab308', text: '#fde047' },
  cloudfront: { bg: '#1f1010', border: '#ef4444', text: '#fca5a5' },
  ec2:        { bg: '#1a1a2e', border: '#f97316', text: '#fdba74' },
  vpc:        { bg: '#0a1a2e', border: '#0ea5e9', text: '#7dd3fc' },
  igw:        { bg: '#1f1a10', border: '#f59e0b', text: '#fcd34d' },
  nat:        { bg: '#10181f', border: '#06b6d4', text: '#67e8f9' },
};

const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1'];
const COMPLIANCE_OPTIONS = ['PCI DSS', 'SOC 2', 'HIPAA', 'ISO 27001', 'FedRAMP'];

function buildReactFlowNodes(nodes: ArchitectureData['diagram_nodes']): Node[] {
  return nodes.map((n) => {
    const colors = NODE_COLORS[n.type] ?? NODE_COLORS['ec2'];
    return {
      id: n.id,
      position: { x: n.x, y: n.y },
      data: {
        label: (
          <div style={{ textAlign: 'center', padding: '4px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: colors.text }}>{n.label}</div>
            <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>${n.costPerMonth}/mo</div>
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
    style: { stroke: '#4f46e5', strokeWidth: 1.5 },
    labelStyle: { fill: '#8b8b9e', fontSize: 10 },
  }));
}

const DESIGN_TABS = [
  { id: 'terraform', label: 'Terraform' },
  { id: 'k8s', label: 'K8s Manifests' },
  { id: 'cicd', label: 'CI/CD' },
  { id: 'cost', label: 'Cost Breakdown' },
];

export function DesignMode() {
  const {
    designInput, setDesignInput,
    designBudget, setDesignBudget,
    designRegion, setDesignRegion,
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
      // Try to parse JSON as it streams in
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
      // Raw fallback handled in render
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
      region: designRegion,
      compliance: designCompliance,
    });
  }, [designInput, designBudget, designRegion, designCompliance, isDesigning, start, setIsDesigning, setArchitectureData]);

  const toggleCompliance = (c: string) =>
    setDesignCompliance(
      designCompliance.includes(c)
        ? designCompliance.filter((x) => x !== c)
        : [...designCompliance, c]
    );

  const rfNodes = architectureData ? buildReactFlowNodes(architectureData.diagram_nodes) : [];
  const rfEdges = architectureData ? buildReactFlowEdges(architectureData.diagram_edges) : [];

  const activeTabContent = (() => {
    if (!architectureData) return '';
    switch (designActiveTab) {
      case 'terraform': return architectureData.terraform_outline;
      case 'k8s': return architectureData.k8s_manifests;
      case 'cicd': return architectureData.cicd_pipeline;
      default: return '';
    }
  })();

  const activeTabLang = designActiveTab === 'k8s' || designActiveTab === 'cicd' ? 'yaml' : 'hcl';

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: input */}
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
          placeholder="Describe your system requirements, e.g. 'E-commerce platform with 100k daily users, auto-scaling, multi-AZ, Redis caching'..."
          rows={6}
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

        {/* Budget slider */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Monthly Budget</span>
            <span style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}>${designBudget.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={0}
            max={10000}
            step={100}
            value={designBudget}
            onChange={(e) => setDesignBudget(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
            <span>$0</span><span>$10k</span>
          </div>
        </div>

        {/* Region */}
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Region</label>
          <select
            value={designRegion}
            onChange={(e) => setDesignRegion(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: '5px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              padding: '6px 10px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          >
            {REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>

        {/* Compliance */}
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Compliance</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {COMPLIANCE_OPTIONS.map((c) => {
              const checked = designCompliance.includes(c);
              return (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCompliance(c)}
                    style={{ accentColor: 'var(--accent)', width: '14px', height: '14px' }}
                  />
                  <span style={{ fontSize: '12px', color: checked ? 'var(--text-primary)' : 'var(--text-muted)' }}>{c}</span>
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

      {/* Right: diagram + artifacts */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Empty state */}
        {!architectureData && !isDesigning && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--text-muted)' }}>
            <Compass size={40} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: '14px' }}>Describe your requirements and click Design Architecture</p>
          </div>
        )}

        {/* Loading */}
        {isDesigning && !architectureData && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px' }}>
            <p style={{ color: 'var(--accent)', fontSize: '13px' }}>● Generating architecture...</p>
            {[300, 200, 250, 180, 220].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: '16px', width: `${w}px`, maxWidth: '100%' }} />
            ))}
          </div>
        )}

        {architectureData && (
          <>
            {/* React Flow diagram */}
            <div style={{ height: '360px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <ReactFlow nodes={rfNodes} edges={rfEdges} fitView>
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2a35" />
                <Controls style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
              </ReactFlow>
            </div>

            {/* Artifact tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {DESIGN_TABS.map((tab) => {
                const active = designActiveTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setDesignActiveTab(tab.id)}
                    style={{
                      padding: '8px 16px',
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

            {/* Artifact content */}
            <div style={{ flex: 1, overflow: 'hidden', padding: '12px' }}>
              {designActiveTab === 'cost' ? (
                <div style={{ overflow: 'auto', height: '100%' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-surface)' }}>
                        {['Service', 'Monthly Cost', 'Description'].map((h) => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {architectureData.cost_breakdown.map((row, i) => (
                        <tr key={i}>
                          <td style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>{row.service}</td>
                          <td style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--accent)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>${row.monthly}/mo</td>
                          <td style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>{row.description}</td>
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--bg-surface)' }}>
                        <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Total</td>
                        <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--success)' }}>
                          ${architectureData.cost_breakdown.reduce((s, r) => s + r.monthly, 0)}/mo
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <CodeBlock content={activeTabContent} language={activeTabLang} filename={designActiveTab} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
