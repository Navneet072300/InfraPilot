import { useEffect, useRef } from 'react';
import { Bell, X, CheckCheck, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { useNotificationStore, type Notification, type NotifType } from '../../store/notificationStore';

function timeAgo(d: Date) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const TYPE_ICON: Record<NotifType, React.ReactNode> = {
  info:    <Info size={14} color="var(--accent-text)" />,
  success: <CheckCircle2 size={14} color="var(--success)" />,
  warning: <AlertTriangle size={14} color="var(--warning)" />,
  error:   <XCircle size={14} color="var(--error)" />,
};

const TYPE_BORDER: Record<NotifType, string> = {
  info:    'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error:   'var(--error)',
};

function NotifRow({ n }: { n: Notification }) {
  const { markRead, deleteNotif } = useNotificationStore();
  return (
    <div
      style={{
        display: 'flex',
        gap: '10px',
        padding: '10px 14px',
        background: n.read ? 'transparent' : 'var(--bg-hover)',
        borderLeft: `3px solid ${n.read ? 'transparent' : TYPE_BORDER[n.type]}`,
        cursor: n.read ? 'default' : 'pointer',
        transition: 'all 0.15s ease',
      }}
      onClick={() => !n.read && markRead(n.id)}
    >
      <div style={{ flexShrink: 0, marginTop: 2 }}>{TYPE_ICON[n.type]}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ fontSize: '12px', fontWeight: n.read ? 400 : 600, color: n.read ? 'var(--text-secondary)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.title}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>{timeAgo(n.timestamp)}</span>
        </div>
        <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {n.message}
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); deleteNotif(n.id); }}
        title="Delete"
        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', opacity: 0.7, marginTop: -2 }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationPanel({ open, onClose }: Props) {
  const { notifications, markAllRead } = useNotificationStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        width: 340,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-lg)',
        zIndex: 200,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Bell size={14} color="var(--text-primary)" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Notifications</span>
          {hasUnread && (
            <span style={{ fontSize: '10px', fontWeight: 700, background: 'var(--error-bg)', color: 'var(--error)', border: '1px solid var(--border)', borderRadius: 8, padding: '1px 6px' }}>
              {notifications.filter((n) => !n.read).length} new
            </span>
          )}
        </div>
        {hasUnread && (
          <button
            type="button"
            onClick={markAllRead}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-text)', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <CheckCheck size={12} /> Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            No notifications
          </div>
        ) : (
          notifications.map((n, i) => (
            <div key={n.id}>
              <NotifRow n={n} />
              {i < notifications.length - 1 && (
                <div style={{ height: '1px', background: 'var(--border)', margin: '0 14px' }} />
              )}
            </div>
          ))
        )}
      </div>

      {notifications.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => useNotificationStore.getState().notifications.forEach((n) => useNotificationStore.getState().deleteNotif(n.id))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

export function NotificationBell({ onClick }: { onClick: () => void }) {
  const unread = useNotificationStore((s) => s.unreadCount());
  return (
    <button
      type="button"
      title="Notifications"
      onClick={onClick}
      style={{
        background: 'var(--bg-base)', border: '1px solid var(--border)',
        borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer',
        padding: '6px', position: 'relative', display: 'flex', alignItems: 'center',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-focus)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      <Bell size={15} />
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: -3, right: -3,
          minWidth: 15, height: 15,
          background: 'var(--error)',
          borderRadius: 99,
          fontSize: 9.5,
          fontWeight: 700,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 4px',
          lineHeight: 1,
          boxShadow: '0 0 0 2px var(--bg-surface)',
        }}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
