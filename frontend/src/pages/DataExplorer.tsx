import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Database, RefreshCw, ChevronDown, Play, Send, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

interface DataService {
  id: string;
  type: string;
  icon: string;
  label: string;
  port: number;
  pod_name: string;
  namespace: string;
  pod_status: string;
  ready: string;
  image: string;
  actions: { id: string; label: string }[];
}

interface InspectResult {
  action: string;
  label: string;
  pod: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  requires_confirmation?: boolean;
  message?: string;
}

interface AiResult {
  action_id: string | null;
  explanation: string;
  suggestion: string;
  result: { exit_code?: number; stdout?: string; stderr?: string; requires_confirmation?: boolean };
}

const STATUS_COLOR: Record<string, string> = {
  Running: 'var(--success)', Pending: 'var(--warning)', Failed: 'var(--error)',
  CrashLoopBackOff: 'var(--error)', Terminating: 'var(--warning)',
};

export function DataExplorer() {
  const [namespace, setNamespace] = useState('default');
  const [selected, setSelected] = useState<DataService | null>(null);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ type: 'inspect'; action_id: string } | { type: 'ai'; question: string } | null>(null);

  // Load namespaces
  const { data: nsData } = useQuery({
    queryKey: ['explore-namespaces'],
    queryFn: () => fetch('/api/explore/namespaces').then((r) => r.json()),
    staleTime: 60_000,
  });
  const namespaces: string[] = nsData?.namespaces ?? ['default'];

  // Scan selected namespace
  const { data: scanData, isLoading: scanning, refetch: rescan } = useQuery({
    queryKey: ['explore-scan', namespace],
    queryFn: () => fetch(`/api/explore/scan?namespace=${encodeURIComponent(namespace)}`).then((r) => r.json()),
    staleTime: 30_000,
  });
  const services: DataService[] = scanData?.services ?? [];

  // Inspect mutation
  const inspectMut = useMutation({
    mutationFn: (body: object) =>
      fetch('/api/explore/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: (data: InspectResult) => {
      if (data.requires_confirmation) {
        setPendingConfirm({ type: 'inspect', action_id: (pendingConfirm as { type: 'inspect'; action_id: string })?.action_id ?? '' });
      } else {
        setInspectResult(data);
        setPendingConfirm(null);
      }
    },
  });

  // AI query mutation
  const aiMut = useMutation({
    mutationFn: (body: object) =>
      fetch('/api/explore/ai-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: (data: AiResult) => {
      if (data.result?.requires_confirmation) {
        setPendingConfirm({ type: 'ai', question: aiQuestion });
      } else {
        setAiResult(data);
        setPendingConfirm(null);
      }
    },
  });

  function runInspect(action_id: string, confirmed = false) {
    if (!selected) return;
    setPendingConfirm(confirmed ? null : { type: 'inspect', action_id });
    inspectMut.mutate({ pod_name: selected.pod_name, namespace: selected.namespace, service_type: selected.type, action_id, confirmed });
  }

  function runAiQuery(confirmed = false) {
    if (!selected || !aiQuestion.trim()) return;
    aiMut.mutate({ pod_name: selected.pod_name, namespace: selected.namespace, service_type: selected.type, service_label: selected.label, question: aiQuestion, confirmed });
  }

  const busyInspect = inspectMut.isPending;
  const busyAi = aiMut.isPending;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Database size={20} style={{ color: 'var(--accent)' }} />
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Data Explorer</h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '1px 0 0' }}>Discover and inspect data services in your cluster</p>
          </div>
        </div>
        {/* Namespace selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Namespace</span>
          <div style={{ position: 'relative' }}>
            <select
              value={namespace}
              onChange={(e) => { setNamespace(e.target.value); setSelected(null); setInspectResult(null); setAiResult(null); }}
              style={{ appearance: 'none', padding: '6px 28px 6px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
            >
              {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
          </div>
          <button type="button" onClick={() => rescan()} disabled={scanning} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw size={12} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} /> Scan
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: service list */}
        <div style={{ width: 280, borderRight: '1px solid var(--border)', padding: '16px 12px', overflowY: 'auto', flexShrink: 0 }}>
          {scanning && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 8 }} />)}
            </div>
          )}

          {!scanning && services.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--text-muted)' }}>
              <Database size={28} style={{ opacity: 0.2, marginBottom: 10 }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No data services found</p>
              <p style={{ fontSize: 12 }}>No recognised databases or stores in <strong>{namespace}</strong>. Try a different namespace.</p>
            </div>
          )}

          {!scanning && services.map((svc) => {
            const active = selected?.id === svc.id;
            const statusColor = STATUS_COLOR[svc.pod_status] ?? 'var(--text-muted)';
            return (
              <div
                key={svc.id}
                onClick={() => { setSelected(svc); setInspectResult(null); setAiResult(null); setPendingConfirm(null); }}
                style={{ padding: '12px 14px', borderRadius: 9, marginBottom: 6, cursor: 'pointer', background: active ? 'rgba(88,166,255,0.1)' : 'var(--bg-surface)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, transition: 'all 0.15s' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 18 }}>{svc.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{svc.label}</p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.pod_name}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: statusColor }}>● {svc.pod_status}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· ready {svc.ready}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>:{svc.port}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: inspect panel */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {!selected && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: 12 }}>
              <Database size={40} style={{ opacity: 0.15 }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>Select a service to inspect</p>
              <p style={{ fontSize: 13, textAlign: 'center', maxWidth: 300 }}>Click a data service on the left to connect and run read-only inspections.</p>
            </div>
          )}

          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Service info header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 32 }}>{selected.icon}</span>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{selected.label}</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                    Pod: <code style={{ color: 'var(--text-secondary)' }}>{selected.pod_name}</code> · Namespace: <code style={{ color: 'var(--text-secondary)' }}>{selected.namespace}</code> · Port {selected.port}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', fontFamily: 'monospace' }}>{selected.image}</p>
                </div>
              </div>

              {/* Quick action buttons */}
              {selected.actions.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Quick Inspections</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {selected.actions.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => runInspect(a.id)}
                        disabled={busyInspect}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                      >
                        {busyInspect && pendingConfirm?.type === 'inspect' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={11} />}
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Confirmation banner */}
              {pendingConfirm && (
                <div style={{ background: 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.3)', borderRadius: 9, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
                      This will run a read-only command inside pod <strong>{selected.pod_name}</strong>. Confirm to proceed.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button type="button" onClick={() => setPendingConfirm(null)} style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (pendingConfirm.type === 'inspect') runInspect(pendingConfirm.action_id, true);
                        else runAiQuery(true);
                      }}
                      style={{ padding: '5px 14px', background: 'var(--warning)', border: 'none', borderRadius: 6, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >
                      Confirm & Run
                    </button>
                  </div>
                </div>
              )}

              {/* Inspect result */}
              {inspectResult && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    {inspectResult.exit_code === 0
                      ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                      : <XCircle size={14} style={{ color: 'var(--error)' }} />}
                    <span style={{ fontSize: 12, fontWeight: 600, color: inspectResult.exit_code === 0 ? 'var(--success)' : 'var(--error)' }}>
                      {inspectResult.label} · exit {inspectResult.exit_code}
                    </span>
                  </div>
                  <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', fontSize: 12, color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontFamily: 'JetBrains Mono, monospace', maxHeight: 340, overflowY: 'auto' }}>
                    {inspectResult.stdout || inspectResult.stderr || '(no output)'}
                  </pre>
                </div>
              )}

              {/* AI assistant */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>AI Assistant</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                  Ask in plain English — the AI will pick the right inspection command and explain what it found.
                </p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    type="text"
                    value={aiQuestion}
                    onChange={(e) => setAiQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runAiQuery()}
                    placeholder={`e.g. "how many records are there?" or "show me the collections"`}
                    style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button
                    type="button"
                    onClick={() => runAiQuery()}
                    disabled={!aiQuestion.trim() || busyAi}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', background: aiQuestion.trim() ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 8, color: aiQuestion.trim() ? '#fff' : 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: aiQuestion.trim() ? 'pointer' : 'not-allowed' }}
                  >
                    {busyAi ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
                    Ask
                  </button>
                </div>

                {aiResult && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.6 }}>{aiResult.explanation}</p>
                      {aiResult.suggestion && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>💡 {aiResult.suggestion}</p>}
                    </div>
                    {aiResult.result?.stdout != null && (
                      <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', fontSize: 12, color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontFamily: 'JetBrains Mono, monospace', maxHeight: 300, overflowY: 'auto' }}>
                        {aiResult.result.stdout || aiResult.result.stderr || '(no output)'}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
