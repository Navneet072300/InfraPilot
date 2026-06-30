import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Stethoscope, AlertCircle, CheckCircle, ChevronDown, ChevronRight,
  Loader2, RefreshCw, Copy, Check, Terminal, FileText, Clock,
  X, Download, Send, BookOpen, Shield, Zap,
} from 'lucide-react';
import { useClusterStore } from '../../store/clusterStore';
import { useStream } from '../../hooks/useStream';
import { useNamespaces, usePods } from '../../hooks/useKubernetes';
import { useIsBuilder, useExperienceLevel } from '../../hooks/useTerminology';
import { translateErrorTitle } from '../../lib/errorMessages';
import { SEVERITY_LABELS } from '../../lib/terminology';
import type {
  DiagnosisCause, DiagnosisFixStep, DiagnosisPreventionItem,
  DiagnosisHistoryItem, SREChatMessage, CauseStatus,
} from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--error)', high: 'var(--warning)', medium: 'var(--warning)', low: 'var(--success)',
};
const SEV_BG: Record<string, string> = {
  critical: 'rgba(248,81,73,0.12)', high: 'rgba(249,115,22,0.12)',
  medium: 'rgba(240,180,41,0.12)', low: 'rgba(87,171,90,0.12)',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getCommandRisk(cmd: string): 'read' | 'write' | 'destructive' {
  const c = cmd.trim().toLowerCase();
  if (/kubectl.*(delete\s+(deployment|namespace|node|service|pv)|exec\b|port-forward\b)/.test(c)) return 'destructive';
  if (/kubectl\s+delete\s+pod\b/.test(c)) return 'destructive';
  if (/kubectl\s+(apply|patch|create|rollout\s+restart)\b/.test(c)) return 'write';
  return 'read';
}

// ── Shared micro-components ───────────────────────────────────────────────────

function CopyBtn({ text, small }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: small ? '1px 6px' : '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}
    >
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function ConfBar({ pct }: { pct: number }) {
  const c = pct >= 50 ? 'var(--warning)' : pct >= 30 ? 'var(--warning)' : 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--bg-hover)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, color: c, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function CmdBlock({
  command, onRun, running,
}: { command: string; onRun?: () => void; running?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, margin: '6px 0', overflow: 'hidden' }}>
      <pre style={{ margin: 0, padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{command}</pre>
      <div style={{ borderTop: '1px solid var(--bg-hover)', padding: '4px 8px', display: 'flex', gap: 5 }}>
        <CopyBtn text={command} />
        {onRun && (
          <button type="button" onClick={onRun} disabled={running}
            style={{ background: running ? 'transparent' : 'var(--accent)', border: running ? '1px solid var(--border)' : 'none', borderRadius: 4, color: running ? 'var(--text-muted)' : '#fff', cursor: running ? 'not-allowed' : 'pointer', padding: '1px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {running ? <><Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> Running…</> : <><Terminal size={9} /> Run</>}
          </button>
        )}
      </div>
    </div>
  );
}

// ── CauseCard ─────────────────────────────────────────────────────────────────

function CauseCard({ cause, status, onStatusChange, onRunCommand, sessionId }: {
  cause: DiagnosisCause;
  status: CauseStatus;
  onStatusChange: (id: number, s: CauseStatus) => void;
  onRunCommand: (cmd: string) => void;
  sessionId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const sc = { investigating: 'var(--text-muted)', confirmed: 'var(--success)', ruled_out: 'var(--text-muted)' };
  const sl = { investigating: '⟳ Investigating', confirmed: '✓ Confirmed', ruled_out: '✗ Ruled out' };

  const handleStatus = async (s: CauseStatus) => {
    onStatusChange(cause.id, s);
    if (sessionId) {
      await fetch(`/api/diagnose/${sessionId}/cause-status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cause_id: cause.id, status: s }),
      }).catch(() => null);
    }
  };

  return (
    <div style={{ border: `1px solid ${status === 'confirmed' ? 'rgba(87,171,90,0.5)' : status === 'ruled_out' ? 'var(--bg-hover)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden', opacity: status === 'ruled_out' ? 0.45 : 1, transition: 'all 0.2s' }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', userSelect: 'none' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: sc[status], flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Cause {cause.id} — {cause.title}</span>
          <div style={{ marginTop: 4 }}><ConfBar pct={cause.confidence_percent} /></div>
        </div>
        <span style={{ fontSize: 10, color: sc[status], flexShrink: 0, whiteSpace: 'nowrap' }}>{sl[status]}</span>
        {open ? <ChevronDown size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronRight size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
      </div>

      {open && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Why this might be it</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{cause.why}</p>
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Check: {cause.check_description}</p>
            <CmdBlock command={cause.check_command} onRun={() => onRunCommand(cause.check_command)} />
          </div>
          {cause.if_confirmed && (
            <div style={{ padding: '7px 10px', background: 'rgba(87,171,90,0.06)', borderRadius: 5, borderLeft: '2px solid var(--success)' }}>
              <span style={{ fontSize: 10, color: 'var(--success)', fontWeight: 700 }}>If confirmed: </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{cause.if_confirmed}</span>
            </div>
          )}
          {cause.if_ruled_out && (
            <div style={{ padding: '7px 10px', background: 'rgba(72,79,88,0.15)', borderRadius: 5, borderLeft: '2px solid #484f58' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>If ruled out: </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{cause.if_ruled_out}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 5 }}>
            {(['confirmed', 'ruled_out', 'investigating'] as CauseStatus[]).map(s => (
              <button key={s} type="button" onClick={() => handleStatus(s)}
                style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, border: `1px solid ${status === s ? sc[s] : 'var(--border)'}`, background: status === s ? `${sc[s]}22` : 'transparent', color: status === s ? sc[s] : 'var(--text-muted)', cursor: 'pointer' }}
              >
                {s === 'confirmed' ? '✓ Confirmed' : s === 'ruled_out' ? '✗ Ruled out' : '⟳ Investigating'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── FixStepCard ───────────────────────────────────────────────────────────────

function FixStepCard({ step, done, onDone, onRunCommand }: {
  step: DiagnosisFixStep; done: boolean;
  onDone: () => void; onRunCommand: (cmd: string) => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', opacity: done ? 0.45 : 1, transition: 'opacity 0.2s' }}>
      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: done ? 'var(--success)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#fff' }}>
          {done ? '✓' : step.step}
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none' }}>{step.title}</span>
      </div>
      {!done && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
          <CmdBlock command={step.command} onRun={() => onRunCommand(step.command)} />
          {step.expected_output && (
            <div style={{ marginTop: 6, padding: '5px 9px', background: 'rgba(87,171,90,0.07)', borderRadius: 5 }}>
              <span style={{ fontSize: 10, color: 'var(--success)', fontWeight: 700 }}>Expected: </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{step.expected_output}</span>
            </div>
          )}
          {step.if_different && (
            <div style={{ marginTop: 4, padding: '5px 9px', background: 'rgba(240,180,41,0.07)', borderRadius: 5 }}>
              <span style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 700 }}>If different: </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{step.if_different}</span>
            </div>
          )}
          <button type="button" onClick={onDone}
            style={{ marginTop: 8, padding: '5px 14px', background: 'var(--success)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            ✓ Mark Done
          </button>
        </div>
      )}
    </div>
  );
}

// ── CommandConfirmModal ───────────────────────────────────────────────────────

function CommandConfirmModal({ command, onConfirm, onCancel }: {
  command: string; onConfirm: () => void; onCancel: () => void;
}) {
  const risk = getCommandRisk(command);
  const riskColor = risk === 'destructive' ? 'var(--error)' : risk === 'write' ? 'var(--warning)' : 'var(--success)';
  const riskLabel = risk === 'destructive' ? 'DESTRUCTIVE' : risk === 'write' ? 'WRITE' : 'READ';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, width: 480, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Shield size={16} style={{ color: riskColor }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Confirm Command</span>
          <span style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 100, background: `${riskColor}22`, border: `1px solid ${riskColor}`, color: riskColor, fontSize: 10, fontWeight: 700 }}>{riskLabel}</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>This command will run on your connected cluster:</p>
        <pre style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '0 0 20px' }}>{command}</pre>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel}
            style={{ padding: '8px 18px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            style={{ padding: '8px 18px', background: riskColor, border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Run Command
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RCAModal ──────────────────────────────────────────────────────────────────

function RCAModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const contentRef = useRef('');

  const onChunk = useCallback((chunk: string) => {
    contentRef.current += chunk;
    setContent(contentRef.current);
  }, []);
  const onDone = useCallback(() => setLoading(false), []);
  const onError = useCallback((e: string) => { setError(e); setLoading(false); }, []);
  const { start } = useStream('/api/diagnose/rca', { onChunk, onDone, onError });

  useEffect(() => {
    start({ diagnosis_id: sessionId, user_name: 'SRE Team' });
  }, []);  // eslint-disable-line

  const download = () => {
    // Build a minimal but well-styled HTML document for printing to PDF
    const date = new Date().toISOString().slice(0, 10);
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>RCA Report — ${date}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a1a2e;background:#fff;padding:40px 52px;max-width:860px;margin:auto}
  h1{font-size:20px;font-weight:700;margin-bottom:4px;color:#1a1a2e}
  .meta{font-size:11px;color:#888;margin-bottom:28px}
  h2{font-size:14px;font-weight:700;color:#3b3b6e;margin:22px 0 6px;border-bottom:1px solid #e0e0f0;padding-bottom:4px}
  h3{font-size:13px;font-weight:700;color:#4b4b8e;margin:14px 0 4px}
  p,li{font-size:13px;line-height:1.75;color:#333;margin-bottom:6px}
  ul{padding-left:20px;margin-bottom:8px}
  pre,code{background:#f4f4f8;border:1px solid #dde;border-radius:4px;font-family:'JetBrains Mono','Courier New',monospace;font-size:11.5px;padding:10px 14px;white-space:pre-wrap;word-break:break-word;margin:6px 0 10px}
  .footer{margin-top:40px;font-size:10px;color:#aaa;text-align:center}
  @media print{body{padding:20px 24px}}
</style>
</head>
<body>
<h1>Root Cause Analysis Report</h1>
<p class="meta">Generated ${date} · Session ${sessionId.slice(0, 8)}</p>
${content
  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
  .replace(/^## (.+)$/gm, '<h2>$1</h2>')
  .replace(/^# (.+)$/gm, '<h2>$1</h2>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/```[\w]*\n?([\s\S]+?)```/g, '<pre>$1</pre>')
  .replace(/^- (.+)$/gm, '<li>$1</li>')
  .replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
  .replace(/\n{2,}/g, '</p><p>')
  .replace(/^(?!<[hup])/gm, '<p>')
  .replace(/(?<![>])$/gm, '</p>')
  .replace(/<p><\/p>/g, '')
}
<div class="footer">Generated by InfraPilot</div>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rca-${sessionId.slice(0, 8)}-${date}.html`;
    a.click();
    URL.revokeObjectURL(url);
    // Open in new tab so user can Ctrl+P → Save as PDF
    window.open(url, '_blank');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, width: '90vw', maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Root Cause Analysis Report</span>
          {loading && <span style={{ fontSize: 11, color: 'var(--accent)' }}>● Generating…</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => navigator.clipboard.writeText(content)} disabled={!content}
              style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Copy size={11} /> Copy
            </button>
            <button type="button" onClick={download} disabled={!content || loading}
              style={{ padding: '5px 12px', background: content && !loading ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 12, cursor: content && !loading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Download size={11} /> Export PDF
            </button>
            <button type="button" onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 6px' }}>
              <X size={14} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {error && <p style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>}
          {!content && loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[240, 160, 200, 100, 180].map((w, i) => (
                <div key={i} className="skeleton" style={{ height: 14, width: w, maxWidth: '100%' }} />
              ))}
            </div>
          )}
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ width: '100%', minHeight: 500, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: 14, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            placeholder="RCA will appear here…"
          />
        </div>
      </div>
    </div>
  );
}

// ── SREChatPanel ──────────────────────────────────────────────────────────────

function SREChatPanel({ sessionId, headerData, causes, causeStatuses }: {
  sessionId: string | null;
  headerData: { severity: string; what_is_happening: string; pod_name?: string | null; namespace?: string | null; cluster?: string | null } | null;
  causes: DiagnosisCause[];
  causeStatuses: Record<string, CauseStatus>;
}) {
  const [messages, setMessages] = useState<SREChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [commandResults, setCommandResults] = useState<{ command: string; output: string }[]>([]);
  const msgIdRef = useRef('');
  const cmdOutputRef = useRef('');
  const cmdMsgIdRef = useRef('');
  const endRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // Auto-scroll
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Auto first message when session and header arrive
  useEffect(() => {
    if (sessionId && headerData && !initializedRef.current && causes.length > 0) {
      initializedRef.current = true;
      const top = causes[0];
      const podCtx = headerData.pod_name ? `pod ${headerData.pod_name}` : 'the incident';
      setMessages([{
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `I've analyzed ${podCtx}. Most likely cause: **${top.title}** (${top.confidence_percent}% confidence).\n\n${headerData.what_is_happening}\n\nWant me to run the first check to verify? I'll show you the command before executing.`,
        timestamp: new Date(),
      }]);
    }
  }, [sessionId, headerData, causes]);

  const onChatChunk = useCallback((chunk: string) => {
    setMessages(prev => prev.map(m =>
      m.id === msgIdRef.current ? { ...m, content: m.content + chunk } : m
    ));
  }, []);

  const onChatEvent = useCallback((event: Record<string, unknown>) => {
    if (event.type === 'command_request') {
      const cmd = event.command as string;
      setMessages(prev => prev.map(m =>
        m.id === msgIdRef.current ? { ...m, command: cmd } : m
      ));
    }
  }, []);

  const onChatDone = useCallback(() => setLoading(false), []);
  const onChatError = useCallback((e: string) => {
    setLoading(false);
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${e}`, timestamp: new Date() }]);
  }, []);

  const { start: startChat } = useStream('/api/diagnose/chat', { onChunk: onChatChunk, onEvent: onChatEvent, onDone: onChatDone, onError: onChatError });

  const onCmdEvent = useCallback((event: Record<string, unknown>) => {
    if (event.type === 'output') {
      cmdOutputRef.current += (event.text as string) + '\n';
      setMessages(prev => prev.map(m =>
        m.id === cmdMsgIdRef.current ? { ...m, commandOutput: cmdOutputRef.current } : m
      ));
    }
  }, []);

  const onCmdDone = useCallback(() => {
    const output = cmdOutputRef.current;
    if (cmdMsgIdRef.current) {
      setCommandResults(prev => [...prev, { command: '', output }]);
    }
  }, []);

  const { start: startCmd } = useStream('/api/diagnose/run-command', { onEvent: onCmdEvent, onDone: onCmdDone });

  const historyForApi = messages
    .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.command))
    .map(m => ({ role: m.role, content: m.content }));

  const send = useCallback(async () => {
    if (!input.trim() || loading || !sessionId) return;
    const userMsg: SREChatMessage = { id: crypto.randomUUID(), role: 'user', content: input, timestamp: new Date() };
    msgIdRef.current = crypto.randomUUID();
    const assistantMsg: SREChatMessage = { id: msgIdRef.current, role: 'assistant', content: '', timestamp: new Date() };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);
    await startChat({
      diagnosis_id: sessionId,
      message: input,
      chat_history: historyForApi,
      command_results: commandResults.slice(-5),
    });
  }, [input, loading, sessionId, startChat, historyForApi, commandResults]);

  const runCommandFromChat = useCallback(async (_msgId: string, cmd: string) => {
    if (!sessionId) return;
    cmdMsgIdRef.current = crypto.randomUUID();
    cmdOutputRef.current = '';
    const cmdMsg: SREChatMessage = {
      id: cmdMsgIdRef.current, role: 'assistant',
      content: `Running command on cluster…`,
      command: cmd, commandOutput: '',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, cmdMsg]);
    await startCmd({ diagnosis_id: sessionId, command: cmd, confirmed: true });
  }, [sessionId, startCmd]);

  const suggestedFollowUps = sessionId ? [
    causes.some(c => causeStatuses[String(c.id)] !== 'confirmed') ? 'Run the first check' : null,
    'What if restarting doesn\'t fix it?',
    'Check node disk pressure',
    'Just fix it',
  ].filter(Boolean) as string[] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid var(--border)' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Zap size={13} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>SRE Assistant</span>
        </div>
        {headerData && (
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
            Context: {headerData.pod_name || 'incident'}{headerData.namespace ? ` · ${headerData.namespace}` : ''}{headerData.cluster ? ` · ${headerData.cluster}` : ''}
          </p>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!sessionId && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--text-muted)' }}>
            <Zap size={28} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: 12, textAlign: 'center' }}>Analyze an incident to start<br />the interactive investigation.</p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '92%', padding: '8px 11px', borderRadius: msg.role === 'user' ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
              background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-surface)',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
              fontSize: 12, color: msg.role === 'user' ? '#fff' : 'var(--text-secondary)', lineHeight: 1.6,
            }}>
              {msg.content.split('**').map((part, i) =>
                i % 2 === 1 ? <strong key={i} style={{ color: 'var(--text-primary)' }}>{part}</strong> : part
              )}
              {msg.command && !msg.commandOutput && (
                <div style={{ marginTop: 8 }}>
                  <CmdBlock command={msg.command} onRun={() => runCommandFromChat(msg.id, msg.command!)} />
                </div>
              )}
              {msg.commandOutput && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Output:</p>
                  <pre style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 10, color: '#7ee787', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap', margin: 0, maxHeight: 200, overflow: 'auto' }}>{msg.commandOutput}</pre>
                </div>
              )}
            </div>
            {loading && msg.role === 'assistant' && msg.id === msgIdRef.current && msg.content === '' && (
              <div style={{ padding: '6px 11px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px 8px 8px 2px', display: 'flex', gap: 4 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Suggested follow-ups */}
      {suggestedFollowUps.length > 0 && !loading && (
        <div style={{ padding: '0 14px 8px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {suggestedFollowUps.map(s => (
            <button key={s} type="button" onClick={() => { setInput(s); }}
              style={{ padding: '3px 9px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 100, color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            placeholder={sessionId ? 'Ask anything about this incident…' : 'Analyze an incident first…'}
            rows={2}
            disabled={!sessionId || loading}
            style={{ flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '7px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, opacity: !sessionId ? 0.4 : 1 }}
            onFocus={e => (e.target.style.borderColor = 'var(--border-focus)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
          <button type="button" onClick={send} disabled={!sessionId || loading || !input.trim()}
            style={{ padding: '0 12px', background: sessionId && input.trim() && !loading ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 6, color: '#fff', cursor: sessionId && input.trim() && !loading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center' }}>
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main DiagnoseMode ─────────────────────────────────────────────────────────

export function DiagnoseMode() {
  const { clusters, activeCluster, activeNamespace, setActiveCluster, setActiveNamespace } = useClusterStore();
  const isBuilder = useIsBuilder();
  const expLevel = useExperienceLevel();
  const sevLabel = (sev: string) => SEVERITY_LABELS[sev.toLowerCase()]?.[expLevel] ?? sev.toUpperCase();

  // Input state
  const [inputTab, setInputTab] = useState<'paste' | 'cluster'>('paste');
  const [logInput, setLogInput] = useState('');
  const [userContext, setUserContext] = useState('');
  const [showCtx, setShowCtx] = useState(false);
  const [selectedPod, setSelectedPod] = useState('');
  const [isLoadingPodLogs, setIsLoadingPodLogs] = useState(false);

  // Analysis state (incremental streaming)
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

  // Command execution
  const [cmdToConfirm, setCmdToConfirm] = useState<string | null>(null);

  // UI
  const [showRCA, setShowRCA] = useState(false);
  const [history, setHistory] = useState<DiagnosisHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // K8s data
  const nsData = useNamespaces(activeCluster);
  const podsData = usePods(activeCluster, activeNamespace || 'default');
  const pods = podsData.data?.pods ?? [];
  const namespaces = nsData.data?.namespaces ?? [];

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/diagnose/history');
      const d = await r.json() as { sessions: DiagnosisHistoryItem[] };
      setHistory(d.sessions || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ── Stream callbacks ──────────────────────────────────────────────────────

  const onDiagEvent = useCallback((event: Record<string, unknown>) => {
    const t = event.type as string;
    if (t === 'analysis_header') {
      setHeaderData({
        severity: event.severity as string,
        what_is_happening: event.what_is_happening as string,
        pod_name: event.pod_name as string | null,
        namespace: event.namespace as string | null,
        cluster: event.cluster as string | null,
      });
    } else if (t === 'cause') {
      setCauses(prev => [...prev, event.cause as DiagnosisCause]);
    } else if (t === 'analysis') {
      setAnalysisData({
        recommended_order: event.recommended_order as string,
        fix_steps: event.fix_steps as DiagnosisFixStep[],
        prevention: event.prevention as DiagnosisPreventionItem[],
      });
    }
  }, []);

  const onDiagDone = useCallback((meta: Record<string, unknown>) => {
    setAnalyzing(false);
    if (meta.session_id) {
      setSessionId(meta.session_id as string);
      fetchHistory();
    }
  }, [fetchHistory]);

  const onDiagError = useCallback((err: string) => {
    setAnalyzing(false);
    setError(err);
  }, []);

  const { start: startAnalyze } = useStream('/api/diagnose', { onEvent: onDiagEvent, onDone: onDiagDone, onError: onDiagError });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const startAnalysis = useCallback(async (logs: string, podName?: string) => {
    if (analyzing) return;
    setAnalyzing(true);
    setError(null);
    setHeaderData(null);
    setCauses([]);
    setAnalysisData(null);
    setCompletedSteps(new Set());
    setCauseStatuses({});
    setSessionId(null);
    setIsResolved(false);

    await startAnalyze({
      logs,
      pod_name: podName || undefined,
      namespace: activeNamespace || undefined,
      cluster: activeCluster || undefined,
      user_context: userContext || undefined,
    });
  }, [analyzing, startAnalyze, activeNamespace, activeCluster, userContext]);

  const handleAnalyze = useCallback(async () => {
    if (inputTab === 'paste') {
      await startAnalysis(logInput);
    } else {
      if (!selectedPod) { setError('Select a pod first'); return; }
      setIsLoadingPodLogs(true);
      try {
        const qs = new URLSearchParams({ pod: selectedPod, namespace: activeNamespace || 'default' });
        if (activeCluster) qs.set('cluster', activeCluster);
        const res = await fetch(`/api/k8s/pod/logs?${qs}`);
        const d = await res.json() as { logs?: string; error?: string };
        if (d.logs) {
          await startAnalysis(d.logs, selectedPod);
        } else {
          setError(d.error || 'Could not fetch pod logs');
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setIsLoadingPodLogs(false);
      }
    }
  }, [inputTab, logInput, selectedPod, activeNamespace, activeCluster, startAnalysis]);

  const handleRunCommand = useCallback((cmd: string) => {
    const risk = getCommandRisk(cmd);
    if (risk !== 'read') {
      setCmdToConfirm(cmd);
    }
    // Read commands: SREChatPanel handles execution directly via its CmdBlock Run button
  }, []);

  const handleResolve = useCallback(async () => {
    if (!sessionId || isResolved) return;
    try {
      const res = await fetch(`/api/diagnose/${sessionId}/resolve`, { method: 'POST' });
      if (res.ok || res.status === 404) {
        // 404 = session expired (backend restarted) — still mark resolved locally
        setIsResolved(true);
        fetchHistory();
      }
    } catch {
      setIsResolved(true); // offline / network — mark locally anyway
    }
  }, [sessionId, isResolved, fetchHistory]);

  const hasOutput = !!(headerData || causes.length > 0);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT PANEL ────────────────────────────────────────────────── */}
      <div style={{ width: 300, minWidth: 300, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Input tabs */}
          <div style={{ display: 'flex', background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {(['paste', 'cluster'] as const).map(t => (
              <button key={t} type="button" onClick={() => setInputTab(t)}
                style={{ flex: 1, padding: '6px', background: inputTab === t ? 'var(--accent)' : 'transparent', border: 'none', color: inputTab === t ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {t === 'paste' ? 'Paste Logs' : '⎈ Live Cluster'}
              </button>
            ))}
          </div>

          {/* Paste Logs */}
          {inputTab === 'paste' && (
            <>
              <textarea
                value={logInput}
                onChange={e => setLogInput(e.target.value)}
                placeholder="Paste pod logs, kubectl describe output, or events…"
                rows={12}
                style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 11, padding: '9px 11px', resize: 'none', outline: 'none', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.55, boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = 'var(--border-focus)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </>
          )}

          {/* Live Cluster */}
          {inputTab === 'cluster' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!activeCluster ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No cluster connected. Configure in Settings.</p>
              ) : (
                <>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Cluster</label>
                    <select value={activeCluster || ''} onChange={e => setActiveCluster(e.target.value)}
                      style={{ width: '100%', marginTop: 4, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '5px 8px', outline: 'none' }}>
                      {clusters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Namespace</label>
                    <select value={activeNamespace || 'default'} onChange={e => setActiveNamespace(e.target.value)}
                      style={{ width: '100%', marginTop: 4, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '5px 8px', outline: 'none' }}>
                      {(namespaces.length ? namespaces : ['default']).map(ns => <option key={ns} value={ns}>{ns}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Pod</label>
                      <button type="button" onClick={() => podsData.refetch()}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                        <RefreshCw size={10} style={{ animation: podsData.isFetching ? 'spin 1s linear infinite' : 'none' }} />
                      </button>
                    </div>
                    <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                      {pods.length === 0 && <p style={{ padding: 10, fontSize: 11, color: 'var(--text-muted)' }}>No pods found.</p>}
                      {pods.map(pod => {
                        const isRun = pod.status === 'Running';
                        const isSel = selectedPod === pod.name;
                        return (
                          <div key={pod.name} onClick={() => setSelectedPod(pod.name)}
                            style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: isSel ? 'rgba(99,102,241,0.1)' : 'transparent', borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent' }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: isRun ? 'var(--success)' : pod.status === 'Pending' ? 'var(--warning)' : 'var(--error)', flexShrink: 0 }} />
                            <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{pod.name}</span>
                            {pod.restarts > 3 && <span style={{ fontSize: 9, background: 'rgba(248,81,73,0.15)', color: 'var(--error)', padding: '0 4px', borderRadius: 3 }}>{pod.restarts}</span>}
                            <span style={{ fontSize: 9, color: isRun ? 'var(--success)' : 'var(--error)' }}>{pod.status}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Optional context */}
          <div>
            <button type="button" onClick={() => setShowCtx(c => !c)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}>
              {showCtx ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Additional context (optional)
            </button>
            {showCtx && (
              <textarea value={userContext} onChange={e => setUserContext(e.target.value)}
                placeholder="We just deployed v1.2.0, scaled from 2→5 replicas, updated the ingress config…"
                rows={3}
                style={{ width: '100%', marginTop: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 11, padding: '7px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
              />
            )}
          </div>

          {error && (
            <div style={{ padding: '8px 10px', background: 'rgba(248,81,73,0.1)', border: '1px solid var(--error)', borderRadius: 6, color: 'var(--error)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={12} /> {error}
              <button type="button" onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 14 }}>×</button>
            </div>
          )}

          <button type="button" onClick={handleAnalyze} disabled={analyzing || isLoadingPodLogs || (inputTab === 'paste' && !logInput.trim()) || (inputTab === 'cluster' && !selectedPod)}
            style={{ padding: '9px', background: analyzing ? 'var(--bg-hover)' : 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 700, cursor: analyzing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: analyzing ? 'none' : '0 0 14px var(--accent-glow)' }}>
            {analyzing ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…</> : isLoadingPodLogs ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Fetching logs…</> : <><Stethoscope size={14} /> Analyze →</>}
          </button>

          {/* History */}
          <div>
            <button type="button" onClick={() => setShowHistory(h => !h)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}>
              <Clock size={11} />
              Recent diagnoses ({history.length})
              {showHistory ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
            {showHistory && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {history.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No recent diagnoses.</p>}
                {history.map(h => (
                  <div key={h.id}
                    style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={async () => {
                      try {
                        const r = await fetch(`/api/diagnose/${h.id}`);
                        const s = await r.json() as Record<string, unknown>;
                        setHeaderData({ severity: s.severity as string, what_is_happening: s.what_is_happening as string, pod_name: s.pod_name as string, namespace: s.namespace as string, cluster: s.cluster as string });
                        setCauses((s.causes as DiagnosisCause[]) || []);
                        setAnalysisData({ recommended_order: s.recommended_order as string, fix_steps: (s.fix_steps as DiagnosisFixStep[]) || [], prevention: (s.prevention as DiagnosisPreventionItem[]) || [] });
                        setCauseStatuses((s.cause_statuses as Record<string, CauseStatus>) || {});
                        setSessionId(h.id);
                      } catch { /* ignore */ }
                    }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: SEV_COLOR[h.severity] || 'var(--text-muted)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.issue_title}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.pod_name || 'unknown'} · {timeAgo(h.created_at)}</p>
                    </div>
                    {h.resolved && <span style={{ fontSize: 9, background: 'rgba(87,171,90,0.15)', color: 'var(--success)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>Resolved</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CENTER PANEL ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!hasOutput && !analyzing && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, color: 'var(--text-muted)' }}>
            <Stethoscope size={48} style={{ opacity: 0.2 }} />
            <p style={{ fontSize: 14 }}>Paste logs or select a pod to get deep incident analysis</p>
            <p style={{ fontSize: 12, opacity: 0.7 }}>AI identifies multiple possible causes, ranks them by confidence, and gives you exact fix steps</p>
          </div>
        )}

        {analyzing && !hasOutput && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
            {[280, 180, 240, 160, 200, 120].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: 16, width: w, maxWidth: '100%' }} />
            ))}
          </div>
        )}

        {hasOutput && (
          <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Incident Header */}
            {headerData && (
              <div style={{ background: SEV_BG[headerData.severity] || 'var(--bg-surface)', border: `1px solid ${SEV_COLOR[headerData.severity] || 'var(--border)'}44`, borderRadius: 10, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 100, background: `${SEV_COLOR[headerData.severity]}22`, border: `1px solid ${SEV_COLOR[headerData.severity]}`, color: SEV_COLOR[headerData.severity], fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {sevLabel(headerData.severity)}
                  </span>
                  {isBuilder && (() => {
                    const errorType = headerData.what_is_happening?.match(/\b(ImagePullBackOff|CrashLoopBackOff|OOMKilled|Pending|CreateContainerConfigError)\b/)?.[0];
                    const plainTitle = errorType ? translateErrorTitle(errorType, 'builder') : null;
                    return plainTitle && plainTitle !== errorType ? (
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{plainTitle}</span>
                    ) : null;
                  })()}
                  {analyzing && <span style={{ fontSize: 11, color: 'var(--accent)' }}>● Analyzing…</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {headerData.pod_name && <span>{isBuilder ? 'App' : 'Pod'}: <strong style={{ color: 'var(--text-primary)' }}>{headerData.pod_name}</strong></span>}
                  {headerData.namespace && <span>{isBuilder ? 'Section' : 'Namespace'}: <strong style={{ color: 'var(--text-primary)' }}>{headerData.namespace}</strong></span>}
                  {headerData.cluster && <span>{isBuilder ? 'Server' : 'Cluster'}: <strong style={{ color: 'var(--text-primary)' }}>{headerData.cluster}</strong></span>}
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <button type="button" onClick={handleResolve} disabled={isResolved}
                    style={{ padding: '5px 12px', background: isResolved ? 'rgba(87,171,90,0.15)' : 'var(--success)', border: isResolved ? '1px solid var(--success)' : 'none', borderRadius: 5, color: isResolved ? 'var(--success)' : '#fff', fontSize: 11, fontWeight: 600, cursor: isResolved ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <CheckCircle size={11} /> {isResolved ? '✓ Resolved' : 'Mark Resolved'}
                  </button>
                  <button type="button" onClick={() => setShowRCA(true)} disabled={!sessionId}
                    style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: sessionId ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <FileText size={11} /> Generate RCA
                  </button>
                  <button type="button" onClick={() => navigator.clipboard.writeText(`${headerData.severity.toUpperCase()} | ${headerData.pod_name} | ${headerData.namespace}`)}
                    style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Copy size={11} /> Copy Summary
                  </button>
                </div>
              </div>
            )}

            {/* What's Happening */}
            {headerData?.what_is_happening && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>What's Happening</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75 }}>{headerData.what_is_happening}</p>
              </div>
            )}

            {/* Cause Tree */}
            {causes.length > 0 && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={13} style={{ color: 'var(--warning)' }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                    Possible Causes{analyzing ? ' — Investigating…' : ` — ${causes.length} identified`}
                  </span>
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {causes.map(cause => (
                    <CauseCard
                      key={cause.id}
                      cause={cause}
                      status={causeStatuses[String(cause.id)] || 'investigating'}
                      onStatusChange={(id, s) => setCauseStatuses(prev => ({ ...prev, [String(id)]: s }))}
                      onRunCommand={handleRunCommand}
                      sessionId={sessionId}
                    />
                  ))}
                  {analyzing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)' }}>
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: 12 }}>Evaluating more causes…</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Recommended Order */}
            {analysisData?.recommended_order && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BookOpen size={12} style={{ color: 'var(--accent)' }} /> Where to Start
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75 }}>{analysisData.recommended_order}</p>
              </div>
            )}

            {/* Fix Steps */}
            {analysisData?.fix_steps && analysisData.fix_steps.length > 0 && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={13} style={{ color: 'var(--success)' }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>Fix Steps</span>
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {analysisData.fix_steps.map(step => (
                    <FixStepCard
                      key={step.step}
                      step={step}
                      done={completedSteps.has(step.step)}
                      onDone={() => setCompletedSteps(prev => new Set([...prev, step.step]))}
                      onRunCommand={handleRunCommand}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Prevention */}
            {analysisData?.prevention && analysisData.prevention.length > 0 && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={13} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>How to Prevent This</span>
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {analysisData.prevention.map((item, i) => (
                    <div key={i} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 7 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 7px', borderRadius: 100, flexShrink: 0 }}>{item.effort}</span>
                      </div>
                      {item.why && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{item.why}</p>}
                      {item.implementation && <CmdBlock command={item.implementation} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL (SRE Chat) ─────────────────────────────────── */}
      <div style={{ width: 320, minWidth: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <SREChatPanel
          sessionId={sessionId}
          headerData={headerData}
          causes={causes}
          causeStatuses={causeStatuses}
        />
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      {cmdToConfirm && (
        <CommandConfirmModal
          command={cmdToConfirm}
          onConfirm={() => { handleRunCommand(cmdToConfirm); setCmdToConfirm(null); }}
          onCancel={() => setCmdToConfirm(null)}
        />
      )}
      {showRCA && sessionId && <RCAModal sessionId={sessionId} onClose={() => setShowRCA(false)} />}
    </div>
  );
}
