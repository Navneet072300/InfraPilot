import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, Zap, Shield, Users, Building2, CreditCard, ChevronRight, Star } from 'lucide-react';
import { useProfileStore } from '../store/profileStore';

const V = {
  bg: '#0a0a0f', surface: '#141419', surface2: '#1a1a21', border: '#2a2a35',
  text: '#e6edf3', muted: '#8b949e', accent: '#4f46e5', accentLight: '#6366f1',
  green: '#3fb950', red: '#f85149', yellow: '#d29922', purple: '#bc8cff',
} as const;

type BillingCycle = 'monthly' | 'annual';

interface Plan {
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

const PLANS: Plan[] = [
  {
    id: 'free', name: 'Free', icon: <Zap size={18} />,
    monthlyPrice: 0, annualPrice: 0, color: V.muted,
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
    id: 'pro', name: 'Pro', icon: <Shield size={18} />,
    monthlyPrice: 49, annualPrice: 39, color: V.accentLight,
    badge: 'Most Popular', highlighted: true,
    features: [
      '5 cluster connections',
      'Unlimited AI requests',
      'Unlimited pipeline runs',
      'Design & Monitor modes unlocked',
      'Custom model endpoints (Ollama)',
      'API key access',
      '90-day history',
      'Priority email support',
    ],
    cta: 'Upgrade to Pro',
  },
  {
    id: 'team', name: 'Team', icon: <Users size={18} />,
    monthlyPrice: 199, annualPrice: 169, color: V.purple,
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
    id: 'enterprise', name: 'Enterprise', icon: <Building2 size={18} />,
    monthlyPrice: 999, annualPrice: 999, color: V.yellow,
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
  { name: 'Rohan M.', role: 'Platform Engineer @ Zepto', text: 'Cut our deployment review time by 70%. The pipeline generator is insane.' },
  { name: 'Sarah K.', role: 'DevOps Lead @ Razorpay', text: 'Finally a tool that actually understands Kubernetes. Worth every rupee.' },
  { name: 'Alex T.', role: 'SRE @ Groww', text: 'We diagnosed a prod incident in 2 minutes. The AI just got it immediately.' },
];

const FAQS = [
  { q: 'Can I upgrade or downgrade at any time?', a: 'Yes. Upgrades take effect immediately and you\'re prorated for the remainder of the billing period. Downgrades take effect at the end of your current billing cycle, so you keep access to all features until then.' },
  { q: 'What happens to my data if I cancel?', a: 'Your workspace data (clusters, pipeline history, audit logs) is retained for 30 days after cancellation. You can export everything via the Audit Log CSV export before it\'s deleted.' },
  { q: 'Is there a free trial for Pro or Team?', a: 'We don\'t offer a time-limited trial, but the Free tier lets you fully evaluate all core modes (Pipeline, Generate, Diagnose) before committing. Design and Monitor mode previews are available for 3 runs on Free.' },
  { q: 'Can I use my own AI model on the Free plan?', a: 'Custom model endpoints (your own Ollama, vLLM, or RunPod URL) require Pro or above. On Free, all requests go through our shared Ollama deployment.' },
  { q: 'How does the Team plan differ from Pro?', a: 'Team adds multi-user collaboration: up to 10 seats with Owner/Admin/Member/Viewer roles, shared cluster connections, pipeline approval workflows, audit logging, SSO, and Slack notifications. Pro is a single-user plan.' },
  { q: 'Do you offer annual billing discounts?', a: 'Yes — annual billing saves you ~20%. Pro drops from $49/mo to $39/mo (saves $120/year). Team drops from $199/mo to $169/mo (saves $360/year). Switch at any time in billing settings.' },
];

const BILLING_HISTORY = [
  { date: 'Jun 1, 2026', desc: 'Pro Plan — Monthly', amount: '$49.00', status: 'Paid' },
  { date: 'May 1, 2026', desc: 'Pro Plan — Monthly', amount: '$49.00', status: 'Paid' },
  { date: 'Apr 1, 2026', desc: 'Pro Plan — Monthly', amount: '$49.00', status: 'Paid' },
  { date: 'Mar 1, 2026', desc: 'Pro Plan — Monthly', amount: '$49.00', status: 'Paid' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${V.border}` }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '1rem 0', background: 'none', border: 'none', cursor: 'pointer',
          color: V.text, fontSize: '0.9rem', fontWeight: 500, textAlign: 'left', gap: 12,
        }}
      >
        {q}
        {open ? <ChevronUp size={16} color={V.muted} style={{ flexShrink: 0 }} /> : <ChevronDown size={16} color={V.muted} style={{ flexShrink: 0 }} />}
      </button>
      {open && (
        <p style={{ margin: '0 0 1rem', color: V.muted, fontSize: '0.85rem', lineHeight: 1.65 }}>{a}</p>
      )}
    </div>
  );
}

function CompCell({ val, color }: { val: string | boolean; color: string }) {
  if (typeof val === 'boolean') {
    return val
      ? <div style={{ display: 'flex', justifyContent: 'center' }}><Check size={15} color={color} /></div>
      : <div style={{ display: 'flex', justifyContent: 'center' }}><X size={14} color='#3a3a4a' /></div>;
  }
  return <div style={{ textAlign: 'center', color: V.muted, fontSize: '0.8rem' }}>{val}</div>;
}

export default function SubscriptionPage() {
  const { plan: currentPlan, setProfile } = useProfileStore();
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

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
      setProfile({ plan: p.id as any });
      setUpgrading(null);
    }, 900);
  }

  const planColors: Record<string, string> = { free: V.muted, pro: V.accentLight, team: V.purple, enterprise: V.yellow };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem', color: V.text }}>

      {/* ── Header ── */}
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: `${V.accent}18`, border: `1px solid ${V.accent}33`, borderRadius: 20, padding: '4px 14px', marginBottom: 16 }}>
          <Star size={12} color={V.accentLight} fill={V.accentLight} />
          <span style={{ fontSize: '0.78rem', color: V.accentLight, fontWeight: 600 }}>Simple, transparent pricing</span>
        </div>
        <h1 style={{ margin: '0 0 0.625rem', fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.25rem)', lineHeight: 1.2 }}>
          The right plan for<br />
          <span style={{ background: `linear-gradient(90deg, ${V.accent}, ${V.purple})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            your infrastructure
          </span>
        </h1>
        <p style={{ margin: '0 auto 1.5rem', color: V.muted, fontSize: '0.95rem', maxWidth: 520 }}>
          From solo engineers to enterprise platforms — InfraPilot scales with your team.
        </p>

        {/* Billing toggle */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: V.surface2, border: `1px solid ${V.border}`, borderRadius: 12, padding: '0.25rem' }}>
          {(['monthly', 'annual'] as const).map((b) => (
            <button key={b} type="button" onClick={() => setBilling(b)}
              style={{
                padding: '0.45rem 1.25rem', borderRadius: 9, border: 'none',
                background: billing === b ? V.accent : 'transparent',
                color: billing === b ? '#fff' : V.muted,
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: billing === b ? 700 : 400,
                transition: 'all 0.2s',
              }}>
              {b.charAt(0).toUpperCase() + b.slice(1)}
              {b === 'annual' && billing !== 'annual' && (
                <span style={{ marginLeft: 6, fontSize: '0.68rem', background: 'rgba(63,185,80,0.15)', color: V.green, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                  −20%
                </span>
              )}
            </button>
          ))}
        </div>
        {billing === 'annual' && (
          <div style={{ marginTop: 8, fontSize: '0.78rem', color: V.green }}>
            Annual billing — save up to $360/year
          </div>
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
              border: `1px solid ${isCurrent ? p.color : p.highlighted ? `${p.color}44` : V.border}`,
              borderRadius: 14, padding: '1.25rem', position: 'relative', display: 'flex', flexDirection: 'column',
              boxShadow: p.highlighted ? `0 0 32px ${p.color}14` : 'none',
            }}>
              {p.badge && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: p.highlighted ? p.color : V.surface2, color: p.highlighted ? '#fff' : p.color, border: `1px solid ${p.color}55`, borderRadius: 20, padding: '3px 11px', fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {p.badge}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.875rem' }}>
                <span style={{ color: p.color }}>{p.icon}</span>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{p.name}</span>
                {isCurrent && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700, color: p.color, background: `${p.color}18`, border: `1px solid ${p.color}33`, borderRadius: 4, padding: '2px 6px' }}>ACTIVE</span>
                )}
              </div>

              {/* Price with transition */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1, transition: 'all 0.3s ease' }}>
                  {displayPrice(p)}
                  {p.id !== 'enterprise' && p.id !== 'free' && (
                    <span style={{ fontSize: '0.8rem', fontWeight: 400, color: V.muted }}>/mo</span>
                  )}
                </div>
                {billing === 'annual' && p.id !== 'free' && p.id !== 'enterprise' && (
                  <div style={{ fontSize: '0.72rem', color: V.green, marginTop: 2 }}>
                    Billed annually · ${p.annualPrice * 12}/yr
                  </div>
                )}
                {billing === 'monthly' && p.id !== 'free' && p.id !== 'enterprise' && (
                  <div style={{ fontSize: '0.72rem', color: V.muted, marginTop: 2 }}>
                    ${p.annualPrice}/mo billed annually
                  </div>
                )}
                {p.id === 'enterprise' && (
                  <div style={{ fontSize: '0.72rem', color: V.muted, marginTop: 2 }}>Contact for pricing</div>
                )}
              </div>

              <ul style={{ listStyle: 'none', margin: '0 0 1.25rem', padding: 0, display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: '0.78rem' }}>
                    <Check size={12} color={p.color} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ color: V.muted, lineHeight: 1.4 }}>{f}</span>
                  </li>
                ))}
              </ul>

              <button type="button" disabled={isCurrent || isUpgrading} onClick={() => handleSelect(p)}
                style={{
                  width: '100%', padding: '0.575rem', borderRadius: 8, border: isCurrent ? `1px solid ${p.color}44` : 'none',
                  background: isCurrent ? 'transparent' : p.highlighted ? `linear-gradient(135deg, ${V.accent}, ${V.accentLight})` : p.color,
                  color: isCurrent ? p.color : '#fff',
                  cursor: isCurrent ? 'default' : 'pointer', fontSize: '0.825rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  opacity: isUpgrading ? 0.7 : 1, transition: 'opacity 0.2s',
                  boxShadow: p.highlighted && !isCurrent ? `0 3px 12px ${V.accent}44` : 'none',
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
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={12} color={V.yellow} fill={V.yellow} />)}
            </div>
            <p style={{ margin: '0 0 0.75rem', color: V.text, fontSize: '0.83rem', lineHeight: 1.55, fontStyle: 'italic' }}>
              "{s.text}"
            </p>
            <div style={{ color: V.muted, fontSize: '0.75rem' }}>
              <strong style={{ color: V.text }}>{s.name}</strong> · {s.role}
            </div>
          </div>
        ))}
      </div>

      {/* ── Comparison table toggle ── */}
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <button type="button" onClick={() => setShowComparison((v) => !v)}
          style={{ background: 'none', border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.5rem 1.25rem', color: V.muted, cursor: 'pointer', fontSize: '0.83rem', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          {showComparison ? 'Hide' : 'Show'} full comparison table
          {showComparison ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* ── Comparison table ── */}
      {showComparison && (
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: '2.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: V.surface2 }}>
                <th style={{ padding: '0.75rem 1.25rem', textAlign: 'left', color: V.muted, fontWeight: 500, borderBottom: `1px solid ${V.border}` }}>Feature</th>
                {PLANS.map((p) => (
                  <th key={p.id} style={{ padding: '0.75rem', textAlign: 'center', color: p.highlighted ? p.color : V.muted, fontWeight: p.highlighted ? 700 : 500, borderBottom: `1px solid ${V.border}` }}>
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
      )}

      {/* ── Current subscription ── */}
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={16} color={V.accent} />
            <h3 style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>Current Subscription</h3>
          </div>
          {currentPlan !== 'free' && (
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: V.muted, fontSize: '0.78rem' }}>
              Cancel plan
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
          {[
            { label: 'Plan', value: PLANS.find((p) => p.id === currentPlan)?.name ?? 'Free' },
            { label: 'Billing', value: currentPlan === 'free' ? '—' : billing === 'annual' ? 'Annual' : 'Monthly' },
            { label: currentPlan === 'free' ? 'Price' : 'Next renewal', value: currentPlan === 'free' ? '$0 / month' : `Jul 29, 2026` },
            { label: 'Payment method', value: currentPlan === 'free' ? '—' : '•••• •••• •••• 4242' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: V.surface2, borderRadius: 8, padding: '0.75rem' }}>
              <div style={{ color: V.muted, fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
              <div style={{ color: V.text, fontSize: '0.85rem', fontWeight: 500 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Usage bars for free plan */}
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
                  <div style={{ height: '100%', width: `${Math.min(100, (u.used / u.limit) * 100)}%`, background: u.used >= u.limit ? V.red : u.color, borderRadius: 2, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Billing history ── */}
      {currentPlan !== 'free' && (
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: '2.5rem' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: `1px solid ${V.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>Billing History</h3>
            <button type="button" style={{ background: 'none', border: `1px solid ${V.border}`, borderRadius: 6, padding: '3px 10px', color: V.muted, cursor: 'pointer', fontSize: '0.75rem' }}>
              Download CSV
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: V.surface2 }}>
                {['Date', 'Description', 'Amount', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '0.625rem 1.25rem', textAlign: 'left', color: V.muted, fontWeight: 500, borderBottom: `1px solid ${V.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BILLING_HISTORY.map((row, i) => (
                <tr key={i} style={{ borderBottom: i < BILLING_HISTORY.length - 1 ? `1px solid ${V.border}15` : 'none' }}>
                  <td style={{ padding: '0.625rem 1.25rem', color: V.muted }}>{row.date}</td>
                  <td style={{ padding: '0.625rem 1.25rem', color: V.text }}>{row.desc}</td>
                  <td style={{ padding: '0.625rem 1.25rem', color: V.text, fontWeight: 600 }}>{row.amount}</td>
                  <td style={{ padding: '0.625rem 1.25rem' }}>
                    <span style={{ background: 'rgba(63,185,80,0.1)', color: V.green, borderRadius: 4, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700 }}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── FAQ ── */}
      <div style={{ maxWidth: 680, margin: '0 auto 3rem' }}>
        <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: '1.3rem', marginBottom: '1.5rem' }}>Frequently asked questions</h2>
        {FAQS.map((faq) => (
          <FaqItem key={faq.q} q={faq.q} a={faq.a} />
        ))}
      </div>

      {/* ── Enterprise CTA strip ── */}
      <div style={{ background: `linear-gradient(135deg, ${V.accent}14, ${V.purple}14)`, border: `1px solid ${V.accent}22`, borderRadius: 14, padding: '2rem', textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '1.15rem' }}>Need a custom solution?</h3>
        <p style={{ margin: '0 0 1.25rem', color: V.muted, fontSize: '0.875rem' }}>
          Enterprise plans include on-premise deployment, custom AI fine-tuning, SAML SSO, and dedicated support.<br />
          We'll scope a plan around your exact infrastructure requirements.
        </p>
        <button type="button"
          onClick={() => window.open('mailto:sales@infrapilot.io?subject=Enterprise+Inquiry', '_blank')}
          style={{ background: `linear-gradient(135deg, ${V.accent}, ${V.accentLight})`, border: 'none', borderRadius: 8, padding: '0.65rem 1.75rem', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, boxShadow: `0 4px 14px ${V.accent}44` }}>
          Talk to Sales
        </button>
      </div>
    </div>
  );
}
