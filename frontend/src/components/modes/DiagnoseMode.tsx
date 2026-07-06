import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  CheckCircle, RefreshCw, Loader2, Copy, Check,
  ChevronDown, FileText, GitBranch, ExternalLink, Zap, X,
  Terminal, Search, Plus, Trash2,
} from 'lucide-react';
import { useClusterStore } from '../../store/clusterStore';
import { useStream } from '../../hooks/useStream';
import { useNamespaces } from '../../hooks/useKubernetes';
import { CauseTree } from '../diagnose/CauseTree';
import { FixSteps } from '../diagnose/FixSteps';
import { SREChat, CommandConfirmModal } from '../diagnose/SREChat';
import { RCAModal } from '../diagnose/RCAModal';
import type {
  DiagnosisCause, DiagnosisFixStep, DiagnosisPreventionItem, CauseStatus,
} from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'errors' | 'deployments' | 'describe' | 'logs' | 'resolve';

interface PodInfo { name: string; status: string; restarts: number; ready: string }
interface DeployInfo { name: string; ready: string; age: string; kind: string }

interface Activity {
  id: string;
  type: 'info' | 'run' | 'ok' | 'err' | 'ai';
  text: string;
  detail?: string;
}

// ── Constants / helpers ───────────────────────────────────────────────────────

const CRITICAL_STATUSES = new Set([
  'CrashLoopBackOff', 'Error', 'OOMKilled', 'ErrImagePull',
  'ImagePullBackOff', 'CreateContainerConfigError', 'InvalidImageName',
]);

function depColor(ready: string) {
  const [r, t] = ready.split('/').map(Number);
  if (!t) return 'var(--text-muted)';
  if (r === 0) return 'var(--error)';
  if (r < t) return 'var(--warning)';
  return 'var(--success)';
}

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--error)', high: 'var(--warning)', medium: 'var(--warning)', low: 'var(--success)',
};
const SEV_BG: Record<string, string> = {
  critical: 'rgba(248,81,73,0.12)', high: 'rgba(249,115,22,0.12)',
  medium: 'rgba(240,180,41,0.12)', low: 'rgba(87,171,90,0.12)',
};

function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 1500); }}
      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
      {c ? <Check size={9} /> : <Copy size={9} />}{c ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DiagnoseMode() {
  const { clusters, activeCluster, setActiveCluster } = useClusterStore();
  const location = useLocation();
  const navState = (location.state ?? {}) as { namespace?: string; resourceName?: string; resourceType?: string };
  const [activeTab, setActiveTab] = useState<Tab>('errors');

  // Shared selectors — pre-fill namespace if navigated from Monitor Issues
  const [selectedNs, setSelectedNs] = useState(navState.namespace ?? 'default');

  // Resource data
  const [allPods, setAllPods] = useState<PodInfo[]>([]);
  const [allDeploys, setAllDeploys] = useState<DeployInfo[]>([]);
  const [loadingRes, setLoadingRes] = useState(false);

  // Describe tab
  const [describeKind, setDescribeKind] = useState<'pod' | 'deployment'>('pod');
  const [describeTarget, setDescribeTarget] = useState('');
  const [describeOut, setDescribeOut] = useState('');
  const [loadingDescribe, setLoadingDescribe] = useState(false);
  const [describeSearch, setDescribeSearch] = useState('');

  // Logs tab
  const [logPod, setLogPod] = useState('');
  const [logLines, setLogLines] = useState(200);
  const [logs, setLogs] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logSearch, setLogSearch] = useState('');

  // Deployments tab
  const [deploySearch, setDeploySearch] = useState('');
  const [selectedDeploy, setSelectedDeploy] = useState('');
  const [deployOut, setDeployOut] = useState('');
  const [loadingDeployOut, setLoadingDeployOut] = useState(false);

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isResolved, setIsResolved] = useState(false);
  const [analyzeTarget, setAnalyzeTarget] = useState('');
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
  const [pixieUsed, setPixieUsed] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);

  // PR / RCA
  const [showRCA, setShowRCA] = useState(false);
  const [showPRModal, setShowPRModal] = useState(false);
  const [prCreated, setPrCreated] = useState(false);
  const [prData, setPrData] = useState<Record<string, unknown> | null>(null);

  // Command execution
  const [cmdToConfirm, setCmdToConfirm] = useState<string | null>(null);
  const [runningCmd, setRunningCmd] = useState(false);
  const activityEndRef = useRef<HTMLDivElement>(null);

  const nsData = useNamespaces(activeCluster);
  const namespaces = nsData.data?.namespaces ?? ['default'];

  const addActivity = useCallback((a: Omit<Activity, 'id'>) => {
    setActivities(prev => [...prev.slice(-49), { ...a, id: crypto.randomUUID() }]);
    setTimeout(() => activityEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // ── Fetch resources ────────────────────────────────────────────────────────

  const fetchResources = useCallback(async () => {
    setLoadingRes(true);
    try {
      const qs = new URLSearchParams({ namespace: selectedNs });
      if (activeCluster) qs.set('cluster', activeCluster);
      const r = await fetch(`/api/k8s/resources?${qs}`);
      const d = await r.json() as Record<string, unknown>;
      setAllPods((d.pods as PodInfo[]) || []);
      setAllDeploys([
        ...((d.deployments as DeployInfo[]) || []),
        ...((d.statefulsets as DeployInfo[]) || []),
      ]);
    } catch { /* ignore */ }
    finally { setLoadingRes(false); }
  }, [selectedNs, activeCluster]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  // ── Fetch describe ─────────────────────────────────────────────────────────

  const fetchDescribe = useCallback(async (kind: string, name: string) => {
    if (!name) return;
    setLoadingDescribe(true); setDescribeOut('');
    try {
      const qs = new URLSearchParams({ kind, name, namespace: selectedNs });
      if (activeCluster) qs.set('cluster', activeCluster);
      const r = await fetch(`/api/k8s/describe?${qs}`);
      const d = await r.json() as { output?: string };
      setDescribeOut(d.output || '');
    } catch { /* ignore */ }
    finally { setLoadingDescribe(false); }
  }, [selectedNs, activeCluster]);

  // ── Fetch logs ────────────────────────────────────────────────────────────

  const fetchLogs = useCallback(async (pod: string, lines: number) => {
    if (!pod) return;
    setLoadingLogs(true); setLogs('');
    try {
      const qs = new URLSearchParams({ pod, namespace: selectedNs, lines: String(lines) });
      if (activeCluster) qs.set('cluster', activeCluster);
      const r = await fetch(`/api/k8s/pod/logs?${qs}`);
      const d = await r.json() as { logs?: string; error?: string };
      setLogs(d.logs || d.error || '');
    } catch { /* ignore */ }
    finally { setLoadingLogs(false); }
  }, [selectedNs, activeCluster]);

  // ── Fetch deployment describe ──────────────────────────────────────────────

  const fetchDeployOut = useCallback(async (name: string) => {
    if (!name) return;
    setLoadingDeployOut(true); setDeployOut('');
    try {
      const qs = new URLSearchParams({ kind: 'deployment', name, namespace: selectedNs });
      if (activeCluster) qs.set('cluster', activeCluster);
      const r = await fetch(`/api/k8s/describe?${qs}`);
      const d = await r.json() as { output?: string };
      setDeployOut(d.output || '');
    } catch { /* ignore */ }
    finally { setLoadingDeployOut(false); }
  }, [selectedNs, activeCluster]);

  // ── Analysis stream ────────────────────────────────────────────────────────

  const onDiagEvent = useCallback((ev: Record<string, unknown>) => {
    const t = ev.type as string;
    if (t === 'analysis_header') {
      setHeaderData({ severity: ev.severity as string, what_is_happening: ev.what_is_happening as string, pod_name: ev.pod_name as string, namespace: ev.namespace as string, cluster: ev.cluster as string });
      addActivity({ type: 'ai', text: `Severity: ${(ev.severity as string).toUpperCase()} — ${ev.what_is_happening as string}` });
    } else if (t === 'cause') {
      const c = ev.cause as DiagnosisCause;
      setCauses(prev => [...prev, c]);
      addActivity({ type: 'ai', text: `Cause ${c.id}: ${c.title}`, detail: `${c.confidence_percent}% confidence` });
    } else if (t === 'analysis') {
      setAnalysisData({ recommended_order: ev.recommended_order as string, fix_steps: ev.fix_steps as DiagnosisFixStep[], prevention: ev.prevention as DiagnosisPreventionItem[] });
    } else if (t === 'pixie_enriched') {
      setPixieUsed(true);
      addActivity({ type: 'info', text: 'Enhanced with eBPF telemetry (Pixie)' });
    }
  }, [addActivity]);

  const onDiagDone = useCallback((meta: Record<string, unknown>) => {
    setAnalyzing(false);
    if (meta.session_id) setSessionId(meta.session_id as string);
    addActivity({ type: 'ok', text: 'Analysis complete' });
  }, [addActivity]);

  const onDiagError = useCallback((e: string) => {
    setAnalyzing(false);
    addActivity({ type: 'err', text: `Analysis failed: ${e}` });
  }, [addActivity]);

  const { start: startAnalyze } = useStream('/api/diagnose', { onEvent: onDiagEvent, onDone: onDiagDone, onError: onDiagError });

  // ── Start analysis ─────────────────────────────────────────────────────────

  const startAnalysis = useCallback(async (podName: string) => {
    if (analyzing) return;
    setAnalyzing(true); setAnalyzeTarget(podName);
    setHeaderData(null); setCauses([]); setAnalysisData(null);
    setCompletedSteps(new Set()); setCauseStatuses({}); setSessionId(null);
    setIsResolved(false); setPrCreated(false); setPrData(null); setPixieUsed(false);
    setActivities([{ id: crypto.randomUUID(), type: 'info', text: `Fetching logs for ${podName}…` }]);
    setActiveTab('resolve');

    try {
      const qs = new URLSearchParams({ pod: podName, namespace: selectedNs, lines: '300' });
      if (activeCluster) qs.set('cluster', activeCluster);
      const res = await fetch(`/api/k8s/pod/logs?${qs}`);
      const d = await res.json() as { logs?: string; error?: string };
      if (!d.logs) { addActivity({ type: 'err', text: d.error || 'Could not fetch logs' }); setAnalyzing(false); return; }
      addActivity({ type: 'ok', text: `Fetched ${d.logs.split('\n').length} log lines` });
      addActivity({ type: 'ai', text: 'Sending to AI for analysis…' });
      await startAnalyze({ logs: d.logs, pod_name: podName, namespace: selectedNs, cluster: activeCluster || undefined });
    } catch (e) {
      addActivity({ type: 'err', text: String(e) });
      setAnalyzing(false);
    }
  }, [analyzing, selectedNs, activeCluster, startAnalyze, addActivity]);

  // ── Execute command ────────────────────────────────────────────────────────

  const handleRunCommand = useCallback((cmd: string) => { setCmdToConfirm(cmd); }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    const args = cmd.trim().split(/\s+/);
    if (args[0] === 'kubectl') args.shift();
    setRunningCmd(true);
    addActivity({ type: 'run', text: `Running: ${cmd}` });
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
      addActivity({ type: 'ok', text: 'Done', detail: out.trim().slice(0, 200) });
    } catch (e) { addActivity({ type: 'err', text: String(e) }); }
    finally { setRunningCmd(false); }
  }, [activeCluster, addActivity]);

  const handleResolve = useCallback(async () => {
    if (!sessionId || isResolved) return;
    await fetch(`/api/diagnose/${sessionId}/resolve`, { method: 'POST' }).catch(() => null);
    setIsResolved(true);
    addActivity({ type: 'ok', text: 'Incident marked as resolved' });
  }, [sessionId, isResolved, addActivity]);

  // ── Issue detection ────────────────────────────────────────────────────────

  const criticalPods = allPods.filter(p => CRITICAL_STATUSES.has(p.status));
  const warningPods = allPods.filter(p => !CRITICAL_STATUSES.has(p.status) && (p.status === 'Pending' || p.restarts > 5));
  const healthyPods = allPods.filter(p => p.status === 'Running' && p.restarts <= 5);
  const [showHealthy, setShowHealthy] = useState(false);

  const tabLabel = (t: Tab) => {
    if (t === 'errors') {
      const n = criticalPods.length + warningPods.length;
      return <>Pod Errors{n > 0 && <span style={{ marginLeft: 5, background: criticalPods.length ? 'var(--error)' : 'var(--warning)', color: '#fff', borderRadius: 100, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{n}</span>}</>;
    }
    return { deployments: 'Deployments', describe: 'Describe', logs: 'Logs', resolve: 'Resolve' }[t];
  };

  // ── Filtered describe output ───────────────────────────────────────────────

  const filteredDescribe = describeSearch
    ? describeOut.split('\n').filter(l => l.toLowerCase().includes(describeSearch.toLowerCase())).join('\n')
    : describeOut;

  const filteredLogs = logSearch
    ? logs.split('\n').filter(l => l.toLowerCase().includes(logSearch.toLowerCase())).join('\n')
    : logs;

  const filteredDeploys = deploySearch
    ? allDeploys.filter(d => d.name.toLowerCase().includes(deploySearch.toLowerCase()))
    : allDeploys;

  // ── Tab: Pod Errors ────────────────────────────────────────────────────────

  const errorsTab = (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          {criticalPods.length} critical · {warningPods.length} warning · {healthyPods.length} healthy
        </span>
        <button type="button" onClick={fetchResources}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <RefreshCw size={11} style={{ animation: loadingRes ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      {/* Critical */}
      {criticalPods.map(pod => (
        <IssueRow key={pod.name} pod={pod} onAnalyze={() => startAnalysis(pod.name)}
          onLogs={() => { setLogPod(pod.name); fetchLogs(pod.name, logLines); setActiveTab('logs'); }}
          onDescribe={() => { setDescribeKind('pod'); setDescribeTarget(pod.name); fetchDescribe('pod', pod.name); setActiveTab('describe'); }} />
      ))}

      {/* Warning */}
      {warningPods.map(pod => (
        <IssueRow key={pod.name} pod={pod} onAnalyze={() => startAnalysis(pod.name)}
          onLogs={() => { setLogPod(pod.name); fetchLogs(pod.name, logLines); setActiveTab('logs'); }}
          onDescribe={() => { setDescribeKind('pod'); setDescribeTarget(pod.name); fetchDescribe('pod', pod.name); setActiveTab('describe'); }} />
      ))}

      {criticalPods.length === 0 && warningPods.length === 0 && !loadingRes && (
        <div style={{ padding: '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--success)' }}>
          <CheckCircle size={36} style={{ opacity: 0.6 }} />
          <p style={{ fontSize: 14, fontWeight: 600 }}>All pods healthy in {selectedNs}</p>
        </div>
      )}

      {loadingRes && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: '20px 0' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading pods…
        </div>
      )}

      {/* Healthy pods (collapsed) */}
      {healthyPods.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowHealthy(h => !h)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}>
            <ChevronDown size={12} style={{ transform: showHealthy ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
            Healthy pods ({healthyPods.length})
          </button>
          {showHealthy && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {healthyPods.map(pod => (
                <div key={pod.name} style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
                  <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pod.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{pod.ready}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Tab: Deployments ───────────────────────────────────────────────────────

  const deploymentsTab = (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* List */}
      <div style={{ width: 300, minWidth: 300, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px' }}>
            <Search size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input value={deploySearch} onChange={e => setDeploySearch(e.target.value)} placeholder="Search deployments…"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 12 }} />
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filteredDeploys.length === 0 && !loadingRes && (
            <p style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No deployments found.</p>
          )}
          {filteredDeploys.map(dep => {
            const isSel = selectedDeploy === dep.name;
            return (
              <div key={dep.name} onClick={() => { setSelectedDeploy(dep.name); fetchDeployOut(dep.name); }}
                style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: isSel ? 'rgba(99,102,241,0.1)' : 'transparent', borderLeft: `3px solid ${isSel ? 'var(--accent)' : 'transparent'}` }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: depColor(dep.ready), flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dep.name}</p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dep.kind || 'Deployment'} · {dep.ready} ready · {dep.age}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Detail */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedDeploy ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--text-muted)' }}>
            <FileText size={36} style={{ opacity: 0.15 }} />
            <p style={{ fontSize: 13 }}>Select a deployment to inspect</p>
          </div>
        ) : (
          <>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{selectedDeploy}</span>
              {loadingDeployOut && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <CopyBtn text={deployOut} />
                <button type="button" onClick={() => { startAnalysis(allPods.find(p => p.name.startsWith(selectedDeploy + '-'))?.name || selectedDeploy); }}
                  style={{ padding: '3px 10px', background: 'var(--accent)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={10} /> Analyze
                </button>
              </div>
            </div>
            <pre style={{ flex: 1, overflow: 'auto', margin: 0, padding: '14px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {deployOut || (loadingDeployOut ? 'Loading…' : '')}
            </pre>
          </>
        )}
      </div>
    </div>
  );

  // ── Tab: Describe ──────────────────────────────────────────────────────────

  const describeTab = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
          {(['pod', 'deployment'] as const).map(k => (
            <button key={k} type="button" onClick={() => setDescribeKind(k)}
              style={{ padding: '4px 12px', background: describeKind === k ? 'var(--accent)' : 'transparent', border: 'none', color: describeKind === k ? '#fff' : 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
              {k}
            </button>
          ))}
        </div>
        <select value={describeTarget} onChange={e => { setDescribeTarget(e.target.value); fetchDescribe(describeKind, e.target.value); }}
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '4px 8px', outline: 'none', maxWidth: 280 }}>
          <option value="">Select {describeKind}…</option>
          {(describeKind === 'pod' ? allPods : allDeploys).map(r => (
            <option key={r.name} value={r.name}>{r.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => fetchDescribe(describeKind, describeTarget)} disabled={!describeTarget}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-muted)', cursor: describeTarget ? 'pointer' : 'not-allowed', padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={10} style={{ animation: loadingDescribe ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 10px' }}>
          <Search size={10} style={{ color: 'var(--text-muted)' }} />
          <input value={describeSearch} onChange={e => setDescribeSearch(e.target.value)} placeholder="Filter output…"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11, color: 'var(--text-primary)', width: 140 }} />
        </div>
        {describeOut && <CopyBtn text={describeOut} />}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        {!describeTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text-muted)' }}>
            <FileText size={36} style={{ opacity: 0.15 }} />
            <p style={{ fontSize: 13 }}>Select a resource to describe</p>
          </div>
        )}
        {loadingDescribe && (
          <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading describe output…
          </div>
        )}
        {filteredDescribe && (
          <pre style={{ margin: 0, padding: '14px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {filteredDescribe}
          </pre>
        )}
      </div>
    </div>
  );

  // ── Tab: Logs ─────────────────────────────────────────────────────────────

  const logsTab = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        <select value={logPod} onChange={e => { setLogPod(e.target.value); fetchLogs(e.target.value, logLines); }}
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '4px 8px', outline: 'none', maxWidth: 300 }}>
          <option value="">Select pod…</option>
          {allPods.map(p => <option key={p.name} value={p.name}>{p.name} — {p.status}</option>)}
        </select>
        <select value={logLines} onChange={e => { const n = Number(e.target.value); setLogLines(n); fetchLogs(logPod, n); }}
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '4px 8px', outline: 'none' }}>
          {[50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n} lines</option>)}
        </select>
        <button type="button" onClick={() => fetchLogs(logPod, logLines)} disabled={!logPod}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-muted)', cursor: logPod ? 'pointer' : 'not-allowed', padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={10} style={{ animation: loadingLogs ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 10px' }}>
          <Search size={10} style={{ color: 'var(--text-muted)' }} />
          <input value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder="Filter logs…"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11, color: 'var(--text-primary)', width: 140 }} />
        </div>
        {logPod && <button type="button" onClick={() => startAnalysis(logPod)}
          style={{ marginLeft: 'auto', padding: '4px 12px', background: 'var(--accent)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Zap size={10} /> Analyze
        </button>}
        {logs && <CopyBtn text={logs} />}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!logPod && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text-muted)' }}>
            <Terminal size={36} style={{ opacity: 0.15 }} />
            <p style={{ fontSize: 13 }}>Select a pod to view logs</p>
          </div>
        )}
        {loadingLogs && (
          <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Fetching logs…
          </div>
        )}
        {filteredLogs && !loadingLogs && (
          <pre style={{ margin: 0, padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#7ee787', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {filteredLogs}
          </pre>
        )}
      </div>
    </div>
  );

  // ── Tab: Resolve ───────────────────────────────────────────────────────────

  const resolveTab = (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Analysis column */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {!analyzeTarget && !analyzing && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-muted)' }}>
            <Zap size={44} style={{ opacity: 0.15 }} />
            <p style={{ fontSize: 14, textAlign: 'center' }}>Go to Pod Errors and click Analyze →<br />or click Analyze in the Logs / Deployments tab</p>
          </div>
        )}

        {analyzing && !headerData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 680 }}>
            {[280, 180, 240, 160].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: 16, width: w, maxWidth: '100%' }} />
            ))}
          </div>
        )}

        {(headerData || analyzing) && (
          <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Incident header */}
            {headerData && (
              <div style={{ background: SEV_BG[headerData.severity] || 'var(--bg-surface)', border: `1px solid ${SEV_COLOR[headerData.severity] || 'var(--border)'}44`, borderRadius: 10, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 100, background: `${SEV_COLOR[headerData.severity]}22`, border: `1px solid ${SEV_COLOR[headerData.severity]}`, color: SEV_COLOR[headerData.severity], fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {headerData.severity}
                  </span>
                  {analyzing && <span style={{ fontSize: 11, color: 'var(--accent)' }}>● Analyzing…</span>}
                  {pixieUsed && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 100, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Zap size={9} /> eBPF
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  {headerData.pod_name && <span>Pod: <strong style={{ color: 'var(--text-primary)' }}>{headerData.pod_name}</strong></span>}
                  {headerData.namespace && <span>NS: <strong style={{ color: 'var(--text-primary)' }}>{headerData.namespace}</strong></span>}
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{headerData.what_is_happening}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                  <button type="button" onClick={handleResolve} disabled={isResolved}
                    style={{ padding: '5px 12px', background: isResolved ? 'rgba(87,171,90,0.15)' : 'var(--success)', border: isResolved ? '1px solid var(--success)' : 'none', borderRadius: 5, color: isResolved ? 'var(--success)' : '#fff', fontSize: 11, fontWeight: 600, cursor: isResolved ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle size={11} /> {isResolved ? '✓ Resolved' : 'Mark Resolved'}
                  </button>
                  <button type="button" onClick={() => setShowRCA(true)} disabled={!sessionId}
                    style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: sessionId ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <FileText size={11} /> RCA Report
                  </button>
                  <button type="button" onClick={() => setShowPRModal(true)} disabled={!sessionId || prCreated}
                    style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: prCreated ? 'var(--success)' : 'var(--text-secondary)', fontSize: 11, cursor: sessionId && !prCreated ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <GitBranch size={11} /> {prCreated ? '✓ PR Created' : 'Raise PR'}
                  </button>
                </div>
              </div>
            )}

            {/* PR status */}
            {prCreated && prData && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <GitBranch size={12} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>PR #{String(prData.pr_number)} opened</span>
                <a href={prData.pr_url as string} target="_blank" rel="noreferrer"
                  style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                  View on GitHub <ExternalLink size={9} />
                </a>
              </div>
            )}

            {/* Cause tree */}
            <CauseTree causes={causes} causeStatuses={causeStatuses}
              onStatusChange={(id, s) => setCauseStatuses(prev => ({ ...prev, [String(id)]: s }))}
              onRunCommand={handleRunCommand} sessionId={sessionId} analyzing={analyzing} />

            {/* Fix steps */}
            <FixSteps recommendedOrder={analysisData?.recommended_order ?? null}
              steps={analysisData?.fix_steps ?? []} prevention={analysisData?.prevention ?? []}
              completedSteps={completedSteps} onMarkDone={n => setCompletedSteps(prev => new Set([...prev, n]))}
              onRunCommand={handleRunCommand} />
          </div>
        )}
      </div>

      {/* Right: Activity + Chat */}
      <div style={{ width: 320, minWidth: 320, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Activity log */}
        <div style={{ borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, maxHeight: 220 }}>
          <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Terminal size={11} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>Activity</span>
            {runningCmd && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)', marginLeft: 'auto' }} />}
            {activities.length > 0 && <button type="button" onClick={() => setActivities([])}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><X size={10} /></button>}
          </div>
          <div style={{ overflow: 'auto', padding: '0 12px 8px' }}>
            {activities.length === 0 && <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>No activity yet.</p>}
            {activities.map(a => (
              <div key={a.id} style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                  <span style={{ fontSize: 9, marginTop: 1, flexShrink: 0, color: a.type === 'ok' ? 'var(--success)' : a.type === 'err' ? 'var(--error)' : a.type === 'run' ? 'var(--warning)' : a.type === 'ai' ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {a.type === 'ok' ? '✓' : a.type === 'err' ? '✗' : a.type === 'run' ? '▶' : a.type === 'ai' ? '◆' : '●'}
                  </span>
                  <p style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.4, wordBreak: 'break-word' }}>{a.text}</p>
                </div>
                {a.detail && <p style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 14, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 2 }}>{a.detail}</p>}
              </div>
            ))}
            <div ref={activityEndRef} />
          </div>
        </div>
        {/* SRE Chat */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SREChat sessionId={sessionId} headerData={headerData} causes={causes} causeStatuses={causeStatuses} />
        </div>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* Top bar */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'var(--bg-surface)' }}>
        {clusters.length > 1 && (
          <select value={activeCluster || ''} onChange={e => setActiveCluster(e.target.value)}
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '4px 8px', outline: 'none' }}>
            {clusters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>NS</span>
          <select value={selectedNs} onChange={e => setSelectedNs(e.target.value)}
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '4px 8px', outline: 'none' }}>
            {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
          </select>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {allPods.length} pods · {allDeploys.length} workloads
        </span>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        {(['errors', 'deployments', 'describe', 'logs', 'resolve'] as Tab[]).map(t => (
          <button key={t} type="button" onClick={() => setActiveTab(t)}
            style={{ padding: '10px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === t ? 'var(--accent)' : 'transparent'}`, color: activeTab === t ? 'var(--accent)' : 'var(--text-muted)', fontSize: 12, fontWeight: activeTab === t ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'errors' && errorsTab}
        {activeTab === 'deployments' && deploymentsTab}
        {activeTab === 'describe' && describeTab}
        {activeTab === 'logs' && logsTab}
        {activeTab === 'resolve' && resolveTab}
      </div>

      {/* Modals */}
      {cmdToConfirm && (
        <CommandConfirmModal command={cmdToConfirm}
          onConfirm={() => { const c = cmdToConfirm; setCmdToConfirm(null); executeCommand(c); }}
          onCancel={() => setCmdToConfirm(null)} />
      )}
      {showRCA && sessionId && <RCAModal sessionId={sessionId} onClose={() => setShowRCA(false)} />}
      {showPRModal && sessionId && (
        <PRModal sessionId={sessionId}
          fixSteps={(analysisData?.fix_steps ?? []).map(s => ({ title: s.title, command: s.command }))}
          onClose={() => setShowPRModal(false)}
          onCreated={d => { setPrCreated(true); setPrData(d); setShowPRModal(false); }} />
      )}
    </div>
  );
}

// ── IssueRow ──────────────────────────────────────────────────────────────────

function IssueRow({ pod, onAnalyze, onLogs, onDescribe }: {
  pod: PodInfo;
  onAnalyze: () => void;
  onLogs: () => void;
  onDescribe: () => void;
}) {
  const isCrit = CRITICAL_STATUSES.has(pod.status);
  const borderColor = isCrit ? 'rgba(248,81,73,0.3)' : 'rgba(240,180,41,0.3)';
  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 14px', background: isCrit ? 'rgba(248,81,73,0.05)' : 'rgba(240,180,41,0.05)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: isCrit ? 'var(--error)' : 'var(--warning)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 180 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>{pod.name}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: isCrit ? 'var(--error)' : 'var(--warning)', fontWeight: 600 }}>{pod.status}</span>
          {pod.restarts > 0 && <span style={{ fontSize: 10, background: 'rgba(248,81,73,0.15)', color: 'var(--error)', padding: '1px 5px', borderRadius: 3 }}>{pod.restarts} restarts</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={onLogs}
          style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>
          Logs
        </button>
        <button type="button" onClick={onDescribe}
          style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>
          Describe
        </button>
        <button type="button" onClick={onAnalyze}
          style={{ padding: '4px 12px', background: 'var(--accent)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Zap size={10} /> Analyze →
        </button>
      </div>
    </div>
  );
}

// ── PRModal (inline) ──────────────────────────────────────────────────────────

interface PRFile { path: string; content: string }

function PRModal({ sessionId, fixSteps, onClose, onCreated }: {
  sessionId: string; fixSteps: { title: string; command: string }[];
  onClose: () => void; onCreated: (pr: Record<string, unknown>) => void;
}) {
  const [repo, setRepo] = useState(''); const [base, setBase] = useState('main');
  const [files, setFiles] = useState<PRFile[]>([{ path: '', content: '' }]);
  const [creating, setCreating] = useState(false); const [err, setErr] = useState('');
  const valid = repo.includes('/') && files.every(f => f.path.trim() && f.content.trim());

  const create = async () => {
    if (!valid || creating) return;
    setCreating(true); setErr('');
    try {
      const res = await fetch(`/api/diagnose/${sessionId}/create-pr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_full_name: repo.trim(), base_branch: base || 'main', files: files.filter(f => f.path.trim()) }),
      });
      const d = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(String(d.detail || 'Failed'));
      onCreated(d); onClose();
    } catch (e) { setErr(String(e)); } finally { setCreating(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, width: 540, maxHeight: '85vh', overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitBranch size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Raise Pull Request</span>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        {fixSteps.length > 0 && (
          <div style={{ background: 'var(--bg-base)', borderRadius: 6, padding: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>AI-suggested fixes:</p>
            {fixSteps.slice(0, 3).map((s, i) => <p key={i}>• {s.title}</p>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Repository (owner/repo)</label>
            <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="acme/my-app"
              style={{ display: 'block', width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '6px 8px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Base Branch</label>
            <input value={base} onChange={e => setBase(e.target.value)} placeholder="main"
              style={{ display: 'block', width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '6px 8px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Files to Change</span>
            <button type="button" onClick={() => setFiles(p => [...p, { path: '', content: '' }])}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: '1px 6px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
              <Plus size={9} /> Add
            </button>
          </div>
          {files.map((f, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                <input value={f.path} onChange={e => setFiles(p => p.map((x, j) => j === i ? { ...x, path: e.target.value } : x))} placeholder="k8s/deployment.yaml"
                  style={{ flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 11, padding: '4px 7px', outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
                {files.length > 1 && <button type="button" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', display: 'flex' }}><Trash2 size={11} /></button>}
              </div>
              <textarea value={f.content} onChange={e => setFiles(p => p.map((x, j) => j === i ? { ...x, content: e.target.value } : x))}
                placeholder="Paste updated file content…" rows={4}
                style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 11, padding: '5px 8px', resize: 'vertical', outline: 'none', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        {err && <p style={{ fontSize: 11, color: 'var(--error)', padding: '6px 10px', background: 'rgba(248,81,73,0.1)', borderRadius: 5 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button type="button" onClick={onClose} style={{ padding: '7px 14px', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={create} disabled={!valid || creating}
            style={{ padding: '7px 14px', background: valid && !creating ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 6, color: valid && !creating ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: valid && !creating ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
            {creating ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</> : <><GitBranch size={12} /> Open PR</>}
          </button>
        </div>
      </div>
    </div>
  );
}
