import { useState } from 'react';
import { RefreshCw, Loader2, AlertCircle, Stethoscope, ChevronDown, ChevronRight } from 'lucide-react';

export interface PodInfo {
  name: string;
  status: string;
  restarts: number;
  ready: string;
}

interface PodSelectorProps {
  // Cluster
  clusters: { name: string }[];
  activeCluster: string | null;
  onClusterChange: (name: string) => void;
  // Namespace
  namespaces: string[];
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
  // Pods
  pods: PodInfo[];
  selectedPod: string | null;
  onPodSelect: (name: string) => void;
  loadingPods: boolean;
  onRefreshPods: () => void;
  // Mode toggle
  mode: 'pod' | 'paste';
  onModeChange: (m: 'pod' | 'paste') => void;
  // Paste-logs content
  logInput: string;
  onLogInputChange: (v: string) => void;
  // Analyze action
  onAnalyze: () => void;
  analyzing: boolean;
  // Error
  error: string | null;
  onClearError: () => void;
}

const CRITICAL = new Set([
  'CrashLoopBackOff', 'Error', 'OOMKilled', 'ErrImagePull',
  'ImagePullBackOff', 'CreateContainerConfigError', 'InvalidImageName',
]);

function podDot(status: string): string {
  if (status === 'Running') return 'var(--success)';
  if (CRITICAL.has(status)) return 'var(--error)';
  if (status === 'Pending' || status === 'ContainerCreating') return 'var(--warning)';
  return 'var(--text-muted)';
}

export function PodSelector({
  clusters, activeCluster, onClusterChange,
  namespaces, selectedNamespace, onNamespaceChange,
  pods, selectedPod, onPodSelect, loadingPods, onRefreshPods,
  mode, onModeChange,
  logInput, onLogInputChange,
  onAnalyze, analyzing,
  error, onClearError,
}: PodSelectorProps) {
  const [showCtx, setShowCtx] = useState(false);
  const [userContext, setUserContext] = useState('');

  const canAnalyze = !analyzing && (
    (mode === 'paste' && logInput.trim().length > 0) ||
    (mode === 'pod' && !!selectedPod)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Mode tabs */}
      <div style={{ padding: '10px 12px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {(['pod', 'paste'] as const).map(m => (
            <button key={m} type="button" onClick={() => onModeChange(m)}
              style={{ flex: 1, padding: '6px 0', background: mode === m ? 'var(--accent)' : 'transparent', border: 'none', color: mode === m ? '#fff' : 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {m === 'pod' ? '⎈ Live Cluster' : 'Paste Logs'}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ── Pod mode ── */}
        {mode === 'pod' && (
          <>
            {!activeCluster ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 4 }}>
                No cluster connected. Configure one in Settings.
              </p>
            ) : (
              <>
                {/* Cluster */}
                {clusters.length > 1 && (
                  <div>
                    <label style={labelStyle}>Cluster</label>
                    <select value={activeCluster || ''} onChange={e => onClusterChange(e.target.value)} style={selectStyle}>
                      {clusters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Namespace */}
                <div>
                  <label style={labelStyle}>Namespace</label>
                  <select value={selectedNamespace} onChange={e => onNamespaceChange(e.target.value)} style={selectStyle}>
                    {(namespaces.length ? namespaces : ['default']).map(ns => (
                      <option key={ns} value={ns}>{ns}</option>
                    ))}
                  </select>
                </div>

                {/* Pod list */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                    <label style={labelStyle}>Pod</label>
                    <button type="button" onClick={onRefreshPods}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, marginLeft: 'auto', display: 'flex' }}>
                      <RefreshCw size={10} style={{ animation: loadingPods ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                    {loadingPods && (
                      <div style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                        <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Loading pods…
                      </div>
                    )}
                    {!loadingPods && pods.length === 0 && (
                      <p style={{ padding: 10, fontSize: 11, color: 'var(--text-muted)' }}>No pods found.</p>
                    )}
                    {pods.map(pod => {
                      const isSel = selectedPod === pod.name;
                      return (
                        <div key={pod.name} onClick={() => onPodSelect(pod.name)}
                          style={{ padding: '7px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: isSel ? 'rgba(99,102,241,0.1)' : 'transparent', borderLeft: `2px solid ${isSel ? 'var(--accent)' : 'transparent'}`, transition: 'background 0.1s' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: podDot(pod.status), flexShrink: 0 }} />
                          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {pod.name}
                          </span>
                          {pod.restarts > 3 && (
                            <span style={{ fontSize: 9, background: 'rgba(248,81,73,0.15)', color: 'var(--error)', padding: '0 4px', borderRadius: 3, flexShrink: 0 }}>
                              {pod.restarts}↺
                            </span>
                          )}
                          <span style={{ fontSize: 9, color: podDot(pod.status), flexShrink: 0 }}>{pod.status}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Paste mode ── */}
        {mode === 'paste' && (
          <textarea
            value={logInput}
            onChange={e => onLogInputChange(e.target.value)}
            placeholder="Paste pod logs, kubectl describe output, or events…"
            rows={12}
            style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 11, padding: '9px 11px', resize: 'none', outline: 'none', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.55, boxSizing: 'border-box' }}
            onFocus={e => (e.target.style.borderColor = 'var(--border-focus)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
        )}

        {/* Optional context */}
        <div>
          <button type="button" onClick={() => setShowCtx(c => !c)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
            {showCtx ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Additional context (optional)
          </button>
          {showCtx && (
            <textarea value={userContext} onChange={e => setUserContext(e.target.value)}
              placeholder="e.g. just deployed v1.2, scaled from 2→5 replicas…"
              rows={3}
              style={{ width: '100%', marginTop: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 11, padding: '7px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }} />
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '7px 10px', background: 'rgba(248,81,73,0.1)', border: '1px solid var(--error)', borderRadius: 6, color: 'var(--error)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={11} />
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" onClick={onClearError} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
          </div>
        )}
      </div>

      {/* Analyze button — pinned to bottom */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button type="button" onClick={onAnalyze} disabled={!canAnalyze}
          style={{ width: '100%', padding: '9px', background: canAnalyze ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 700, cursor: canAnalyze ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: canAnalyze ? '0 0 14px var(--accent-glow)' : 'none', transition: 'all 0.2s' }}>
          {analyzing
            ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…</>
            : <><Stethoscope size={13} /> Analyze with AI</>}
        </button>
      </div>

    </div>
  );
}

// ── Shared style tokens ───────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4,
};

const selectStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)',
  borderRadius: 5, color: 'var(--text-primary)', fontSize: 12,
  padding: '5px 8px', outline: 'none',
};
