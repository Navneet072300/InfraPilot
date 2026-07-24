import { useNavigate } from 'react-router-dom';
import { X, Check, ChevronRight, Compass, Activity, Bot, Shield, Key, Users, FileText, Lock } from 'lucide-react';
import type { PlanFeature } from '../../types';
import { PLANS } from '../../pages/SubscriptionPage';

const PLAN_PRICE: Record<string, { monthly: number; annual: number }> = Object.fromEntries(
  PLANS.filter(p => p.id !== 'free').map(p => [p.id, { monthly: p.monthlyPrice, annual: p.annualPrice }])
);

interface FeatureContent {
  icon: React.ReactNode;
  headline: string;
  subtext: string;
  benefits: string[];
}

const FEATURE_CONTENT: Record<PlanFeature, FeatureContent> = {
  design_mode: {
    icon: <Compass size={28} />,
    headline: 'Unlock Architecture Design',
    subtext: 'Generate full infrastructure diagrams with cost estimates',
    benefits: [
      'Interactive diagrams with AWS, Kubernetes, RDS, and more',
      'Auto-generated Terraform + cost breakdown per component',
      'Simulate failure scenarios and failover paths',
    ],
  },
  monitor_mode: {
    icon: <Activity size={28} />,
    headline: 'Unlock Monitoring Dashboard',
    subtext: 'Real-time cluster health and cost optimization',
    benefits: [
      'Live pod counts, node status, and warning events',
      'Cost anomaly detection and optimization suggestions',
      'Drift detection across all connected clusters',
    ],
  },
  unlimited_ai: {
    icon: <Bot size={28} />,
    headline: 'Remove AI Request Limits',
    subtext: 'Run as many generations as your workflow demands',
    benefits: [
      'Unlimited pipeline, generate, and diagnose requests',
      'No daily resets or throttling',
      'Streaming responses for large outputs',
    ],
  },
  custom_model: {
    icon: <Bot size={28} />,
    headline: 'Use Your Own AI Model',
    subtext: 'Connect your self-hosted Ollama or vLLM endpoint',
    benefits: [
      'Your data never leaves your infrastructure',
      'Use any open-weight model — Gemma 4, Qwen3, Llama',
      'Full control over inference speed and cost',
    ],
  },
  vault_integration: {
    icon: <Shield size={28} />,
    headline: 'Unlock Vault & ArgoCD Integration',
    subtext: 'Complete GitOps with secrets management',
    benefits: [
      'Auto-configure Vault policies for new deployments',
      'ArgoCD Application manifests generated and synced',
      'Cloudflare DNS published automatically post-deploy',
    ],
  },
  api_keys: {
    icon: <Key size={28} />,
    headline: 'Unlock API Access',
    subtext: 'Integrate InfraPilot into your own tooling and scripts',
    benefits: [
      'Generate API keys with scoped permissions',
      'Call all generation endpoints programmatically',
      'Perfect for CI/CD pipelines and automation',
    ],
  },
  pipeline_unlimited: {
    icon: <Activity size={28} />,
    headline: 'Unlock Unlimited Pipelines',
    subtext: 'Run as many pipeline deployments as your team needs',
    benefits: [
      'No daily run cap — deploy as often as you ship',
      'Full 11-step CI/CD generation every time',
      'Pipeline history retained for 90 days',
    ],
  },
  diagnose_unlimited: {
    icon: <Activity size={28} />,
    headline: 'Unlock Unlimited Diagnoses',
    subtext: 'Debug every incident without hitting a wall',
    benefits: [
      'Unlimited AI-powered log analysis per day',
      'Live pod log fetching from any cluster',
      'Structured root-cause reports every time',
    ],
  },
  team_seats: {
    icon: <Users size={28} />,
    headline: 'Unlock Team Collaboration',
    subtext: 'Invite your team and manage access with roles',
    benefits: [
      'Up to 10 seats with Owner/Admin/Member/Viewer roles',
      'Shared cluster connections across the entire team',
      'Pipeline approval workflows for prod deployments',
    ],
  },
  audit_log: {
    icon: <FileText size={28} />,
    headline: 'Unlock Audit Logging',
    subtext: 'Full immutable trail of every action in your workspace',
    benefits: [
      '1-year retention with CSV export',
      'Filter by action type, user, date range',
      'SOC2-ready audit evidence',
    ],
  },
  sso: {
    icon: <Lock size={28} />,
    headline: 'Unlock Single Sign-On',
    subtext: 'Streamline access with your existing identity provider',
    benefits: [
      'Google Workspace and GitHub OAuth for your team',
      'Enforce 2FA across all team members',
      'Auto-provision accounts from your IdP',
    ],
  },
};

interface Props {
  feature: PlanFeature;
  requiredPlan: 'pro' | 'team' | 'enterprise';
  onClose: () => void;
  onUpgrade?: () => void;
}

export function UpgradeModal({ feature, requiredPlan, onClose, onUpgrade }: Props) {
  const navigate = useNavigate();
  const content = FEATURE_CONTENT[feature];
  const price = PLAN_PRICE[requiredPlan];
  const planName = requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1);

  function handleUpgrade() {
    onUpgrade?.();
    navigate('/app/subscription');
    onClose();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(6px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '2rem', width: '100%', maxWidth: 460,
        boxShadow: 'var(--shadow-lg)',
        position: 'relative',
        animation: 'fadeInUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Close */}
        <button type="button" onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>

        {/* Feature icon */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'var(--badge-bg)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-text)',
          }}>
            {content.icon}
          </div>
        </div>

        {/* Headline */}
        <h2 style={{ margin: '0 0 0.375rem', color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.3rem', textAlign: 'center' }}>
          {content.headline}
        </h2>
        <p style={{ margin: '0 0 1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
          {content.subtext}
        </p>

        {/* Benefits */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.5rem' }}>
          {content.benefits.map((b) => (
            <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--success-bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <Check size={11} color="var(--success)" />
              </div>
              <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.5 }}>{b}</span>
            </div>
          ))}
        </div>

        {/* Plan comparison arrow */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: '1.25rem', padding: '0.75rem', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-hover)', borderRadius: 4, padding: '3px 10px' }}>Free</span>
          <ChevronRight size={14} color="var(--text-muted)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-text)', background: 'var(--badge-bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 10px' }}>
            {planName}
          </span>
        </div>

        {/* Price */}
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '2rem', lineHeight: 1 }}>
            ${price?.monthly}<span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-muted)' }}>/month</span>
          </div>
          {price && price.annual < price.monthly && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 4 }}>
              or <strong style={{ color: 'var(--success)' }}>${price.annual}/month</strong> billed annually
            </div>
          )}
          {requiredPlan === 'enterprise' && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Custom pricing starting at $999/mo</div>
          )}
        </div>

        {/* CTA */}
        <button type="button" onClick={handleUpgrade} className="ip-button-primary"
          style={{
            width: '100%', padding: '0.75rem', fontSize: '0.95rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginBottom: 10,
          }}>
          Upgrade to {planName} <ChevronRight size={16} />
        </button>

        <button type="button" onClick={() => { navigate('/app/subscription'); onClose(); }} className="ip-button-secondary"
          style={{ width: '100%', padding: '0.5rem', fontSize: '0.82rem', marginBottom: 8 }}>
          View all plans
        </button>

        <div style={{ textAlign: 'center' }}>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
