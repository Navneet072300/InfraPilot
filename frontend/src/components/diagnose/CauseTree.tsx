import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Copy, Check, Terminal } from 'lucide-react';
import type { DiagnosisCause, CauseStatus } from '../../types';

// ── ConfBar ───────────────────────────────────────────────────────────────────

function ConfBar({ pct }: { pct: number }) {
  const c = pct >= 70 ? 'var(--error)' : pct >= 40 ? 'var(--warning)' : 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--bg-hover)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 10, color: c, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

// ── CopyBtn ───────────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: '1px 6px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── CmdBlock ──────────────────────────────────────────────────────────────────

function CmdBlock({ command, onRun, running }: { command: string; onRun?: () => void; running?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, margin: '6px 0', overflow: 'hidden' }}>
      <pre style={{ margin: 0, padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{command}</pre>
      <div style={{ borderTop: '1px solid var(--bg-hover)', padding: '4px 8px', display: 'flex', gap: 5 }}>
        <CopyBtn text={command} />
        {onRun && (
          <button type="button" onClick={onRun} disabled={running}
            style={{ background: running ? 'transparent' : 'var(--accent)', border: running ? '1px solid var(--border)' : 'none', borderRadius: 4, color: running ? 'var(--text-muted)' : '#fff', cursor: running ? 'not-allowed' : 'pointer', padding: '1px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            {running ? <><Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> Running…</> : <><Terminal size={9} /> Run</>}
          </button>
        )}
      </div>
    </div>
  );
}

// ── CauseCard ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<CauseStatus, string> = {
  investigating: 'var(--text-muted)',
  confirmed: 'var(--success)',
  ruled_out: 'var(--text-muted)',
};
const STATUS_LABEL: Record<CauseStatus, string> = {
  investigating: '⟳ Investigating',
  confirmed: '✓ Confirmed',
  ruled_out: '✗ Ruled out',
};

function CauseCard({ cause, status, onStatusChange, onRunCommand, sessionId }: {
  cause: DiagnosisCause;
  status: CauseStatus;
  onStatusChange: (id: number, s: CauseStatus) => void;
  onRunCommand: (cmd: string) => void;
  sessionId: string | null;
}) {
  const [open, setOpen] = useState(false);

  const handleStatus = async (s: CauseStatus) => {
    onStatusChange(cause.id, s);
    if (sessionId) {
      await fetch(`/api/diagnose/${sessionId}/cause-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cause_id: cause.id, status: s }),
      }).catch(() => null);
    }
  };

  const borderColor = status === 'confirmed'
    ? 'rgba(87,171,90,0.5)'
    : status === 'ruled_out'
      ? 'var(--bg-hover)'
      : 'var(--border)';

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, overflow: 'hidden', opacity: status === 'ruled_out' ? 0.45 : 1, transition: 'all 0.2s' }}>

      {/* Header row */}
      <div onClick={() => setOpen(o => !o)}
        style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', userSelect: 'none' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[status], flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            Cause {cause.id} — {cause.title}
          </span>
          <div style={{ marginTop: 4 }}><ConfBar pct={cause.confidence_percent} /></div>
        </div>
        <span style={{ fontSize: 10, color: STATUS_COLOR[status], flexShrink: 0, whiteSpace: 'nowrap' }}>
          {STATUS_LABEL[status]}
        </span>
        {open
          ? <ChevronDown size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 10 }}>

          <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Why this might be it</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{cause.why}</p>
          </div>

          <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
              Check: {cause.check_description}
            </p>
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

          {/* Status toggles */}
          <div style={{ display: 'flex', gap: 5 }}>
            {(['confirmed', 'ruled_out', 'investigating'] as CauseStatus[]).map(s => (
              <button key={s} type="button" onClick={() => handleStatus(s)}
                style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, border: `1px solid ${status === s ? STATUS_COLOR[s] : 'var(--border)'}`, background: status === s ? `${STATUS_COLOR[s]}22` : 'transparent', color: status === s ? STATUS_COLOR[s] : 'var(--text-muted)', cursor: 'pointer' }}>
                {s === 'confirmed' ? '✓ Confirmed' : s === 'ruled_out' ? '✗ Ruled out' : '⟳ Investigating'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── CauseTree (exported) ──────────────────────────────────────────────────────

interface CauseTreeProps {
  causes: DiagnosisCause[];
  causeStatuses: Record<string, CauseStatus>;
  onStatusChange: (id: number, status: CauseStatus) => void;
  onRunCommand: (cmd: string) => void;
  sessionId: string | null;
  analyzing: boolean;
}

export function CauseTree({ causes, causeStatuses, onStatusChange, onRunCommand, sessionId, analyzing }: CauseTreeProps) {
  if (!analyzing && causes.length === 0) return null;

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertCircle size={13} style={{ color: 'var(--warning)' }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
          {analyzing ? 'Possible Causes — Investigating…' : `Possible Causes — ${causes.length} identified`}
        </span>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {causes.map(cause => (
          <CauseCard
            key={cause.id}
            cause={cause}
            status={causeStatuses[String(cause.id)] ?? 'investigating'}
            onStatusChange={onStatusChange}
            onRunCommand={onRunCommand}
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
  );
}
