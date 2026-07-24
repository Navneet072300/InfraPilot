import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Settings, CreditCard, HelpCircle, LogOut, Moon, Sun } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useThemeStore } from '../../store/themeStore';

const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };

export function UserMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { name, plan, avatar } = useProfileStore();
  const { theme, toggle } = useThemeStore();
  const [open, setOpen] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowLogout(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const displayName = user?.name || name || 'User';
  const isGitHub = (user as any)?.provider === 'github';
  const email = isGitHub ? `${displayName} · GitHub` : (user?.email || '');
  const planKey = (user?.plan || plan) as string;
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function go(path: string) {
    navigate(path);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Avatar trigger */}
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setShowLogout(false); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          background: open ? 'var(--bg-hover)' : 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderColor: open ? 'var(--border-focus)' : 'var(--border)',
          borderRadius: 8, padding: '4px 8px', cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        title="Account menu"
      >
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: avatar ? 'transparent' : 'linear-gradient(135deg, var(--accent), #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden',
        }}>
          {avatar
            ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName.split(' ')[0]}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '6px', minWidth: 230,
          boxShadow: 'var(--shadow-lg)', zIndex: 200,
        }}>
          {/* Header */}
          <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: avatar ? 'transparent' : 'linear-gradient(135deg, var(--accent), #8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden',
              }}>
                {avatar
                  ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {email}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em',
                    color: 'var(--accent-text)', background: 'var(--badge-bg)',
                    border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px',
                    textTransform: 'uppercase',
                  }}>
                    {PLAN_LABEL[planKey] ?? planKey} Plan ✦
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Menu items */}
          {[
            { icon: <User size={14} />, label: 'View Profile', path: '/app/profile' },
            { icon: <Settings size={14} />, label: 'Settings', path: '/app/settings' },
            { icon: <CreditCard size={14} />, label: 'Billing', path: '/app/subscription' },
            { icon: <HelpCircle size={14} />, label: 'Help & Support', path: '/app/help' },
          ].map(({ icon, label, path }) => (
            <button
              key={path}
              type="button"
              onClick={() => go(path)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 10px', borderRadius: 7, border: 'none',
                background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 400,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
              {label}
            </button>
          ))}

          {/* Theme toggle */}
          <div style={{ margin: '4px 0', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
            <button
              type="button"
              onClick={toggle}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 10px', borderRadius: 7, color: 'var(--text-primary)', fontSize: 13,
                background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <span style={{ color: 'var(--text-muted)' }}>
                {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
              </span>
              <span>Theme</span>
              <span style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                background: 'var(--bg-hover)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '2px 7px', color: 'var(--text-secondary)',
              }}>
                {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
            </button>
          </div>

          {/* Logout */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
            {showLogout ? (
              <div style={{ padding: '6px 10px' }}>
                <p style={{ margin: '0 0 8px', color: 'var(--text-muted)', fontSize: 12 }}>Sign out of InfraPilot?</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={handleLogout}
                    style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: 'var(--error)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Yes, sign out
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogout(false)}
                    style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowLogout(true)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 10px', borderRadius: 7, border: 'none',
                  background: 'transparent', color: 'var(--error)', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--error-bg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <LogOut size={14} />
                Sign Out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
