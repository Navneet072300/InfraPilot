import { useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, Clock, SkipForward,
  ChevronDown, ChevronRight, Eye, Wrench, AlertTriangle,
} from 'lucide-react';
import type { PipelineTask, TaskStatus } from '../../types';
import { CodeBlock } from './CodeBlock';
import { useIsBuilder } from '../../hooks/useTerminology';
import { PIPELINE_TASK_NAMES } from '../../lib/terminology';

function TaskIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'done': return <CheckCircle2 size={18} color="var(--success)" />;
    case 'failed': return <XCircle size={18} color="var(--error)" />;
    case 'running': return <Loader2 size={18} color="var(--accent)" style={{ animation: 'spin 1.2s linear infinite' }} />;
    case 'skipped': return <SkipForward size={16} color="var(--text-muted)" />;
    default: return <Clock size={16} color="var(--text-muted)" />;
  }
}

interface PreviewPanel {
  task: PipelineTask;
  open: boolean;
  onClose: () => void;
}

function PreviewPanel({ task, onClose }: PreviewPanel) {
  const [activeFile, setActiveFile] = useState(0);
  const files = task.files ?? [];
  const hasFiles = files.length > 0;
  const content = hasFiles
    ? files[activeFile]?.content ?? task.output
    : task.output;
  const lang = hasFiles ? (files[activeFile]?.language ?? 'yaml') : 'bash';

  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '580px',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        zIndex: 200,
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
            Preview: {task.title}
          </p>
          {hasFiles && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {files.length} file{files.length !== 1 ? 's' : ''} generated
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
        >
          ×
        </button>
      </div>

      {hasFiles && files.length > 1 && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
          {files.map((f, i) => (
            <button
              key={f.path}
              onClick={() => setActiveFile(i)}
              style={{
                padding: '6px 12px', background: 'transparent', border: 'none',
                borderBottom: i === activeFile ? '2px solid var(--accent)' : '2px solid transparent',
                color: i === activeFile ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {f.path.split('/').pop()}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', padding: '12px' }}>
        <CodeBlock
          content={content || '# No output yet'}
          language={lang}
          filename={hasFiles ? files[activeFile]?.path : undefined}
          streaming={task.status === 'running'}
        />
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: PipelineTask;
  index: number;
  onPreview: (t: PipelineTask) => void;
  mode: 'auto' | 'step';
  onRun?: (id: number) => void;
}

function TaskCard({ task, index, onPreview, mode, onRun }: TaskCardProps) {
  const [expanded, setExpanded] = useState(task.status === 'running');
  const isBuilder = useIsBuilder();
  const translated = isBuilder ? PIPELINE_TASK_NAMES[task.title] : null;

  const borderColor = {
    running: 'var(--accent)',
    done: 'var(--success)',
    failed: 'var(--error)',
    skipped: 'var(--border)',
    pending: 'var(--border)',
  }[task.status];

  const hasOutput = task.output.trim().length > 0;
  const hasFiles = (task.files ?? []).length > 0;

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: '8px',
        background: task.status === 'running' ? 'rgba(99,102,241,0.03)' : 'var(--bg-surface)',
        overflow: 'hidden',
        opacity: task.status === 'skipped' ? 0.6 : 1,
        transition: 'border-color 0.2s',
      }}
    >
      {/* Task header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', cursor: hasOutput ? 'pointer' : 'default',
        }}
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: '18px' }}>
          {index + 1}.
        </span>
        <TaskIcon status={task.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: '13px', fontWeight: 600,
              color: task.status === 'skipped' ? 'var(--text-muted)' : 'var(--text-primary)',
              fontStyle: task.status === 'skipped' ? 'italic' : 'normal',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {translated ? translated.builder : task.title}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
            {translated ? translated.sub : task.description}
          </p>
        </div>

        {/* Stubbed badge */}
        {task.stubbed && (
          <span
            title="Real integration coming soon"
            style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em',
              color: 'var(--warning)', background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              padding: '2px 5px', borderRadius: '3px', cursor: 'help',
              whiteSpace: 'nowrap',
            }}
          >
            STUBBED
          </span>
        )}

        {/* Preview button */}
        {(hasOutput || hasFiles) && (
          <button
            onClick={(e) => { e.stopPropagation(); onPreview(task); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '3px 8px',
              background: 'var(--bg-hover)', border: '1px solid var(--border)',
              borderRadius: '4px', color: 'var(--text-secondary)',
              fontSize: '11px', cursor: 'pointer',
            }}
          >
            <Eye size={12} /> Preview
          </button>
        )}

        {/* Step-by-step run */}
        {mode === 'step' && task.status === 'pending' && (
          <button
            onClick={(e) => { e.stopPropagation(); onRun?.(task.id); }}
            style={{
              padding: '3px 10px', background: 'var(--accent)',
              border: 'none', borderRadius: '4px', color: '#fff',
              fontSize: '11px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Run
          </button>
        )}

        {/* Expand indicator */}
        {hasOutput && (
          expanded
            ? <ChevronDown size={14} color="var(--text-muted)" />
            : <ChevronRight size={14} color="var(--text-muted)" />
        )}
      </div>

      {/* Expanded output */}
      {expanded && hasOutput && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-base)',
            maxHeight: '280px',
            overflow: 'auto',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '11.5px',
            lineHeight: 1.6,
            padding: '10px 14px',
          }}
        >
          {task.output.split('\n').map((line, i) => {
            const isError = /error|fail|exception/i.test(line);
            const isWarn = /warn|warning/i.test(line);
            const isOk = /success|✓|done|created/i.test(line);
            return (
              <div
                key={i}
                style={{
                  color: isError ? 'var(--error)' : isWarn ? 'var(--warning)' : isOk ? 'var(--success)' : '#8b8b9e',
                }}
              >
                {line || ' '}
              </div>
            );
          })}
          {task.status === 'running' && (
            <span className="cursor-blink" style={{ color: 'var(--accent)' }}> </span>
          )}
        </div>
      )}

      {/* Failed: AI fix suggestion */}
      {task.status === 'failed' && task.error && (
        <div
          style={{
            borderTop: '1px solid var(--error)',
            background: 'rgba(239,68,68,0.05)',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <AlertTriangle size={14} color="var(--error)" />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--error)' }}>
              Error: {task.error}
            </span>
          </div>
          {task.fix && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ color: 'var(--warning)', fontWeight: 600, marginBottom: '4px' }}>
                <Wrench size={12} style={{ display: 'inline', marginRight: '4px' }} />
                AI Diagnosis
              </p>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
                {task.fix.slice(0, 600)}{task.fix.length > 600 ? '...' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  tasks: PipelineTask[];
  mode: 'auto' | 'step';
  onRun?: (id: number) => void;
}

export function TaskList({ tasks, mode, onRun }: Props) {
  const [preview, setPreview] = useState<PipelineTask | null>(null);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            task={task}
            index={i}
            onPreview={setPreview}
            mode={mode}
            onRun={onRun}
          />
        ))}
      </div>

      {preview && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.3)' }}
            onClick={() => setPreview(null)}
          />
          <PreviewPanel task={preview} open onClose={() => setPreview(null)} />
        </>
      )}
    </div>
  );
}
