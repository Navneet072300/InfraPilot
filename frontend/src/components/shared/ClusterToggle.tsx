import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClusterStore } from '../../store/clusterStore';
import { useClusterHealth } from '../../hooks/useKubernetes';
import type { ClusterConfig } from '../../types';

const ENV_COLORS: Record<string, string> = {
  dev: 'var(--cluster-dev)',
  staging: 'var(--warning)',
  prod: 'var(--cluster-prod)',
};

interface PillProps {
  cluster: ClusterConfig;
  active: boolean;
  onClick: () => void;
}

function ClusterPill({ cluster, active, onClick }: PillProps) {
  const { data: health } = useClusterHealth(cluster.name);
  const healthy = health?.healthy ?? false;
  const envColor = ENV_COLORS[cluster.environment] ?? 'var(--text-muted)';

  const tooltip = health
    ? `${cluster.api_url || 'N/A'} | ${health.node_count ?? '?'} nodes | ${health.version || 'unknown'}`
    : 'Testing connection...';

  return (
    <button
      type="button"
      title={tooltip}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px',
        background: active ? `${envColor}18` : 'transparent',
        border: `1px solid ${active ? envColor : 'var(--border)'}`,
        borderRadius: '100px',
        cursor: 'pointer', transition: 'all 0.15s',
        color: active ? envColor : 'var(--text-secondary)',
        fontSize: '12px', fontWeight: active ? 600 : 400,
      }}
    >
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: healthy ? 'var(--success)' : health ? 'var(--error)' : 'var(--text-muted)' }} />
      {cluster.name}
      {cluster.environment === 'prod' && (
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--cluster-prod)', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', padding: '1px 4px', borderRadius: '3px' }}>
          PROD
        </span>
      )}
    </button>
  );
}

interface Props {
  onProdWarning?: () => void;
}

export function ClusterToggle({ onProdWarning }: Props) {
  const navigate = useNavigate();
  const { clusters, activeCluster, setActiveCluster } = useClusterStore();
  const [pendingProd, setPendingProd] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClick = (cluster: ClusterConfig) => {
    if (cluster.environment === 'prod' && activeCluster !== cluster.name) {
      setPendingProd(cluster.name);
      setShowConfirm(true);
    } else {
      setActiveCluster(cluster.name);
    }
  };

  const confirmSwitch = () => {
    if (pendingProd) {
      setActiveCluster(pendingProd);
      onProdWarning?.();
    }
    setShowConfirm(false);
    setPendingProd(null);
  };

  if (clusters.length === 0) {
    return (
      <span
        style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', cursor: 'pointer' }}
        onClick={() => navigate('/app/settings?tab=platforms')}
      >
        No clusters — add one
      </span>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' }}>
      {clusters.map((c) => (
        <ClusterPill
          key={c.name}
          cluster={c}
          active={activeCluster === c.name}
          onClick={() => handleClick(c)}
        />
      ))}

      {/* Prod switch confirmation popover */}
      {showConfirm && (
        <div style={{
          position: 'absolute', top: '120%', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-surface)', border: '1px solid var(--cluster-prod)',
          borderRadius: 8, padding: '12px 16px', width: 260, zIndex: 1000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--cluster-prod)', marginBottom: 6 }}>
            ⚠ Switching to Production
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
            All subsequent operations will target the production cluster. Proceed carefully.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={confirmSwitch}
              style={{ flex: 1, padding: 5, background: 'var(--cluster-prod)', border: 'none', borderRadius: 4, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
              Switch to PROD
            </button>
            <button type="button" onClick={() => { setShowConfirm(false); setPendingProd(null); }}
              style={{ flex: 1, padding: 5, background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
