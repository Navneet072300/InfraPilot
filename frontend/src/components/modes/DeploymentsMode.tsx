import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Rocket, RefreshCw, Trash2, ChevronRight, CheckCircle2, XCircle,
  Clock, Loader2, GitBranch, AlertCircle, Zap, Copy, Check,
  ExternalLink, ChevronDown, ChevronUp, FileCode2, Play,
} from 'lucide-react';
import { toast } from '../../store/toastStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Deployment {
  id: number;
  repo_full_name: string;
  branch: string;
  ci_tool: string;
  deploy_target: string;
  registry: string;
  updated_at: string;
}

interface Run {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  status: string;      // queued | in_progress | completed
  conclusion: string | null;
  created_at: string;
  duration_s: number | null;
  html_url: string;
  actor: string;
}

interface Step {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps: Step[];
}

interface Analysis {
  diagnosis: string;
  fix_summary: string;
  severity: string;
  root_cause_line: string;
  files: { path: string; content: string; change_description: string }[];
  manual_steps: string[];
}

type Tab = 'runs' | 'logs' | 'ai-fix';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(s: number | null) {
  if (s == null) return '';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch { return ''; }
}

function StatusBadge({ status, conclusion, size = 'sm' }: { status: string; conclusion: string | null; size?: 'sm' | 'xs' }) {
  const sz = size === 'xs' ? 10 : 12;
  if (status === 'in_progress') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: sz, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '1px 6px' }}>
      <Loader2 size={sz - 2} style={{ animation: 'spin 0.8s linear infinite' }} /> Running
    </span>
  );
  if (status === 'queued') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: sz, color: 'var(--text-muted)', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>
      <Clock size={sz - 2} /> Queued
    </span>
  );
  if (conclusion === 'success') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: sz, color: 'var(--success)', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 4, padding: '1px 6px' }}>
      <CheckCircle2 size={sz - 2} /> Passed
    </span>
  );
  if (conclusion === 'failure') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: sz, color: 'var(--error)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 4, padding: '1px 6px' }}>
      <XCircle size={sz - 2} /> Failed
    </span>
  );
  if (conclusion === 'cancelled') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: sz, color: 'var(--text-muted)', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>
      Cancelled
    </span>
  );
  return null;
}

const CI_LABEL: Record<string, string> = {
  'github-actions': 'GitHub Actions',
  'gitlab-ci': 'GitLab CI',
  'jenkins': 'Jenkins',
};

const TARGET_LABEL: Record<string, string> = {
  'aws-eks': 'AWS EKS', 'gcp-gke': 'GCP GKE', 'azure-aks': 'Azure AKS',
  'do-k8s': 'DigitalOcean K8s', 'self-hosted': 'Self-hosted K8s',
  'fly': 'fly.io', 'railway': 'Railway', 'render': 'Render', 'vercel': 'Vercel',
};

// ── Main component ────────────────────────────────────────────────────────────

export function DeploymentsMode() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Deployment | null>(null);
  const [tab, setTab] = useState<Tab>('runs');

  // Runs
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);

  // Jobs
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Logs
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [copiedLog, setCopiedLog] = useState(false);

  // AI
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState(false);
  const [expandedFix, setExpandedFix] = useState<Set<string>>(new Set());

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadDeployments = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/deployments', { credentials: 'include' });
      const data = await r.json();
      setDeployments(data.deployments ?? []);
    } catch { toast.error('Failed to load deployments'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDeployments(); }, [loadDeployments]);

  const loadRuns = useCallback(async (dep: Deployment) => {
    setRunsLoading(true); setRuns([]); setSelectedRun(null); setJobs([]); setLogLines([]);
    try {
      const r = await fetch(`/api/deployments/${dep.id}/runs`, { credentials: 'include' });
      if (!r.ok) throw new Error((await r.json()).detail ?? 'Failed');
      const data = await r.json();
      setRuns(data.runs ?? []);
    } catch (e) { toast.error('Failed to load runs', String(e)); }
    finally { setRunsLoading(false); }
  }, []);

  const loadJobs = useCallback(async (dep: Deployment, run: Run) => {
    setJobsLoading(true); setJobs([]); setSelectedJob(null); setLogLines([]);
    try {
      const r = await fetch(`/api/deployments/${dep.id}/runs/${run.id}/jobs`, { credentials: 'include' });
      const data = await r.json();
      const jobList: Job[] = data.jobs ?? [];
      setJobs(jobList);
      // Auto-expand all jobs
      setExpandedJobs(new Set(jobList.map(j => j.id)));
    } catch (e) { toast.error('Failed to load jobs', String(e)); }
    finally { setJobsLoading(false); }
  }, []);

  const streamLogs = useCallback(async (dep: Deployment, run: Run, job: Job) => {
    setLogsLoading(true); setLogLines([]);
    setSelectedJob(job);
    setAnalysis(null);  // clear stale analysis whenever a new job is opened
    const es = new EventSource(`/api/deployments/${dep.id}/runs/${run.id}/logs/${job.id}?ip_session=`);
    // Note: EventSource doesn't support cookies natively for SSE — backend uses query param fallback
    // We use fetch-based SSE instead:
    es.close();

    // Use fetch for SSE (supports credentials)
    const controller = new AbortController();
    try {
      const resp = await fetch(`/api/deployments/${dep.id}/runs/${run.id}/logs/${job.id}`, {
        credentials: 'include', signal: controller.signal,
      });
      if (!resp.ok) { toast.error('Log stream failed', `${resp.status}`); setLogsLoading(false); return; }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const dataLine = part.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const payload = JSON.parse(dataLine.slice(6));
            if (payload.done) break;
            if (payload.line) setLogLines(prev => [...prev, payload.line]);
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') toast.error('Log stream error', String(e));
    } finally { setLogsLoading(false); }
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const selectDeployment = (dep: Deployment) => {
    setSelected(dep); setTab('runs'); setAnalysis(null); setApplyConfirm(false);
    loadRuns(dep);
  };

  const selectRun = (run: Run) => {
    setSelectedRun(run);
    if (selected) loadJobs(selected, run);
  };

  const selectJob = (job: Job) => {
    if (selected && selectedRun) streamLogs(selected, selectedRun, job);
    setTab('logs');
  };

  const deleteDeployment = async (dep: Deployment) => {
    await fetch(`/api/deployments/${dep.id}`, { method: 'DELETE', credentials: 'include' });
    setDeployments(prev => prev.filter(d => d.id !== dep.id));
    if (selected?.id === dep.id) { setSelected(null); setRuns([]); }
    toast.success('Deployment removed');
  };

  const handleAnalyze = async () => {
    if (!selected || !selectedRun || !selectedJob) return;
    setAnalyzing(true); setAnalysis(null);
    const logText = logLines.join('\n');
    try {
      const r = await fetch(`/api/deployments/${selected.id}/analyze`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: logText, job_name: selectedJob.name }),
      });
      const data = await r.json();
      setAnalysis(data);
      setTab('ai-fix');
    } catch (e) { toast.error('Analysis failed', String(e)); }
    finally { setAnalyzing(false); }
  };

  const handleApplyFix = async () => {
    if (!selected || !analysis?.files.length) return;
    setApplying(true);
    try {
      const r = await fetch(`/api/deployments/${selected.id}/apply-fix`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: analysis.files.map(f => ({ path: f.path, content: f.content })),
          message: `fix: ${analysis.fix_summary || 'apply InfraPilot AI suggestion'}`,
          branch: selectedRun?.head_branch || selected.branch,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? 'Apply failed');
      toast.success('Fix pushed to GitHub', `${analysis.files.length} file(s) committed. CI will re-run automatically.`);
      setApplyConfirm(false);
      setTab('runs');
      setTimeout(() => { if (selected) loadRuns(selected); }, 4000);
    } catch (e) { toast.error('Apply fix failed', String(e)); }
    finally { setApplying(false); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: 10 }}>
      <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> Loading deployments…
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>

      {/* ── Left panel: deployment list ─────────────────────────────────────── */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)' }}>
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Rocket size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Deployments</span>
          <button type="button" onClick={loadDeployments} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}>
            <RefreshCw size={12} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
          {deployments.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
              No deployments yet.<br />
              <span style={{ color: 'var(--accent)' }}>Complete the Deploy wizard</span><br />
              and push to GitHub to get started.
            </div>
          ) : deployments.map(dep => (
            <button
              key={dep.id}
              type="button"
              onClick={() => selectDeployment(dep)}
              style={{
                width: '100%', textAlign: 'left', background: selected?.id === dep.id ? 'rgba(99,102,241,0.1)' : 'none',
                border: 'none', borderLeft: selected?.id === dep.id ? '2px solid var(--accent)' : '2px solid transparent',
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dep.repo_full_name.split('/')[1]}
                </span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); deleteDeployment(dep); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, flexShrink: 0, opacity: 0, transition: 'opacity 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                  title="Remove"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {dep.repo_full_name.split('/')[0]} · {fmtTime(dep.updated_at)}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                {dep.ci_tool && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.12)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.2)' }}>{CI_LABEL[dep.ci_tool] ?? dep.ci_tool}</span>}
                {dep.deploy_target && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{TARGET_LABEL[dep.deploy_target] ?? dep.deploy_target}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel ─────────────────────────────────────────────────────── */}
      {!selected ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-muted)' }}>
          <Rocket size={32} style={{ opacity: 0.25 }} />
          <span style={{ fontSize: 13 }}>Select a deployment to monitor</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', opacity: 0.7 }}>or go to Deploy → Generate → push to GitHub</span>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Header */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', flexShrink: 0 }}>
            <GitBranch size={14} style={{ color: 'var(--accent)' }} />
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{selected.repo_full_name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>/{selected.branch}</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {selected.deploy_target && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{TARGET_LABEL[selected.deploy_target] ?? selected.deploy_target}</span>}
              <a href={`https://github.com/${selected.repo_full_name}/actions`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none' }}>
                <ExternalLink size={11} /> GitHub Actions
              </a>
              <button type="button" onClick={() => loadRuns(selected)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '0 20px', flexShrink: 0 }}>
            {([['runs', 'Runs'], ['logs', 'Logs'], ['ai-fix', 'AI Fix']] as [Tab, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                style={{
                  padding: '9px 16px', background: 'none', border: 'none',
                  borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
                  color: tab === id ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 12, fontWeight: tab === id ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit', marginBottom: '-1px',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {id === 'ai-fix' && analysis && <span style={{ width: 6, height: 6, borderRadius: '50%', background: analysis.files.length > 0 ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />}
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

            {/* ── Runs tab ── */}
            {tab === 'runs' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
                {runsLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                    <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Loading runs…
                  </div>
                )}
                {!runsLoading && runs.length === 0 && (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No CI runs yet. Push a commit to trigger GitHub Actions.
                  </div>
                )}
                {runs.map(run => (
                  <div
                    key={run.id}
                    style={{
                      padding: '10px 14px', marginBottom: 6, borderRadius: 8,
                      border: `1px solid ${selectedRun?.id === run.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: selectedRun?.id === run.id ? 'rgba(99,102,241,0.05)' : 'var(--bg-surface)',
                      cursor: 'pointer',
                    }}
                    onClick={() => selectRun(run)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <StatusBadge status={run.status} conclusion={run.conclusion} />
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtTime(run.created_at)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 5, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{run.head_branch} · {run.head_sha}</span>
                      {run.duration_s != null && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDuration(run.duration_s)}</span>}
                      {run.actor && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>by {run.actor}</span>}
                      <a href={run.html_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <ExternalLink size={10} /> GitHub
                      </a>
                    </div>

                    {/* Jobs expanded when this run is selected */}
                    {selectedRun?.id === run.id && (
                      <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        {jobsLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} />Loading jobs…</div>}
                        {jobs.map(job => (
                          <div key={job.id} style={{ marginBottom: 4 }}>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setExpandedJobs(prev => { const s = new Set(prev); s.has(job.id) ? s.delete(job.id) : s.add(job.id); return s; }); }}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              <StatusBadge status={job.status} conclusion={job.conclusion} size="xs" />
                              <span style={{ fontSize: 12, flex: 1, textAlign: 'left', color: 'var(--text-primary)' }}>{job.name}</span>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); selectJob(job); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--accent)', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                <Play size={9} /> Logs
                              </button>
                              {expandedJobs.has(job.id) ? <ChevronUp size={11} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />}
                            </button>

                            {expandedJobs.has(job.id) && (
                              <div style={{ paddingLeft: 14, paddingTop: 4 }}>
                                {job.steps.map(step => (
                                  <div key={step.number} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 6px', fontSize: 11, color: step.conclusion === 'failure' ? 'var(--error)' : step.conclusion === 'success' ? 'var(--success)' : 'var(--text-muted)' }}>
                                    {step.conclusion === 'success' ? <CheckCircle2 size={9} /> : step.conclusion === 'failure' ? <XCircle size={9} /> : step.status === 'in_progress' ? <Loader2 size={9} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Clock size={9} style={{ opacity: 0.4 }} />}
                                    {step.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Logs tab ── */}
            {tab === 'logs' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', flexShrink: 0 }}>
                  <FileCode2 size={12} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                    {selectedJob ? <><strong>{selectedJob.name}</strong> — {logLines.length} lines</> : 'Select a job from the Runs tab'}
                  </span>
                  {logLines.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(logLines.join('\n')); setCopiedLog(true); setTimeout(() => setCopiedLog(false), 1800); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        {copiedLog ? <Check size={11} style={{ color: 'var(--success)' }} /> : <Copy size={11} />}
                        {copiedLog ? 'Copied' : 'Copy'}
                      </button>
                      {selectedJob?.conclusion === 'failure' && (
                        <button
                          type="button"
                          onClick={handleAnalyze}
                          disabled={analyzing}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', background: analyzing ? 'var(--bg-hover)' : 'var(--accent)', color: analyzing ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 5, cursor: analyzing ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                        >
                          {analyzing ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Zap size={11} />}
                          {analyzing ? 'Analyzing…' : 'AI Fix'}
                        </button>
                      )}
                    </>
                  )}
                  {logsLoading && <Loader2 size={12} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />}
                </div>

                <div
                  ref={logRef}
                  style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: '#0d1117', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, lineHeight: 1.7 }}
                >
                  {logLines.length === 0 && !logsLoading && (
                    <span style={{ color: '#666' }}>Click "Logs" on a job in the Runs tab to stream output here.</span>
                  )}
                  {logLines.map((line, i) => {
                    const isError = /error|failed|fatal|cannot|exception/i.test(line);
                    const isWarning = /warn|warning/i.test(line);
                    const isStep = line.startsWith('##[group]') || line.startsWith('Run ');
                    return (
                      <div key={i} style={{ color: isError ? '#f87171' : isWarning ? '#fbbf24' : isStep ? '#60a5fa' : '#8b949e', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        <span style={{ color: '#3d4451', marginRight: 8, userSelect: 'none', fontSize: 10 }}>{String(i + 1).padStart(4, ' ')}</span>
                        {line}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── AI Fix tab ── */}
            {tab === 'ai-fix' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                {!analysis && !analyzing && (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    <AlertCircle size={24} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.3 }} />
                    Go to <strong>Logs</strong> tab, view a failed job, then click <strong>AI Fix</strong>.
                  </div>
                )}

                {analyzing && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '20px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                      <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--accent)' }} />
                      Reading repository files and analyzing failure logs…
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', paddingLeft: 24 }}>
                      This fetches your actual Dockerfile, workflows, and config before diagnosing — takes 10–20s.
                    </p>
                  </div>
                )}

                {analysis && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Severity + re-analyze row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        background: analysis.severity === 'error' ? 'rgba(248,113,113,0.12)' : analysis.severity === 'config' ? 'rgba(245,158,11,0.12)' : 'rgba(52,211,153,0.1)',
                        color: analysis.severity === 'error' ? 'var(--error)' : analysis.severity === 'config' ? '#f59e0b' : 'var(--success)',
                        border: `1px solid ${analysis.severity === 'error' ? 'rgba(248,113,113,0.25)' : analysis.severity === 'config' ? 'rgba(245,158,11,0.3)' : 'rgba(52,211,153,0.2)'}`,
                        textTransform: 'uppercase',
                      }}>
                        {analysis.severity === 'error' ? 'Code Fix' : analysis.severity === 'config' ? 'Config Issue' : 'Transient'}
                      </span>
                      <button
                        type="button"
                        onClick={handleAnalyze}
                        disabled={analyzing || !selectedJob}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 9px', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' }}
                      >
                        <RefreshCw size={10} /> Re-analyze
                      </button>
                    </div>

                    {/* Root cause line */}
                    {analysis.root_cause_line && (
                      <div style={{ padding: '8px 12px', background: '#0d1117', borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#f87171', wordBreak: 'break-all' }}>
                        {analysis.root_cause_line}
                      </div>
                    )}

                    {/* Diagnosis */}
                    <div style={{ padding: '12px 14px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                        <AlertCircle size={13} style={{ color: 'var(--error)' }} />
                        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--error)' }}>Root Cause</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>{analysis.diagnosis}</p>
                    </div>

                    {/* Fix summary */}
                    {analysis.fix_summary && (
                      <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                          <Zap size={12} style={{ color: 'var(--accent)' }} />
                          <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent)' }}>Proposed Fix</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>{analysis.fix_summary}</p>
                      </div>
                    )}

                    {/* Manual steps (for config/transient issues) */}
                    {analysis.manual_steps && analysis.manual_steps.length > 0 && (
                      <div style={{ padding: '12px 14px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                          <AlertCircle size={12} style={{ color: '#f59e0b' }} />
                          <span style={{ fontWeight: 700, fontSize: 12, color: '#f59e0b' }}>Manual Steps Required</span>
                        </div>
                        <ol style={{ margin: 0, paddingLeft: 18 }}>
                          {analysis.manual_steps.map((step, i) => (
                            <li key={i} style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, marginBottom: 4 }}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* File changes */}
                    {analysis.files.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                          File Changes ({analysis.files.length})
                        </div>
                        {analysis.files.map((f, idx) => (
                          <div key={idx} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                            <button
                              type="button"
                              onClick={() => setExpandedFix(prev => { const s = new Set(prev); s.has(f.path) ? s.delete(f.path) : s.add(f.path); return s; })}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-hover)', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              <FileCode2 size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                              <span style={{ fontSize: 12, fontFamily: 'monospace', flex: 1, textAlign: 'left', color: 'var(--text-primary)' }}>{f.path}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.change_description}</span>
                              {expandedFix.has(f.path) ? <ChevronUp size={11} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />}
                            </button>
                            {expandedFix.has(f.path) && (
                              <pre style={{ margin: 0, padding: '10px 14px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)', lineHeight: 1.7, background: 'var(--bg-base)', overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                                {f.content}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* No code fix — config/transient only */}
                    {analysis.files.length === 0 && !analyzing && (
                      <div style={{ padding: '10px 14px', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                        No file changes needed — follow the steps above, then push a commit or re-run the workflow to verify.
                      </div>
                    )}

                    {/* Apply button */}
                    {analysis.files.length > 0 && (
                      <div>
                        {!applyConfirm ? (
                          <button
                            type="button"
                            onClick={() => setApplyConfirm(true)}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            <GitBranch size={13} /> Apply Fix & Push to GitHub
                          </button>
                        ) : (
                          <div style={{ padding: '12px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8 }}>
                            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-primary)' }}>
                              This will commit {analysis.files.length} file(s) to <strong>{selectedRun?.head_branch || selected.branch}</strong> and trigger a new CI run. Continue?
                            </p>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                type="button"
                                onClick={handleApplyFix}
                                disabled={applying}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: applying ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                              >
                                {applying ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <ChevronRight size={11} />}
                                {applying ? 'Pushing…' : 'Yes, push it'}
                              </button>
                              <button type="button" onClick={() => setApplyConfirm(false)} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
