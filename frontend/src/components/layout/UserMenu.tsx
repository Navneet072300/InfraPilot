import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Settings, CreditCard, HelpCircle, LogOut, Moon, Sun, Globe } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useThemeStore } from '../../store/themeStore';

const V = {
  surface: 'var(--bg-surface)', border: 'var(--border)', text: 'var(--text-primary)',
  muted: 'var(--text-secondary)', accent: 'var(--accent)', red: 'var(--error)',
} as const;

const PLAN_COLOR: Record<string, string> = { free: '#8b949e', pro: '#58a6ff', team: '#bc8cff', enterprise: '#bc8cff' };
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
  const email = user?.email || '';
  const planKey = (user?.plan || plan) as string;
  const planColor = PLAN_COLOR[planKey] ?? V.muted;
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
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: `1px solid ${open ? V.accent : V.border}`,
          borderRadius: 8, padding: '4px 8px', cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
        title="Account menu"
      >
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: avatar ? 'transparent' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden',
        }}>
          {avatar
            ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials}
        </div>
        <span style={{ fontSize: 12, color: V.text, fontWeight: 500, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName.split(' ')[0]}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: V.surface, border: `1px solid ${V.border}`,
          borderRadius: 10, padding: '6px', minWidth: 220,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 200,
        }}>
          {/* Header */}
          <div style={{ padding: '8px 10px 10px', borderBottom: `1px solid ${V.border}`, marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: avatar ? 'transparent' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden',
              }}>
                {avatar
                  ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: V.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </div>
                <div style={{ fontSize: 11, color: V.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {email}
                </div>
                <div style={{ marginTop: 3 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                    color: planColor, background: `${planColor}18`,
                    border: `1px solid ${planColor}44`, borderRadius: 4, padding: '1px 6px',
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
            { icon: <HelpCircle size={14} />, label: 'Help', path: '/app/help' },
            { icon: <Globe size={14} />, label: 'Landing Page', path: '/' },
          ].map(({ icon, label, path }) => (
            <button
              key={path}
              type="button"
              onClick={() => go(path)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 6, border: 'none',
                background: 'none', color: V.text, fontSize: 13,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
            >
              <span style={{ color: V.muted }}>{icon}</span>
              {label}
            </button>
          ))}

          {/* Theme toggle */}
          <div style={{ margin: '4px 0', borderTop: `1px solid ${V.border}`, paddingTop: 4 }}>
            <button
              type="button"
              onClick={toggle}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 6, color: V.muted, fontSize: 13,
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
            >
              {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
              <span>Theme</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 6px' }}>
                {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
            </button>
          </div>

          {/* Logout */}
          <div style={{ borderTop: `1px solid ${V.border}`, marginTop: 4, paddingTop: 4 }}>
            {showLogout ? (
              <div style={{ padding: '6px 10px' }}>
                <p style={{ margin: '0 0 8px', color: V.muted, fontSize: 12 }}>Sign out of InfraPilot?</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={handleLogout}
                    style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: V.red, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Yes, sign out
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogout(false)}
                    style={{ flex: 1, padding: '6px', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: 12, cursor: 'pointer' }}
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
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 6, border: 'none',
                  background: 'none', color: V.red, fontSize: 13,
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,81,73,0.08)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
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
