import { useState } from 'react';
import { CheckCircle, Copy, Check, Terminal, Loader2, BookOpen, Shield } from 'lucide-react';
import type { DiagnosisFixStep, DiagnosisPreventionItem } from '../../types';

// ── Shared micro-components ───────────────────────────────────────────────────

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

function CmdBlock({ command, onRun, running }: { command: string; onRun?: () => void; running?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, margin: '6px 0', overflow: 'hidden' }}>
      <pre style={{ margin: 0, padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {command}
      </pre>
      <div style={{ borderTop: '1px solid var(--bg-hover)', padding: '4px 8px', display: 'flex', gap: 5 }}>
        <CopyBtn text={command} />
        {onRun && (
          <button type="button" onClick={onRun} disabled={running}
            style={{ background: running ? 'transparent' : 'var(--accent)', border: running ? '1px solid var(--border)' : 'none', borderRadius: 4, color: running ? 'var(--text-muted)' : '#fff', cursor: running ? 'not-allowed' : 'pointer', padding: '1px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            {running
              ? <><Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> Running…</>
              : <><Terminal size={9} /> Run</>}
          </button>
        )}
      </div>
    </div>
  );
}

// ── FixStepCard ───────────────────────────────────────────────────────────────

function FixStepCard({ step, done, onDone, onRunCommand }: {
  step: DiagnosisFixStep;
  done: boolean;
  onDone: () => void;
  onRunCommand: (cmd: string) => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', opacity: done ? 0.45 : 1, transition: 'opacity 0.2s' }}>

      {/* Step header */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: done ? 'var(--success)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#fff' }}>
          {done ? '✓' : step.step}
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none' }}>
          {step.title}
        </span>
      </div>

      {/* Step body — hidden when done */}
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

// ── PreventionCard ────────────────────────────────────────────────────────────

function PreventionCard({ item }: { item: DiagnosisPreventionItem }) {
  return (
    <div style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 7px', borderRadius: 100, flexShrink: 0 }}>
          {item.effort}
        </span>
      </div>
      {item.why && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: item.implementation ? 8 : 0 }}>{item.why}</p>
      )}
      {item.implementation && (
        <CmdBlock command={item.implementation} />
      )}
    </div>
  );
}

// ── FixSteps (exported) ───────────────────────────────────────────────────────

interface FixStepsProps {
  recommendedOrder: string | null;
  steps: DiagnosisFixStep[];
  prevention: DiagnosisPreventionItem[];
  completedSteps: Set<number>;
  onMarkDone: (stepNum: number) => void;
  onRunCommand: (cmd: string) => void;
}

export function FixSteps({
  recommendedOrder,
  steps,
  prevention,
  completedSteps,
  onMarkDone,
  onRunCommand,
}: FixStepsProps) {
  if (steps.length === 0 && !recommendedOrder) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Where to start */}
      {recommendedOrder && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={12} style={{ color: 'var(--accent)' }} /> Where to Start
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75 }}>{recommendedOrder}</p>
        </div>
      )}

      {/* Fix steps */}
      {steps.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={13} style={{ color: 'var(--success)' }} />
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>Fix Steps</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
              {completedSteps.size}/{steps.length} done
            </span>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {steps.map(step => (
              <FixStepCard
                key={step.step}
                step={step}
                done={completedSteps.has(step.step)}
                onDone={() => onMarkDone(step.step)}
                onRunCommand={onRunCommand}
              />
            ))}
          </div>
        </div>
      )}

      {/* Prevention */}
      {prevention.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={13} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>How to Prevent This</span>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {prevention.map((item, i) => (
              <PreventionCard key={i} item={item} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
