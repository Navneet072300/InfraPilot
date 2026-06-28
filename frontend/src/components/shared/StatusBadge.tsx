import type { TaskStatus } from '../../types';

const STATUS_CONFIG: Record<TaskStatus, { color: string; bg: string; label: string }> = {
  pending: { color: 'var(--text-muted)', bg: 'var(--bg-hover)', label: 'Pending' },
  running: { color: 'var(--accent)', bg: 'rgba(99,102,241,0.12)', label: 'Running' },
  done: { color: 'var(--success)', bg: 'rgba(34,197,94,0.12)', label: 'Done' },
  failed: { color: 'var(--error)', bg: 'rgba(239,68,68,0.12)', label: 'Failed' },
  skipped: { color: 'var(--text-muted)', bg: 'transparent', label: 'Skipped' },
};

interface Props {
  status: TaskStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: Props) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: size === 'sm' ? '1px 6px' : '3px 8px',
        background: cfg.bg,
        border: `1px solid ${cfg.color}`,
        borderRadius: '100px',
        color: cfg.color,
        fontSize: size === 'sm' ? '10px' : '11px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {status === 'running' && (
        <span
          style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: cfg.color,
            animation: 'blink 1s step-end infinite',
          }}
        />
      )}
      {cfg.label}
    </span>
  );
}
