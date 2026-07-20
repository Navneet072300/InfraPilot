import { useRef, useState } from 'react';
import {
  Wand2, Stethoscope, Compass, Activity,
  Database, Clock, HelpCircle, Zap, Rocket,
  ChevronLeft, Menu, CreditCard, Camera, Lock, Home, Plug, KeyRound,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useProfileStore, type Plan } from '../../store/profileStore';
import { useAuthStore } from '../../store/authStore';
import { UpgradeModal } from '../shared/UpgradeModal';
import type { PlanFeature } from '../../types';

interface NavItem {
  icon: React.ReactNode;
  label: string;
  path: string;
  stub?: boolean;
  planFeature?: PlanFeature;
}

const PRIMARY: NavItem[] = [
  { icon: <Zap size={16} />,         label: 'Deploy',      path: '/app/deploy' },
  { icon: <Rocket size={16} />,      label: 'Deployments', path: '/app/deployments' },
  { icon: <Wand2 size={16} />,       label: 'Generate',    path: '/app/generate' },
  { icon: <Stethoscope size={16} />, label: 'Diagnose',    path: '/app/diagnose' },
  { icon: <Compass size={16} />,     label: 'Design',      path: '/app/design', planFeature: 'design_mode' },
  { icon: <Activity size={16} />,    label: 'Monitor',     path: '/app/monitor', planFeature: 'monitor_mode' },
];

const RESOURCES: NavItem[] = [
  { icon: <Plug size={15} />,     label: 'Platforms', path: '/app/platforms' },
  { icon: <KeyRound size={15} />, label: 'Vault',     path: '/app/vault' },
  { icon: <Database size={15} />, label: 'Resources', path: '/app/resources' },
  { icon: <Clock size={15} />,    label: 'History',   path: '/app/history' },
];

const PLAN_LABEL: Record<Plan, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
const PLAN_COLOR: Record<Plan, string> = {
  free:       'var(--text-muted)',
  pro:        'var(--accent)',
  team:       'var(--accent)',
  enterprise: 'var(--accent)',
};

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { name, avatar, plan } = useProfileStore();
  const { user } = useAuthStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const setAvatar = useProfileStore((s) => s.setAvatar);
  const [upgradeFeature, setUpgradeFeature] = useState<PlanFeature | null>(null);

  const authPlan = user?.plan ?? 'free';
  const PLAN_GATED = new Set(['pro', 'team', 'enterprise']);
  function isPlanAllowed(feature?: PlanFeature) {
    if (!feature) return true;
    return PLAN_GATED.has(authPlan);
  }

  const isActive = (path: string) =>
    location.pathname === path ||
    (path === '/app/pipeline' && location.pathname === '/app');

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') setAvatar(ev.target.result);
    };
    reader.readAsDataURL(file);
  }

  const NavButton = ({ item }: { item: NavItem }) => {
    const active = isActive(item.path);
    const locked = item.planFeature ? !isPlanAllowed(item.planFeature) : false;

    function handleClick() {
      if (item.stub) return;
      if (locked && item.planFeature) {
        setUpgradeFeature(item.planFeature);
        return;
      }
      navigate(item.path);
    }

    return (
      <button
        type="button"
        onClick={handleClick}
        title={
          collapsed ? item.label
          : locked ? `${item.label} — Pro required`
          : item.stub ? `${item.label} (coming soon)`
          : undefined
        }
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: collapsed ? '10px 0' : '8px 12px',
          margin: collapsed ? '1px 0' : '2px 8px 2px 0',
          width: collapsed ? '100%' : 'calc(100% - 8px)',
          background: active ? 'rgba(129,140,248,0.10)' : 'none',
          border: 'none',
          borderLeft: !collapsed ? (active ? '3px solid var(--accent)' : '3px solid transparent') : 'none',
          borderRadius: collapsed ? 8 : (active ? '0 8px 8px 0' : '0 8px 8px 0'),
          color: active ? '#bdc2ff' : (item.stub || locked) ? 'var(--text-muted)' : 'var(--text-secondary)',
          fontSize: '13px', fontWeight: active ? 700 : 400,
          cursor: 'pointer',
          textAlign: 'left',
          justifyContent: collapsed ? 'center' : 'flex-start',
          fontFamily: 'inherit',
          opacity: item.stub ? 0.45 : 1,
          transition: 'background 0.12s, color 0.12s, border-color 0.12s',
          boxSizing: 'border-box',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'rgba(129,140,248,0.10)' : 'none'; }}
      >
        <span style={{
          flexShrink: 0,
          width: 26, height: 26,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 6,
          background: active ? 'rgba(129,140,248,0.18)' : 'transparent',
          color: active ? '#bdc2ff' : 'inherit',
          transition: 'all 0.12s',
        }}>
          {item.icon}
        </span>
        {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
        {!collapsed && locked && <Lock size={11} style={{ flexShrink: 0, opacity: 0.4 }} />}
      </button>
    );
  };

  const BottomNavBtn = ({ icon, label, path }: { icon: React.ReactNode; label: string; path: string }) => {
    const active = isActive(path);
    return (
      <button
        type="button"
        onClick={() => navigate(path)}
        title={collapsed ? label : undefined}
        style={{
          width: collapsed ? '100%' : 'calc(100% - 8px)',
          margin: collapsed ? '1px 0' : '1px 8px 1px 0',
          display: 'flex', alignItems: 'center', gap: '9px',
          padding: collapsed ? '8px 0' : '6px 10px',
          background: active ? 'rgba(129,140,248,0.10)' : 'none',
          border: 'none',
          borderLeft: !collapsed ? (active ? '3px solid var(--accent)' : '3px solid transparent') : 'none',
          borderRadius: '0 8px 8px 0',
          color: active ? '#bdc2ff' : 'var(--text-muted)',
          fontSize: '12.5px', fontWeight: active ? 600 : 400,
          cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit',
          justifyContent: collapsed ? 'center' : 'flex-start',
          boxSizing: 'border-box',
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'rgba(129,140,248,0.10)' : 'none'; }}
      >
        <span style={{ flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
        {!collapsed && label}
      </button>
    );
  };

  const SectionLabel = ({ label }: { label: string }) => (
    !collapsed ? (
      <p style={{
        padding: '8px 16px 4px',
        fontSize: '10px', fontWeight: 700,
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
      }}>
        {label}
      </p>
    ) : (
      <div style={{ height: '1px', background: 'var(--border)', margin: '8px 10px' }} />
    )
  );

  return (
    <>
      <aside
        style={{
          width: collapsed ? '48px' : '220px',
          minWidth: collapsed ? '48px' : '220px',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          transition: 'width 0.2s, min-width 0.2s',
          overflow: 'hidden',
        }}
      >
        {/* Logo / Brand */}
        <div style={{
          height: '64px',
          display: 'flex', alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0, overflow: 'hidden',
        }}>
          {collapsed ? (
            <button
              type="button"
              onClick={onToggle}
              title="Expand sidebar"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '100%', height: '100%',
                background: 'none', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              <Menu size={16} />
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 14px', width: '100%' }}>
              {/* IP logo mark */}
              <div style={{
                width: 30, height: 30, borderRadius: '8px',
                background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 800, color: '#fff', flexShrink: 0,
                boxShadow: '0 2px 10px rgba(129,140,248,0.4)',
                letterSpacing: '-0.02em',
              }}>
                IP
              </div>
              <span style={{
                fontWeight: 800, fontSize: '18px',
                letterSpacing: '-0.03em',
                flex: 1,
                color: '#bdc2ff',
              }}>
                InfraPilot
              </span>
              <button
                type="button"
                onClick={onToggle}
                title="Collapse sidebar"
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  padding: '4px', borderRadius: 5, flexShrink: 0,
                  display: 'flex', alignItems: 'center',
                  opacity: 0.6,
                }}
              >
                <ChevronLeft size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          <SectionLabel label="Workspace" />
          {PRIMARY.map((item) => <NavButton key={item.path} item={item} />)}

          <SectionLabel label="Resources" />
          {RESOURCES.map((item) => <NavButton key={item.path} item={item} />)}
        </nav>

        {/* Bottom section */}
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Profile card */}
          <div
            style={{
              margin: collapsed ? '8px 4px' : '8px',
              padding: collapsed ? '8px 0' : '10px 12px',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center',
              gap: '10px', cursor: 'pointer',
              justifyContent: collapsed ? 'center' : 'flex-start',
              transition: 'background 0.12s',
            }}
            onClick={() => navigate('/app/profile')}
            title={collapsed ? name : undefined}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
          >
            {/* Avatar */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div
                style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: avatar ? 'transparent' : 'linear-gradient(135deg, var(--accent), #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: 700, color: '#fff',
                  overflow: 'hidden',
                }}
              >
                {avatar
                  ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials}
              </div>
              {!collapsed && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    aria-label="Upload profile photo"
                    style={{ display: 'none' }}
                    onChange={handleAvatarFile}
                  />
                  <button
                    type="button"
                    title="Change photo"
                    onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                    style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.55)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: 0, transition: 'opacity 0.15s',
                      border: 'none', cursor: 'pointer', color: '#fff',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0'; }}
                  >
                    <Camera size={10} />
                  </button>
                </>
              )}
            </div>

            {/* Name + plan */}
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '13px', fontWeight: 600,
                  color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {name}
                </div>
                <span style={{
                  display: 'inline-block', marginTop: 2,
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em',
                  color: PLAN_COLOR[plan],
                  background: `${PLAN_COLOR[plan]}18`,
                  border: `1px solid ${PLAN_COLOR[plan]}44`,
                  borderRadius: 4, padding: '1px 5px',
                  textTransform: 'uppercase',
                }}>
                  {PLAN_LABEL[plan]}
                </span>
              </div>
            )}
          </div>

          {/* Bottom nav */}
          <div style={{ paddingBottom: '8px' }}>
            <BottomNavBtn icon={<Home size={14} />}       label="Home"         path="/" />
            <BottomNavBtn icon={<CreditCard size={14} />} label="Subscription" path="/app/subscription" />
            <BottomNavBtn icon={<HelpCircle size={14} />} label="Help"         path="/app/help" />
          </div>
        </div>
      </aside>

      {upgradeFeature && (
        <UpgradeModal
          feature={upgradeFeature}
          requiredPlan="pro"
          onClose={() => setUpgradeFeature(null)}
        />
      )}
    </>
  );
}
