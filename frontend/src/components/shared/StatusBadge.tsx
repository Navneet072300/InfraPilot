import type { TaskStatus } from '../../types';

const STATUS_CONFIG: Record<TaskStatus, { color: string; bg: string; label: string }> = {
  pending: { color: 'var(--text-muted)', bg: 'var(--bg-hover)', label: 'Pending' },
  running: { color: 'var(--accent-text)', bg: 'var(--badge-bg)', label: 'Running' },
  done:    { color: 'var(--success)', bg: 'var(--success-bg)', label: 'Done' },
  failed:  { color: 'var(--error)', bg: 'var(--error-bg)', label: 'Failed' },
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
        gap: '5px',
        padding: size === 'sm' ? '1px 7px' : '3px 9px',
        background: cfg.bg,
        border: '1px solid var(--border)',
        borderRadius: '9999px',
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
            animation: 'pulseDot 1.2s infinite ease-in-out',
          }}
        />
      )}
      {cfg.label}
    </span>
  );
}
