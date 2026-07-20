import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, AlertTriangle } from 'lucide-react';
import { useClusterStore } from '../../store/clusterStore';
import { useClusterHealth } from '../../hooks/useKubernetes';
import type { ClusterConfig } from '../../types';

const ENV_COLOR: Record<string, string> = {
  dev:     '#34d399',
  staging: '#fbbf24',
  prod:    '#f87171',
};

function HealthDot({ name }: { name: string }) {
  const { data: health } = useClusterHealth(name);
  const color = !health ? 'var(--text-muted)' : health.healthy ? '#34d399' : '#f87171';
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />;
}

function EnvBadge({ env }: { env: string }) {
  const color = ENV_COLOR[env] ?? 'var(--text-muted)';
  return (
    <span style={{
      fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em',
      color, background: `${color}18`, border: `1px solid ${color}40`,
      padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase',
    }}>
      {env}
    </span>
  );
}

function ClusterOption({ cluster, active, onClick }: { cluster: ClusterConfig; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', background: active ? 'var(--bg-hover)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: '13px', fontWeight: active ? 600 : 400,
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <HealthDot name={cluster.name} />
      <span style={{ flex: 1 }}>{cluster.name}</span>
      {cluster.token_expired && (
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', color: '#f87171', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', padding: '1px 5px', borderRadius: 3 }}>
          EXPIRED
        </span>
      )}
      <EnvBadge env={cluster.environment} />
      {active && <span style={{ fontSize: '10px', color: 'var(--accent)' }}>●</span>}
    </button>
  );
}

interface Props {
  onProdWarning?: () => void;
}

export function ClusterToggle({ onProdWarning }: Props) {
  const navigate = useNavigate();
  const { clusters, activeCluster, setActiveCluster } = useClusterStore();
  const [open, setOpen] = useState(false);
  const [pendingProd, setPendingProd] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const activeCfg = clusters.find(c => c.name === activeCluster);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPendingProd(null);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleSelect = (cluster: ClusterConfig) => {
    if (cluster.environment === 'prod' && activeCluster !== cluster.name) {
      setPendingProd(cluster.name);
    } else {
      setActiveCluster(cluster.name);
      setOpen(false);
    }
  };

  const confirmSwitch = () => {
    if (pendingProd) {
      setActiveCluster(pendingProd);
      onProdWarning?.();
    }
    setOpen(false);
    setPendingProd(null);
  };

  if (clusters.length === 0) {
    return (
      <span
        style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', cursor: 'pointer' }}
        onClick={() => navigate('/app/platforms')}
      >
        No clusters — add one
      </span>
    );
  }

  const envColor = activeCfg ? (ENV_COLOR[activeCfg.environment] ?? 'var(--text-muted)') : 'var(--text-muted)';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setPendingProd(null); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '4px 10px 4px 9px',
          background: open ? 'var(--bg-hover)' : `${envColor}12`,
          border: `1px solid ${open ? 'var(--border-focus)' : `${envColor}40`}`,
          borderRadius: 8, cursor: 'pointer', transition: 'all 0.12s',
          color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600,
          fontFamily: 'inherit',
        }}
      >
        {activeCfg ? <HealthDot name={activeCfg.name} /> : null}
        <span>{activeCfg?.name ?? 'Select cluster'}</span>
        {activeCfg && <EnvBadge env={activeCfg.environment} />}
        {activeCfg?.token_expired && (
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#f87171', background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.05em' }}>
            EXPIRED
          </span>
        )}
        <ChevronDown size={12} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          minWidth: 200, zIndex: 1000, overflow: 'hidden',
        }}>
          {/* Prod confirmation */}
          {pendingProd ? (
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <AlertTriangle size={13} color="#f87171" />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f87171' }}>Switch to Production?</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
                All operations will target the production cluster. Be careful.
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={confirmSwitch}
                  style={{ flex: 1, padding: '5px 0', background: '#f87171', border: 'none', borderRadius: 5, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                  Yes, switch
                </button>
                <button type="button" onClick={() => setPendingProd(null)}
                  style={{ flex: 1, padding: '5px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '6px 12px 4px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Clusters
              </div>
              {clusters.map(c => (
                <ClusterOption
                  key={c.name}
                  cluster={c}
                  active={activeCluster === c.name}
                  onClick={() => handleSelect(c)}
                />
              ))}
              <div style={{ borderTop: '1px solid var(--border)', padding: '6px 8px' }}>
                <button
                  type="button"
                  onClick={() => { navigate('/app/platforms'); setOpen(false); }}
                  style={{ width: '100%', padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', borderRadius: 5, fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  + Manage clusters
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
