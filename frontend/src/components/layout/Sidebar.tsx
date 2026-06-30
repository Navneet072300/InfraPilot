import { useRef, useState } from 'react';
import {
  Rocket, Wand2, Stethoscope, Compass, Activity,
  Database, Clock, GitBranch, HelpCircle,
  ChevronLeft, Menu, CreditCard, Camera, Lock, Home, Zap,
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
  { icon: <Rocket size={16} />, label: 'Pipeline', path: '/app/pipeline' },
  { icon: <Wand2 size={16} />, label: 'Generate', path: '/app/generate' },
  { icon: <Stethoscope size={16} />, label: 'Diagnose', path: '/app/diagnose' },
  { icon: <Compass size={16} />, label: 'Design', path: '/app/design', planFeature: 'design_mode' },
  { icon: <Activity size={16} />, label: 'Monitor', path: '/app/monitor', planFeature: 'monitor_mode' },
];

const RESOURCES: NavItem[] = [
  { icon: <Zap size={15} />, label: 'Deploy', path: '/app/deploy' },
  { icon: <GitBranch size={15} />, label: 'Repositories', path: '/app/repos' },
  { icon: <Database size={15} />, label: 'Resources', path: '/app/resources' },
  { icon: <Clock size={15} />, label: 'History', path: '/app/history' },
];

const PLAN_LABEL: Record<Plan, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
const PLAN_COLOR: Record<Plan, string> = {
  free: 'var(--text-secondary)',
  pro: 'var(--accent)',
  team: 'var(--accent)',
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

  // Avatar initials
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
          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
          padding: collapsed ? '10px 14px' : '8px 16px',
          background: active ? 'rgba(99,102,241,0.12)' : 'none',
          border: 'none',
          borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
          color: active ? 'var(--accent)' : (item.stub || locked) ? 'var(--text-muted)' : 'var(--text-secondary)',
          fontSize: '13px', fontWeight: active ? 600 : 400,
          cursor: (item.stub || locked) ? 'pointer' : 'pointer',
          textAlign: 'left', justifyContent: collapsed ? 'center' : 'flex-start',
          fontFamily: 'inherit', opacity: item.stub ? 0.5 : 1,
          transition: 'all 0.1s',
        }}
      >
        <span style={{ flexShrink: 0 }}>{item.icon}</span>
        {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
        {!collapsed && locked && <Lock size={11} style={{ flexShrink: 0, opacity: 0.5 }} />}
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
          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
          padding: collapsed ? '10px 14px' : '7px 16px',
          background: active ? 'rgba(99,102,241,0.12)' : 'none',
          border: 'none',
          borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
          color: active ? 'var(--accent)' : 'var(--text-muted)',
          fontSize: '13px', fontWeight: active ? 600 : 400,
          cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <span style={{ flexShrink: 0 }}>{icon}</span>
        {!collapsed && label}
      </button>
    );
  };

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
      {/* Logo */}
      <div style={{ height: '48px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', flexShrink: 0, overflow: 'hidden' }}>
        {collapsed ? (
          /* Collapsed: full-width menu button, no overlap */
          <button
            type="button"
            onClick={onToggle}
            title="Expand sidebar"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <Menu size={16} />
          </button>
        ) : (
          /* Expanded: IP logo + name + collapse button */
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 14px', width: '100%' }}>
            <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'linear-gradient(135deg, var(--accent), #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, color: '#fff', flexShrink: 0 }}>
              IP
            </div>
            <span style={{ fontWeight: 800, fontSize: '14px', letterSpacing: '-0.01em', flex: 1 }}>InfraPilot</span>
            <button type="button" onClick={onToggle} title="Collapse sidebar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}>
              <ChevronLeft size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {!collapsed && (
          <p style={{ padding: '4px 14px 6px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Workspace</p>
        )}
        {PRIMARY.map((item) => <NavButton key={item.path} item={item} />)}

        <div style={{ height: '1px', background: 'var(--border)', margin: '8px 14px' }} />

        {!collapsed && (
          <p style={{ padding: '4px 14px 6px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Resources</p>
        )}
        {RESOURCES.map((item) => <NavButton key={item.path} item={item} />)}
      </nav>

      {/* Bottom section */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {/* Profile card */}
        <div
          style={{
            padding: collapsed ? '10px 0' : '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          onClick={() => navigate('/app/profile')}
          title={collapsed ? name : undefined}
        >
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: avatar ? 'transparent' : 'linear-gradient(135deg, var(--accent), #8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700, color: '#fff',
                overflow: 'hidden',
                border: isActive('/app/profile') ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {avatar
                ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : initials}
            </div>
            {/* Camera overlay — only in expanded mode */}
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
                    background: 'rgba(0,0,0,0.5)',
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
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <span style={{
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
            </div>
          )}
        </div>

        {/* Bottom nav */}
        <div style={{ paddingBottom: '6px' }}>
          <BottomNavBtn icon={<Home size={15} />} label="Home" path="/" />
          <BottomNavBtn icon={<CreditCard size={15} />} label="Subscription" path="/app/subscription" />
          <BottomNavBtn icon={<HelpCircle size={15} />} label="Help" path="/app/help" />
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
