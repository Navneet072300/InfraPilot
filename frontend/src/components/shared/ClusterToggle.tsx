import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, AlertTriangle } from 'lucide-react';
import { useClusterStore } from '../../store/clusterStore';
import { useClusterHealth } from '../../hooks/useKubernetes';
import type { ClusterConfig } from '../../types';

function HealthDot({ name }: { name: string }) {
  const { data: health } = useClusterHealth(name);
  const color = !health ? 'var(--text-muted)' : health.healthy ? 'var(--success)' : 'var(--error)';
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />;
}

function EnvBadge({ env }: { env: string }) {
  const isDev = env === 'dev';
  const isStaging = env === 'staging';
  const color = isDev ? 'var(--success)' : isStaging ? 'var(--warning)' : 'var(--error)';
  const bg = isDev ? 'var(--success-bg)' : isStaging ? 'var(--warning-bg)' : 'var(--error-bg)';

  return (
    <span style={{
      fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em',
      color, background: bg, border: '1px solid var(--border)',
      padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase',
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
        fontFamily: 'inherit', transition: 'all 0.15s ease',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <HealthDot name={cluster.name} />
      <span style={{ flex: 1 }}>{cluster.name}</span>
      {cluster.token_expired && (
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--error)', background: 'var(--error-bg)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 4 }}>
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

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setPendingProd(null); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '4px 10px 4px 9px',
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderColor: open ? 'var(--border-focus)' : 'var(--border)',
          borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s ease',
          color: 'var(--text-primary)', fontSize: '12.5px', fontWeight: 600,
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-focus)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        {activeCfg ? <HealthDot name={activeCfg.name} /> : null}
        <span>{activeCfg?.name ?? 'Select cluster'}</span>
        {activeCfg && <EnvBadge env={activeCfg.environment} />}
        {activeCfg?.token_expired && (
          <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--error)', background: 'var(--error-bg)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.05em' }}>
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
          borderRadius: 12, boxShadow: 'var(--shadow-lg)',
          minWidth: 220, zIndex: 1000, overflow: 'hidden',
        }}>
          {/* Prod confirmation */}
          {pendingProd ? (
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <AlertTriangle size={14} color="var(--error)" />
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--error)' }}>Switch to Production?</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                All operations will target the production cluster. Be careful.
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={confirmSwitch}
                  style={{ flex: 1, padding: '6px 0', background: 'var(--error)', border: 'none', borderRadius: 6, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                  Yes, switch
                </button>
                <button type="button" onClick={() => setPendingProd(null)}
                  style={{ flex: 1, padding: '6px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
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
                  style={{ width: '100%', padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
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
