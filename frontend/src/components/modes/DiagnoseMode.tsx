import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle, Clock, FileText, GitBranch, ExternalLink,
  Zap, Copy, ChevronRight, Loader2, Shield, X, Plus, Trash2,
} from 'lucide-react';
import { useClusterStore } from '../../store/clusterStore';
import { useStream } from '../../hooks/useStream';
import { useNamespaces, usePods } from '../../hooks/useKubernetes';
import { useIsBuilder, useExperienceLevel } from '../../hooks/useTerminology';
import { translateErrorTitle } from '../../lib/errorMessages';
import { SEVERITY_LABELS } from '../../lib/terminology';
import type {
  DiagnosisCause, DiagnosisFixStep, DiagnosisPreventionItem,
  DiagnosisHistoryItem, CauseStatus,
} from '../../types';

import { DiagnoseLayout } from '../diagnose/DiagnoseLayout';
import { PodSelector } from '../diagnose/PodSelector';
import { CauseTree } from '../diagnose/CauseTree';
import { FixSteps } from '../diagnose/FixSteps';
import { SREChat, CommandConfirmModal } from '../diagnose/SREChat';
import { RCAModal } from '../diagnose/RCAModal';

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--error)', high: 'var(--warning)', medium: 'var(--warning)', low: 'var(--success)',
};
const SEV_BG: Record<string, string> = {
  critical: 'rgba(248,81,73,0.12)', high: 'rgba(249,115,22,0.12)',
  medium: 'rgba(240,180,41,0.12)', low: 'rgba(87,171,90,0.12)',
};

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// ── PRModal ───────────────────────────────────────────────────────────────────

interface PRFile { path: string; content: string }

function PRModal({ sessionId, fixSteps, onClose, onCreated }: {
  sessionId: string;
  fixSteps: { title: string; command: string }[];
  onClose: () => void;
  onCreated: (pr: Record<string, unknown>) => void;
}) {
  const [repo, setRepo] = useState('');
  const [base, setBase] = useState('main');
  const [files, setFiles] = useState<PRFile[]>([{ path: '', content: '' }]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const valid = repo.includes('/') && files.every(f => f.path.trim() && f.content.trim());

  const handleCreate = async () => {
    if (!valid || creating) return;
    setCreating(true); setErr('');
    try {
      const res = await fetch(`/api/diagnose/${sessionId}/create-pr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_full_name: repo.trim(), base_branch: base.trim() || 'main', files: files.filter(f => f.path.trim()) }),
      });
      const d = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(String(d.detail || 'PR creation failed'));
      onCreated(d); onClose();
    } catch (e) { setErr(String(e)); }
    finally { setCreating(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, width: 540, maxHeight: '85vh', overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitBranch size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Create Pull Request</span>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {fixSteps.length > 0 && (
          <div style={{ background: 'var(--bg-base)', borderRadius: 6, padding: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Fix steps from diagnosis:</p>
            {fixSteps.slice(0, 3).map((s, i) => <p key={i} style={{ marginBottom: 2 }}>• {s.title}</p>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label style={labelSm}>Repository (owner/repo)</label>
            <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="acme/my-app" style={inputSm} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelSm}>Base Branch</label>
            <input value={base} onChange={e => setBase(e.target.value)} placeholder="main" style={inputSm} />
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={labelSm}>Files to Change</span>
            <button type="button" onClick={() => setFiles(p => [...p, { path: '', content: '' }])}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: '1px 6px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
              <Plus size={9} /> Add file
            </button>
          </div>
          {files.map((f, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                <input value={f.path} onChange={e => setFiles(p => p.map((x, j) => j === i ? { ...x, path: e.target.value } : x))}
                  placeholder="k8s/deployment.yaml"
                  style={{ flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 11, padding: '4px 7px', outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
                {files.length > 1 && (
                  <button type="button" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <textarea value={f.content} onChange={e => setFiles(p => p.map((x, j) => j === i ? { ...x, content: e.target.value } : x))}
                placeholder="Paste file content here…" rows={4}
                style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 11, padding: '5px 8px', resize: 'vertical', outline: 'none', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        {err && <p style={{ fontSize: 11, color: 'var(--error)', padding: '6px 10px', background: 'rgba(248,81,73,0.1)', borderRadius: 5 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button type="button" onClick={onClose} style={{ padding: '7px 14px', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={handleCreate} disabled={!valid || creating}
            style={{ padding: '7px 14px', background: valid && !creating ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 6, color: valid && !creating ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: valid && !creating ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
            {creating ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</> : <><GitBranch size={12} /> Open PR</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PRStatusCard ──────────────────────────────────────────────────────────────

function PRStatusCard({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const iRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const r = await fetch(`/api/diagnose/${sessionId}/pr-status`);
      const d = await r.json() as Record<string, unknown>;
      setStatus(d);
      const st = d.pr_state as string;
      if (st === 'merged' || st === 'closed') { if (iRef.current) clearInterval(iRef.current); }
    } catch { /* ignore */ }
  }, [sessionId]);

  useEffect(() => {
    fetch_();
    iRef.current = setInterval(fetch_, 30000);
    const t = setTimeout(() => { if (iRef.current) clearInterval(iRef.current); }, 86400000);
    return () => { if (iRef.current) clearInterval(iRef.current); clearTimeout(t); };
  }, [fetch_]);

  if (!status?.has_pr) return null;

  const prState = status.pr_state as string;
  const ciStatus = status.ci_status as string;
  const stateColor = prState === 'merged' ? 'var(--accent)' : prState === 'closed' ? 'var(--error)' : 'var(--success)';

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <GitBranch size={12} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>PR #{String(status.pr_number)}</span>
        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 100, background: `${stateColor}20`, border: `1px solid ${stateColor}`, color: stateColor, fontWeight: 700 }}>
          {prState === 'merged' ? 'Merged' : prState === 'closed' ? 'Closed' : 'Open'}
        </span>
        {ciStatus !== 'unknown' && (
          <span style={{ fontSize: 10, color: ciStatus === 'success' ? 'var(--success)' : ciStatus === 'failure' ? 'var(--error)' : 'var(--warning)', fontWeight: 600 }}>
            {ciStatus === 'success' ? '✓ CI passing' : ciStatus === 'failure' ? '✗ CI failing' : '⊙ CI pending'}
          </span>
        )}
        <a href={status.pr_url as string} target="_blank" rel="noreferrer"
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
          View on GitHub <ExternalLink size={9} />
        </a>
      </div>
      {Boolean(status.pr_branch) && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>{String(status.pr_branch)}</p>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const labelSm: React.CSSProperties = { fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 };
const inputSm: React.CSSProperties = { display: 'block', width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '6px 8px', outline: 'none', boxSizing: 'border-box' };

export function DiagnoseMode() {
  const { clusters, activeCluster, activeNamespace, setActiveCluster, setActiveNamespace } = useClusterStore();
  const isBuilder = useIsBuilder();
  const expLevel = useExperienceLevel();
  const sevLabel = (sev: string) => SEVERITY_LABELS[sev.toLowerCase()]?.[expLevel] ?? sev.toUpperCase();

  // Input
  const [mode, setMode] = useState<'pod' | 'paste'>('pod');
  const [logInput, setLogInput] = useState('');
  const [selectedPod, setSelectedPod] = useState('');
  const [isLoadingPodLogs, setIsLoadingPodLogs] = useState(false);

  // Analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isResolved, setIsResolved] = useState(false);
  const [headerData, setHeaderData] = useState<{
    severity: string; what_is_happening: string;
    pod_name?: string | null; namespace?: string | null; cluster?: string | null;
  } | null>(null);
  const [causes, setCauses] = useState<DiagnosisCause[]>([]);
  const [causeStatuses, setCauseStatuses] = useState<Record<string, CauseStatus>>({});
  const [analysisData, setAnalysisData] = useState<{
    recommended_order: string; fix_steps: DiagnosisFixStep[]; prevention: DiagnosisPreventionItem[];
  } | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pixieUsed, setPixieUsed] = useState(false);

  // Command execution
  const [cmdToConfirm, setCmdToConfirm] = useState<string | null>(null);
  const [cmdResult, setCmdResult] = useState<{ output: string; error?: string } | null>(null);
  const [runningCmd, setRunningCmd] = useState(false);

  // Modals
  const [showRCA, setShowRCA] = useState(false);
  const [showPRModal, setShowPRModal] = useState(false);
  const [prCreated, setPrCreated] = useState(false);

  // History
  const [history, setHistory] = useState<DiagnosisHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // K8s data
  const nsData = useNamespaces(activeCluster);
  const podsData = usePods(activeCluster, activeNamespace || 'default');
  const namespaces = nsData.data?.namespaces ?? [];
  const pods = podsData.data?.pods ?? [];

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/diagnose/history');
      const d = await r.json() as { sessions: DiagnosisHistoryItem[] };
      setHistory(d.sessions || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ── Stream callbacks ────────────────────────────────────────────────────────

  const onDiagEvent = useCallback((event: Record<string, unknown>) => {
    const t = event.type as string;
    if (t === 'analysis_header') {
      setHeaderData({
        severity: event.severity as string, what_is_happening: event.what_is_happening as string,
        pod_name: event.pod_name as string | null, namespace: event.namespace as string | null, cluster: event.cluster as string | null,
      });
    } else if (t === 'cause') {
      setCauses(prev => [...prev, event.cause as DiagnosisCause]);
    } else if (t === 'analysis') {
      setAnalysisData({ recommended_order: event.recommended_order as string, fix_steps: event.fix_steps as DiagnosisFixStep[], prevention: event.prevention as DiagnosisPreventionItem[] });
    } else if (t === 'pixie_enriched') {
      setPixieUsed(true);
    }
  }, []);

  const onDiagDone = useCallback((meta: Record<string, unknown>) => {
    setAnalyzing(false);
    if (meta.session_id) { setSessionId(meta.session_id as string); fetchHistory(); }
  }, [fetchHistory]);

  const onDiagError = useCallback((e: string) => { setAnalyzing(false); setError(e); }, []);

  const { start: startAnalyze } = useStream('/api/diagnose', { onEvent: onDiagEvent, onDone: onDiagDone, onError: onDiagError });

  // ── Analysis start ──────────────────────────────────────────────────────────

  const startAnalysis = useCallback(async (logs: string, podName?: string) => {
    if (analyzing) return;
    setAnalyzing(true); setError(null); setHeaderData(null); setCauses([]); setAnalysisData(null);
    setCompletedSteps(new Set()); setCauseStatuses({}); setSessionId(null);
    setIsResolved(false); setPrCreated(false); setPixieUsed(false); setCmdResult(null);
    await startAnalyze({ logs, pod_name: podName || undefined, namespace: activeNamespace || undefined, cluster: activeCluster || undefined });
  }, [analyzing, startAnalyze, activeNamespace, activeCluster]);

  const handleAnalyze = useCallback(async () => {
    if (mode === 'paste') { await startAnalysis(logInput); return; }
    if (!selectedPod) { setError('Select a pod first'); return; }
    setIsLoadingPodLogs(true);
    try {
      const qs = new URLSearchParams({ pod: selectedPod, namespace: activeNamespace || 'default', lines: '300' });
      if (activeCluster) qs.set('cluster', activeCluster);
      const res = await fetch(`/api/k8s/pod/logs?${qs}`);
      const d = await res.json() as { logs?: string; error?: string };
      if (d.logs) { await startAnalysis(d.logs, selectedPod); }
      else { setError(d.error || 'Could not fetch pod logs'); }
    } catch (e) { setError(String(e)); }
    finally { setIsLoadingPodLogs(false); }
  }, [mode, logInput, selectedPod, activeNamespace, activeCluster, startAnalysis]);

  // ── Command execution ───────────────────────────────────────────────────────

  const handleRunCommand = useCallback((cmd: string) => { setCmdToConfirm(cmd); }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    const args = cmd.trim().split(/\s+/);
    if (args[0] === 'kubectl') args.shift();
    setRunningCmd(true); setCmdResult(null);
    try {
      const res = await fetch('/api/k8s/kubectl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: args, confirmed: true, cluster: activeCluster }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let out = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try { const d = JSON.parse(line.slice(6)) as Record<string, unknown>; if (d.line) out += String(d.line) + '\n'; } catch { /* */ }
        }
      }
      setCmdResult({ output: out || '(no output)' });
    } catch (e) { setCmdResult({ output: '', error: String(e) }); }
    finally { setRunningCmd(false); }
  }, [activeCluster]);

  // ── Resolve ────────────────────────────────────────────────────────────────

  const handleResolve = useCallback(async () => {
    if (!sessionId || isResolved) return;
    try {
      const res = await fetch(`/api/diagnose/${sessionId}/resolve`, { method: 'POST' });
      if (res.ok || res.status === 404) { setIsResolved(true); fetchHistory(); }
    } catch { setIsResolved(true); }
  }, [sessionId, isResolved, fetchHistory]);

  const hasOutput = !!(headerData || causes.length > 0);

  // ── Left panel ──────────────────────────────────────────────────────────────

  const leftPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PodSelector
        clusters={clusters}
        activeCluster={activeCluster}
        onClusterChange={setActiveCluster}
        namespaces={namespaces}
        selectedNamespace={activeNamespace || 'default'}
        onNamespaceChange={setActiveNamespace}
        pods={pods}
        selectedPod={selectedPod}
        onPodSelect={setSelectedPod}
        loadingPods={podsData.isFetching}
        onRefreshPods={() => podsData.refetch()}
        mode={mode}
        onModeChange={setMode}
        logInput={logInput}
        onLogInputChange={setLogInput}
        onAnalyze={handleAnalyze}
        analyzing={analyzing || isLoadingPodLogs}
        error={error}
        onClearError={() => setError(null)}
      />

      {/* History */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', flexShrink: 0 }}>
        <button type="button" onClick={() => setShowHistory(h => !h)}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, padding: 0, width: '100%' }}>
          <Clock size={10} />
          <span>Recent diagnoses ({history.length})</span>
          <ChevronRight size={10} style={{ marginLeft: 'auto', transform: showHistory ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
        {showHistory && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
            {history.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No recent diagnoses.</p>}
            {history.map(h => (
              <div key={h.id} onClick={async () => {
                try {
                  const r = await fetch(`/api/diagnose/${h.id}`);
                  const s = await r.json() as Record<string, unknown>;
                  setHeaderData({ severity: s.severity as string, what_is_happening: s.what_is_happening as string, pod_name: s.pod_name as string, namespace: s.namespace as string, cluster: s.cluster as string });
                  setCauses((s.causes as DiagnosisCause[]) || []);
                  setAnalysisData({ recommended_order: s.recommended_order as string, fix_steps: (s.fix_steps as DiagnosisFixStep[]) || [], prevention: (s.prevention as DiagnosisPreventionItem[]) || [] });
                  setCauseStatuses((s.cause_statuses as Record<string, CauseStatus>) || {});
                  setSessionId(h.id);
                } catch { /* ignore */ }
              }}
                style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: SEV_COLOR[h.severity] || 'var(--text-muted)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.issue_title}</p>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)' }}>{h.pod_name || 'unknown'} · {timeAgo(h.created_at)}</p>
                </div>
                {h.resolved && <span style={{ fontSize: 9, background: 'rgba(87,171,90,0.15)', color: 'var(--success)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>✓</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── Center panel ────────────────────────────────────────────────────────────

  const centerPanel = (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Empty state */}
      {!hasOutput && !analyzing && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-muted)' }}>
          <Shield size={44} style={{ opacity: 0.15 }} />
          <p style={{ fontSize: 14 }}>Select a pod or paste logs to start diagnosis</p>
          <p style={{ fontSize: 12, opacity: 0.65, textAlign: 'center', maxWidth: 360 }}>AI identifies root causes, ranks them by confidence, and gives you exact fix steps with one-click execution</p>
        </div>
      )}

      {/* Skeleton while streaming starts */}
      {analyzing && !hasOutput && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
          {[280, 180, 240, 160, 200, 120].map((w, i) => (
            <div key={i} className="skeleton" style={{ height: 16, width: w, maxWidth: '100%' }} />
          ))}
        </div>
      )}

      {hasOutput && (
        <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Incident header */}
          {headerData && (
            <div style={{ background: SEV_BG[headerData.severity] || 'var(--bg-surface)', border: `1px solid ${SEV_COLOR[headerData.severity] || 'var(--border)'}44`, borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ padding: '3px 10px', borderRadius: 100, background: `${SEV_COLOR[headerData.severity]}22`, border: `1px solid ${SEV_COLOR[headerData.severity]}`, color: SEV_COLOR[headerData.severity], fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {sevLabel(headerData.severity)}
                </span>
                {isBuilder && (() => {
                  const et = headerData.what_is_happening?.match(/\b(ImagePullBackOff|CrashLoopBackOff|OOMKilled|Pending|CreateContainerConfigError)\b/)?.[0];
                  const plain = et ? translateErrorTitle(et, 'builder') : null;
                  return plain && plain !== et ? <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{plain}</span> : null;
                })()}
                {analyzing && <span style={{ fontSize: 11, color: 'var(--accent)' }}>● Analyzing…</span>}
                {pixieUsed && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 100, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Zap size={9} /> Enhanced with eBPF telemetry
                  </span>
                )}
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                {headerData.pod_name && <span>{isBuilder ? 'App' : 'Pod'}: <strong style={{ color: 'var(--text-primary)' }}>{headerData.pod_name}</strong></span>}
                {headerData.namespace && <span>{isBuilder ? 'Section' : 'Namespace'}: <strong style={{ color: 'var(--text-primary)' }}>{headerData.namespace}</strong></span>}
                {headerData.cluster && <span>Cluster: <strong style={{ color: 'var(--text-primary)' }}>{headerData.cluster}</strong></span>}
              </div>

              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={handleResolve} disabled={isResolved}
                  style={{ padding: '5px 12px', background: isResolved ? 'rgba(87,171,90,0.15)' : 'var(--success)', border: isResolved ? '1px solid var(--success)' : 'none', borderRadius: 5, color: isResolved ? 'var(--success)' : '#fff', fontSize: 11, fontWeight: 600, cursor: isResolved ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CheckCircle size={11} /> {isResolved ? '✓ Resolved' : 'Mark Resolved'}
                </button>
                <button type="button" onClick={() => setShowRCA(true)} disabled={!sessionId}
                  style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: sessionId ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FileText size={11} /> Generate RCA
                </button>
                <button type="button" onClick={() => setShowPRModal(true)} disabled={!sessionId || prCreated}
                  style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: prCreated ? 'var(--success)' : 'var(--text-secondary)', fontSize: 11, cursor: sessionId && !prCreated ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <GitBranch size={11} /> {prCreated ? '✓ PR Created' : 'Create PR'}
                </button>
                <button type="button" onClick={() => navigator.clipboard.writeText(`${headerData.severity.toUpperCase()} | ${headerData.pod_name} | ${headerData.namespace}`)}
                  style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Copy size={11} /> Copy Summary
                </button>
              </div>
            </div>
          )}

          {/* PR status */}
          {sessionId && prCreated && <PRStatusCard sessionId={sessionId} />}

          {/* Command result banner */}
          {cmdResult && (
            <div style={{ background: 'var(--bg-surface)', border: `1px solid ${cmdResult.error ? 'var(--error)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {runningCmd ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> : <CheckCircle size={11} style={{ color: cmdResult.error ? 'var(--error)' : 'var(--success)' }} />}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{runningCmd ? 'Running command…' : cmdResult.error ? 'Command failed' : 'Command output'}</span>
                <button type="button" onClick={() => setCmdResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><X size={12} /></button>
              </div>
              <pre style={{ margin: 0, padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: cmdResult.error ? 'var(--error)' : '#7ee787', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                {cmdResult.error || cmdResult.output}
              </pre>
            </div>
          )}

          {/* What's happening */}
          {headerData?.what_is_happening && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>What's Happening</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75 }}>{headerData.what_is_happening}</p>
            </div>
          )}

          {/* Cause tree */}
          <CauseTree
            causes={causes}
            causeStatuses={causeStatuses}
            onStatusChange={(id, s) => setCauseStatuses(prev => ({ ...prev, [String(id)]: s }))}
            onRunCommand={handleRunCommand}
            sessionId={sessionId}
            analyzing={analyzing}
          />

          {/* Fix steps + prevention */}
          <FixSteps
            recommendedOrder={analysisData?.recommended_order ?? null}
            steps={analysisData?.fix_steps ?? []}
            prevention={analysisData?.prevention ?? []}
            completedSteps={completedSteps}
            onMarkDone={n => setCompletedSteps(prev => new Set([...prev, n]))}
            onRunCommand={handleRunCommand}
          />
        </div>
      )}
    </div>
  );

  // ── Right panel (SRE chat) ──────────────────────────────────────────────────

  const rightPanel = (
    <SREChat
      sessionId={sessionId}
      headerData={headerData}
      causes={causes}
      causeStatuses={causeStatuses}
    />
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <DiagnoseLayout left={leftPanel} center={centerPanel} right={rightPanel} />

      {/* Global command confirmation (from CauseTree / FixSteps run buttons) */}
      {cmdToConfirm && (
        <CommandConfirmModal
          command={cmdToConfirm}
          onConfirm={() => { const c = cmdToConfirm; setCmdToConfirm(null); executeCommand(c); }}
          onCancel={() => setCmdToConfirm(null)}
        />
      )}

      {showRCA && sessionId && <RCAModal sessionId={sessionId} onClose={() => setShowRCA(false)} />}

      {showPRModal && sessionId && (
        <PRModal
          sessionId={sessionId}
          fixSteps={(analysisData?.fix_steps ?? []).map(s => ({ title: s.title, command: s.command }))}
          onClose={() => setShowPRModal(false)}
          onCreated={() => { setPrCreated(true); setShowPRModal(false); }}
        />
      )}
    </>
  );
}
