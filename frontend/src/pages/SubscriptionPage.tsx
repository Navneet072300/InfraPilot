import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, Zap, Shield, Users, Building2, CreditCard, ChevronRight, Star, Sparkles } from 'lucide-react';
import { useProfileStore } from '../store/profileStore';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', surface2: '#1a1a21', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)', accentLight: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)', purple: 'var(--accent)',
} as const;

type BillingCycle = 'monthly' | 'annual';

export interface Plan {
  id: 'free' | 'pro' | 'team' | 'enterprise';
  name: string;
  icon: React.ReactNode;
  monthlyPrice: number;
  annualPrice: number;
  color: string;
  badge?: string;
  highlighted: boolean;
  features: string[];
  cta: string;
}

export const PLANS: Plan[] = [
  {
    id: 'free', name: 'Free', icon: <Zap size={17} />,
    monthlyPrice: 0, annualPrice: 0, color: '#6b7280',
    highlighted: false,
    features: [
      '1 cluster connection',
      '50 AI requests / day',
      '3 pipeline runs / day',
      'Generate & Diagnose modes',
      'Community support',
      '7-day history',
    ],
    cta: 'Current plan',
  },
  {
    id: 'pro', name: 'Pro', icon: <Shield size={17} />,
    monthlyPrice: 49, annualPrice: 39, color: V.accentLight,
    badge: 'Most Popular', highlighted: true,
    features: [
      '5 cluster connections',
      'Unlimited AI requests',
      'Unlimited pipeline runs',
      'Design & Monitor modes',
      'Custom model endpoints (Ollama)',
      'API key access',
      '90-day history',
      'Priority email support',
    ],
    cta: 'Upgrade to Pro',
  },
  {
    id: 'team', name: 'Team', icon: <Users size={17} />,
    monthlyPrice: 199, annualPrice: 169, color: '#a78bfa',
    badge: 'New', highlighted: false,
    features: [
      '15 cluster connections',
      'Up to 10 team seats (RBAC)',
      'Unlimited everything',
      'Vault & ArgoCD integrations',
      'Slack notifications',
      'Audit log (1-year retention)',
      'SSO / Google / GitHub IdP',
      '365-day history',
    ],
    cta: 'Upgrade to Team',
  },
  {
    id: 'enterprise', name: 'Enterprise', icon: <Building2 size={17} />,
    monthlyPrice: 0, annualPrice: 0, color: V.yellow,
    highlighted: false,
    features: [
      'Unlimited clusters',
      'Unlimited team seats',
      'SAML / OIDC SSO',
      'On-premise deployment',
      'Dedicated Slack support',
      'SLA 99.9% uptime',
      'Custom AI fine-tuning',
      'Compliance & SOC2 exports',
    ],
    cta: 'Contact Sales',
  },
];

const COMPARISON_ROWS = [
  { label: 'Clusters', free: '1', pro: '5', team: '15', enterprise: 'Unlimited' },
  { label: 'AI requests / day', free: '50', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
  { label: 'Pipeline runs / day', free: '3', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
  { label: 'Design mode', free: false, pro: true, team: true, enterprise: true },
  { label: 'Monitor mode', free: false, pro: true, team: true, enterprise: true },
  { label: 'Custom model (Ollama)', free: false, pro: true, team: true, enterprise: true },
  { label: 'API keys', free: false, pro: true, team: true, enterprise: true },
  { label: 'Team seats', free: '1', pro: '1', team: '10', enterprise: 'Unlimited' },
  { label: 'Audit log', free: false, pro: false, team: true, enterprise: true },
  { label: 'RBAC', free: false, pro: false, team: true, enterprise: true },
  { label: 'SSO / IdP', free: false, pro: false, team: true, enterprise: true },
  { label: 'SAML / OIDC', free: false, pro: false, team: false, enterprise: true },
  { label: 'On-premise', free: false, pro: false, team: false, enterprise: true },
  { label: 'SLA', free: false, pro: false, team: false, enterprise: true },
  { label: 'History retention', free: '7 days', pro: '90 days', team: '365 days', enterprise: 'Unlimited' },
];

const SOCIAL_PROOF = [
  { name: 'Rohan M.', role: 'Platform Engineer', text: 'Cut our deployment review time by 70%. The pipeline generator is exactly what we needed.' },
  { name: 'Sarah K.', role: 'DevOps Lead', text: 'Finally a tool that actually understands Kubernetes. The diagnose mode alone is worth it.' },
  { name: 'Alex T.', role: 'SRE', text: 'We resolved a prod incident in under 2 minutes. The AI root cause analysis just got it immediately.' },
];

const FAQS = [
  { q: 'Can I upgrade or downgrade at any time?', a: 'Yes. Upgrades take effect immediately and you\'re prorated for the remainder of the billing period. Downgrades take effect at the end of your current billing cycle, so you keep access to all features until then.' },
  { q: 'What happens to my data if I cancel?', a: 'Your workspace data (clusters, pipeline history, audit logs) is retained for 30 days after cancellation. You can export everything before it\'s removed.' },
  { q: 'Is there a free trial for Pro or Team?', a: 'The Free tier lets you fully evaluate all core modes before committing. Design and Monitor mode previews are available for 3 runs on Free.' },
  { q: 'Can I use my own AI model on the Free plan?', a: 'Custom model endpoints (your own Ollama, vLLM, or RunPod URL) require Pro or above. On Free, all requests go through our shared model.' },
  { q: 'How does the Team plan differ from Pro?', a: 'Team adds multi-user collaboration: up to 10 seats with Owner/Admin/Member/Viewer roles, shared cluster connections, pipeline approval workflows, audit logging, SSO, and Slack notifications. Pro is a single-user plan.' },
  { q: 'Do you offer annual billing discounts?', a: 'Yes — annual billing saves you ~20%. Pro drops from $49/mo to $39/mo (saves $120/year). Team drops from $199/mo to $169/mo (saves $360/year).' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${V.border}` }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 0', background: 'none', border: 'none', cursor: 'pointer', color: V.text, fontSize: '0.875rem', fontWeight: 500, textAlign: 'left', gap: 12 }}>
        {q}
        <ChevronRight size={15} color={V.muted} style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && <p style={{ margin: '0 0 0.9rem', color: V.muted, fontSize: '0.85rem', lineHeight: 1.65 }}>{a}</p>}
    </div>
  );
}

function CompCell({ val, color }: { val: string | boolean; color: string }) {
  if (typeof val === 'boolean') {
    return val
      ? <div style={{ display: 'flex', justifyContent: 'center' }}><Check size={14} color={color} /></div>
      : <div style={{ display: 'flex', justifyContent: 'center' }}><X size={13} color='#3a3a4a' /></div>;
  }
  return <div style={{ textAlign: 'center', color: V.muted, fontSize: '0.8rem' }}>{val}</div>;
}

export default function SubscriptionPage() {
  const { plan: currentPlan, setProfile } = useProfileStore();
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const currentPlanData = PLANS.find((p) => p.id === currentPlan) ?? PLANS[0];

  function displayPrice(p: Plan) {
    if (p.id === 'enterprise') return 'Custom';
    if (p.id === 'free') return '$0';
    return billing === 'annual' ? `$${p.annualPrice}` : `$${p.monthlyPrice}`;
  }

  function handleSelect(p: Plan) {
    if (p.id === currentPlan) return;
    if (p.id === 'enterprise') {
      window.open('mailto:sales@infrapilot.io?subject=Enterprise+Inquiry', '_blank');
      return;
    }
    setUpgrading(p.id);
    setTimeout(() => {
      setProfile({ plan: p.id as 'free' | 'pro' | 'team' | 'enterprise' });
      setUpgrading(null);
    }, 900);
  }

  const planColors: Record<string, string> = {
    free: '#6b7280',
    pro: V.accentLight,
    team: '#a78bfa',
    enterprise: V.yellow,
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '2rem 1.5rem', color: V.text }}>

      {/* ── Header ── */}
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: `${V.accent}14`, border: `1px solid ${V.accent}28`, borderRadius: 20, padding: '4px 14px', marginBottom: 16 }}>
          <Sparkles size={12} color={V.accentLight} />
          <span style={{ fontSize: '0.78rem', color: V.accentLight, fontWeight: 600 }}>Simple, transparent pricing</span>
        </div>
        <h1 style={{ margin: '0 0 0.625rem', fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.1rem)', lineHeight: 1.2 }}>
          The right plan for your<br />
          <span style={{ background: `linear-gradient(90deg, ${V.accent}, ${V.purple})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            infrastructure team
          </span>
        </h1>
        <p style={{ margin: '0 auto 1.5rem', color: V.muted, fontSize: '0.9rem', maxWidth: 480 }}>
          From solo engineers to enterprise platforms — InfraPilot scales with your workflow.
        </p>

        {/* Billing toggle */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: V.surface2, border: `1px solid ${V.border}`, borderRadius: 12, padding: '0.25rem' }}>
          {(['monthly', 'annual'] as const).map((b) => (
            <button key={b} type="button" onClick={() => setBilling(b)}
              style={{ padding: '0.45rem 1.25rem', borderRadius: 9, border: 'none', background: billing === b ? V.accent : 'transparent', color: billing === b ? '#fff' : V.muted, cursor: 'pointer', fontSize: '0.85rem', fontWeight: billing === b ? 700 : 400, transition: 'all 0.2s' }}>
              {b.charAt(0).toUpperCase() + b.slice(1)}
              {b === 'annual' && billing !== 'annual' && (
                <span style={{ marginLeft: 6, fontSize: '0.68rem', background: 'rgba(63,185,80,0.15)', color: V.green, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>−20%</span>
              )}
            </button>
          ))}
        </div>
        {billing === 'annual' && (
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: '0.78rem', color: V.green }}>Annual billing — save up to $360/year</p>
        )}
      </div>

      {/* ── Plan cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.875rem', marginBottom: '2rem', alignItems: 'start' }}>
        {PLANS.map((p) => {
          const isCurrent = p.id === currentPlan;
          const isUpgrading = upgrading === p.id;
          return (
            <div key={p.id} style={{
              background: V.surface,
              border: `1px solid ${isCurrent ? planColors[p.id] + '88' : p.highlighted ? `${planColors[p.id]}40` : V.border}`,
              borderRadius: 14, padding: '1.25rem', position: 'relative', display: 'flex', flexDirection: 'column',
              boxShadow: p.highlighted ? `0 0 28px ${planColors[p.id]}12` : 'none',
            }}>
              {p.badge && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: p.highlighted ? planColors[p.id] : V.surface2, color: p.highlighted ? '#fff' : planColors[p.id], border: `1px solid ${planColors[p.id]}50`, borderRadius: 20, padding: '3px 12px', fontSize: '0.67rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {p.badge}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.875rem' }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: `${planColors[p.id]}18`, border: `1px solid ${planColors[p.id]}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: planColors[p.id] }}>
                  {p.icon}
                </div>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{p.name}</span>
                {isCurrent && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.6rem', fontWeight: 700, color: planColors[p.id], background: `${planColors[p.id]}18`, border: `1px solid ${planColors[p.id]}30`, borderRadius: 4, padding: '2px 6px' }}>ACTIVE</span>
                )}
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '1.7rem', fontWeight: 800, lineHeight: 1 }}>
                  {displayPrice(p)}
                  {p.id !== 'enterprise' && p.id !== 'free' && (
                    <span style={{ fontSize: '0.78rem', fontWeight: 400, color: V.muted }}>/mo</span>
                  )}
                </div>
                {billing === 'annual' && p.id !== 'free' && p.id !== 'enterprise' && (
                  <div style={{ fontSize: '0.71rem', color: V.green, marginTop: 3 }}>Billed annually · ${p.annualPrice * 12}/yr</div>
                )}
                {billing === 'monthly' && p.id !== 'free' && p.id !== 'enterprise' && (
                  <div style={{ fontSize: '0.71rem', color: V.muted, marginTop: 3 }}>${p.annualPrice}/mo billed annually</div>
                )}
                {p.id === 'enterprise' && (
                  <div style={{ fontSize: '0.71rem', color: V.muted, marginTop: 3 }}>Contact for pricing</div>
                )}
                {p.id === 'free' && (
                  <div style={{ fontSize: '0.71rem', color: V.muted, marginTop: 3 }}>Forever free</div>
                )}
              </div>

              <ul style={{ listStyle: 'none', margin: '0 0 1.25rem', padding: 0, display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: '0.78rem' }}>
                    <Check size={11} color={planColors[p.id]} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ color: V.muted, lineHeight: 1.45 }}>{f}</span>
                  </li>
                ))}
              </ul>

              <button type="button" disabled={isCurrent || isUpgrading} onClick={() => handleSelect(p)}
                style={{
                  width: '100%', padding: '0.575rem', borderRadius: 8,
                  border: isCurrent ? `1px solid ${planColors[p.id]}44` : 'none',
                  background: isCurrent ? 'transparent' : p.highlighted ? `linear-gradient(135deg, ${V.accent}, ${V.accentLight})` : planColors[p.id],
                  color: isCurrent ? planColors[p.id] : '#fff',
                  cursor: isCurrent ? 'default' : 'pointer', fontSize: '0.82rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  opacity: isUpgrading ? 0.7 : 1,
                  boxShadow: p.highlighted && !isCurrent ? `0 3px 10px ${V.accent}38` : 'none',
                } as React.CSSProperties}>
                {isUpgrading ? 'Switching…' : p.cta}
                {!isCurrent && !isUpgrading && <ChevronRight size={12} />}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Social proof ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.875rem', marginBottom: '2.5rem' }}>
        {SOCIAL_PROOF.map((s) => (
          <div key={s.name} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1rem 1.125rem' }}>
            <div style={{ display: 'flex', gap: 3, marginBottom: '0.625rem' }}>
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={11} color={V.yellow} fill={V.yellow} />)}
            </div>
            <p style={{ margin: '0 0 0.75rem', color: V.text, fontSize: '0.83rem', lineHeight: 1.55, fontStyle: 'italic' }}>"{s.text}"</p>
            <div style={{ color: V.muted, fontSize: '0.73rem' }}>
              <strong style={{ color: V.text }}>{s.name}</strong> · {s.role}
            </div>
          </div>
        ))}
      </div>

      {/* ── Comparison table toggle ── */}
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <button type="button" onClick={() => setShowComparison((v) => !v)}
          style={{ background: 'none', border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.5rem 1.25rem', color: V.muted, cursor: 'pointer', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          {showComparison ? 'Hide' : 'Show'} full comparison table
          {showComparison ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* ── Comparison table ── */}
      {showComparison && (
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: '2.5rem' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: V.surface2 }}>
                  <th style={{ padding: '0.75rem 1.25rem', textAlign: 'left', color: V.muted, fontWeight: 500, borderBottom: `1px solid ${V.border}` }}>Feature</th>
                  {PLANS.map((p) => (
                    <th key={p.id} style={{ padding: '0.75rem', textAlign: 'center', color: p.highlighted ? planColors[p.id] : V.muted, fontWeight: p.highlighted ? 700 : 500, borderBottom: `1px solid ${V.border}`, whiteSpace: 'nowrap' }}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr key={row.label} style={{ borderBottom: i < COMPARISON_ROWS.length - 1 ? `1px solid ${V.border}18` : 'none', background: i % 2 === 0 ? 'transparent' : `${V.surface2}60` }}>
                    <td style={{ padding: '0.55rem 1.25rem', color: V.text }}>{row.label}</td>
                    <td style={{ padding: '0.55rem' }}><CompCell val={row.free} color={planColors.free} /></td>
                    <td style={{ padding: '0.55rem' }}><CompCell val={row.pro} color={planColors.pro} /></td>
                    <td style={{ padding: '0.55rem' }}><CompCell val={row.team} color={planColors.team} /></td>
                    <td style={{ padding: '0.55rem' }}><CompCell val={row.enterprise} color={planColors.enterprise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Current subscription ── */}
      <div style={{ background: V.surface, border: `1px solid ${planColors[currentPlan] ?? V.border}44`, borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={15} color={V.accent} />
            <h3 style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>Current Subscription</h3>
          </div>
          {currentPlan !== 'free' && (
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: V.muted, fontSize: '0.78rem', textDecoration: 'underline' }}>
              Cancel plan
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
          {[
            { label: 'Plan', value: currentPlanData.name },
            { label: 'Billing', value: currentPlan === 'free' ? '—' : billing === 'annual' ? 'Annual' : 'Monthly' },
            { label: 'Price', value: currentPlan === 'free' ? '$0 / month' : billing === 'annual' ? `$${currentPlanData.annualPrice}/mo` : `$${currentPlanData.monthlyPrice}/mo` },
            { label: 'Payment method', value: currentPlan === 'free' ? 'No card on file' : '•••• 4242' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: V.surface2, borderRadius: 8, padding: '0.75rem' }}>
              <div style={{ color: V.muted, fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
              <div style={{ color: V.text, fontSize: '0.85rem', fontWeight: 500 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Usage bars — free plan only */}
        {currentPlan === 'free' && (
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {[
              { label: 'AI requests today', used: 12, limit: 50, color: V.accentLight },
              { label: 'Pipeline runs today', used: 1, limit: 3, color: V.purple },
              { label: 'Diagnose runs today', used: 0, limit: 3, color: V.green },
            ].map((u) => (
              <div key={u.label} style={{ background: V.surface2, borderRadius: 8, padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: V.muted, marginBottom: 6 }}>
                  <span>{u.label}</span>
                  <span style={{ color: u.used >= u.limit ? V.red : V.text, fontWeight: 600 }}>{u.used}/{u.limit}</span>
                </div>
                <div style={{ height: 4, background: V.border, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (u.used / u.limit) * 100)}%`, background: u.used >= u.limit ? V.red : u.color, borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Billing history ── */}
      {currentPlan !== 'free' ? (
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: '2.5rem' }}>
          <div style={{ padding: '0.875rem 1.25rem', borderBottom: `1px solid ${V.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>Billing History</h3>
            <button type="button" style={{ background: 'none', border: `1px solid ${V.border}`, borderRadius: 6, padding: '3px 10px', color: V.muted, cursor: 'pointer', fontSize: '0.75rem' }}>
              Download CSV
            </button>
          </div>
          <div style={{ padding: '2rem', textAlign: 'center', color: V.muted, fontSize: '0.85rem' }}>
            Your billing history will appear here after your first payment.
          </div>
        </div>
      ) : (
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.5rem', marginBottom: '2.5rem', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 9, background: `${V.accent}14`, border: `1px solid ${V.accent}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: V.accent, flexShrink: 0 }}>
            <CreditCard size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 3px', fontWeight: 600, fontSize: '0.875rem', color: V.text }}>No billing history</p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: V.muted }}>You're on the Free plan. Upgrade to Pro or Team to access all features.</p>
          </div>
          <button type="button" onClick={() => handleSelect(PLANS[1])}
            style={{ padding: '0.5rem 1.25rem', background: V.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
            Upgrade to Pro <ChevronRight size={12} />
          </button>
        </div>
      )}

      {/* ── FAQ ── */}
      <div style={{ maxWidth: 660, margin: '0 auto 3rem' }}>
        <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: '1.2rem', marginBottom: '1.5rem' }}>Frequently asked questions</h2>
        {FAQS.map((faq) => (
          <FaqItem key={faq.q} q={faq.q} a={faq.a} />
        ))}
      </div>

      {/* ── Enterprise CTA ── */}
      <div style={{ background: `linear-gradient(135deg, ${V.accent}12, ${V.purple}12)`, border: `1px solid ${V.accent}20`, borderRadius: 14, padding: '2rem', textAlign: 'center' }}>
        <Building2 size={28} style={{ color: V.accent, marginBottom: 12 }} />
        <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '1.1rem' }}>Need a custom solution?</h3>
        <p style={{ margin: '0 0 1.25rem', color: V.muted, fontSize: '0.875rem', maxWidth: 480, marginInline: 'auto' }}>
          Enterprise plans include on-premise deployment, custom AI fine-tuning, SAML SSO, and dedicated support scoped to your exact infrastructure requirements.
        </p>
        <button type="button" onClick={() => window.open('mailto:sales@infrapilot.io?subject=Enterprise+Inquiry', '_blank')}
          style={{ background: `linear-gradient(135deg, ${V.accent}, ${V.accentLight})`, border: 'none', borderRadius: 8, padding: '0.65rem 1.75rem', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 700, boxShadow: `0 4px 14px ${V.accent}38` }}>
          Talk to Sales
        </button>
      </div>
    </div>
  );
}
