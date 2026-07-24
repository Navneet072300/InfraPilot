import { AlertTriangle } from 'lucide-react';

interface Props {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: Props) {
  return (
    /* Backdrop */
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      {/* Dialog */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: '24px', width: 380, maxWidth: '90vw',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', gap: 16,
          animation: 'fadeInUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: danger ? 'var(--error-bg)' : 'var(--warning-bg)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: danger ? 'var(--error)' : 'var(--warning)',
          }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{title}</p>
            {message && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{message}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            className="ip-button-secondary"
            style={{ padding: '7px 16px', fontSize: '13px' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '7px 18px', borderRadius: 8, border: 'none',
              background: danger ? 'var(--error)' : 'var(--accent)',
              color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: danger ? '0 2px 10px rgba(239,68,68,0.3)' : '0 2px 10px var(--accent-glow)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
