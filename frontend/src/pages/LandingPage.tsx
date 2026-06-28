import { useNavigate } from 'react-router-dom';
import { Rocket, Wand2, Stethoscope, Compass, Activity, ArrowRight, CheckCircle2, Check, Zap, Shield, Users, Building2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

const FEATURES = [
  { icon: <Rocket size={20} />, title: 'Pipeline', desc: 'Git repo to live URL in one shot. AI generates CI, K8s manifests, secrets, DNS — then deploys and troubleshoots automatically.', color: '#6366f1', badge: 'Hero feature' },
  { icon: <Wand2 size={20} />, title: 'Generate', desc: 'Natural language to production-ready IaC. Terraform, Kustomize, Helm, Ansible — all from one prompt with cluster context.', color: '#3b82f6' },
  { icon: <Stethoscope size={20} />, title: 'Diagnose', desc: 'Paste logs or pull live pod data. AI-powered root cause analysis with diff views and runbook generation.', color: '#22c55e' },
  { icon: <Compass size={20} />, title: 'Design', desc: 'Architecture diagrams, cost estimates, compliance checks. Interactive React Flow canvas with Terraform output.', color: '#8b5cf6' },
  { icon: <Activity size={20} />, title: 'Monitor', desc: 'Live cluster health, cost anomaly detection, infrastructure drift scanning. 30-second polling, no agents needed.', color: '#f97316' },
];

const PIPELINE_TASKS = [
  { n: 1, label: 'Analyze GitHub repo', done: true },
  { n: 2, label: 'Generate CI pipeline', done: true },
  { n: 3, label: 'Generate K8s manifests', done: true },
  { n: 4, label: 'Write Vault secrets', done: true, stubbed: true },
  { n: 5, label: 'Write Vault policy', done: true, stubbed: true },
  { n: 6, label: 'Push to GitOps repo', done: true },
  { n: 7, label: 'Configure ArgoCD', done: false, running: true },
  { n: 8, label: 'Watch rollout', done: false },
  { n: 9, label: 'Auto-troubleshoot', done: false },
  { n: 10, label: 'Expose service', done: false },
  { n: 11, label: 'Configure DNS', done: false, stubbed: true },
];

const PLANS = [
  {
    id: 'free', name: 'Free', icon: <Zap size={18} />, price: '$0', annualPrice: '$0', color: '#8b949e', popular: false,
    features: ['1 cluster', '50 AI requests / day', '3 pipeline runs / day', 'Pipeline, Generate, Diagnose', 'Community support', '7-day history'],
    cta: 'Get started free',
  },
  {
    id: 'pro', name: 'Pro', icon: <Shield size={18} />, price: '$49', annualPrice: '$39', color: '#4f46e5', popular: true,
    features: ['5 clusters', 'Unlimited AI requests', 'All 5 modes: Design + Monitor', 'Custom model endpoints', 'API key access', '90-day history'],
    cta: 'Start with Pro',
  },
  {
    id: 'team', name: 'Team', icon: <Users size={18} />, price: '$199', annualPrice: '$169', color: '#bc8cff', popular: false,
    features: ['15 clusters', '10 team seats (RBAC)', 'Vault & ArgoCD integrations', 'Audit log + SSO', 'Slack notifications', '365-day history'],
    cta: 'Start with Team',
    badge: 'New',
  },
  {
    id: 'enterprise', name: 'Enterprise', icon: <Building2 size={18} />, price: 'Custom', annualPrice: 'Custom', color: '#d29922', popular: false,
    features: ['Unlimited clusters', 'Unlimited seats', 'SAML / OIDC SSO', 'On-premise deployment', 'SLA 99.9% + dedicated Slack', 'Custom AI fine-tuning'],
    cta: 'Contact Sales',
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, setDemoMode } = useAuthStore();
  const loggedIn = isAuthenticated();

  function handleGetStarted() {
    if (loggedIn) navigate('/app');
    else navigate('/signup');
  }

  function handleDemo() {
    setDemoMode(true);
    navigate('/app');
  }

  function handleOpenApp() {
    if (loggedIn) navigate('/app');
    else navigate('/login');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'Inter, sans-serif' }}>

      {/* Nav */}
      <nav style={{ height: '56px', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', padding: '0 40px', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(13,17,23,0.9)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: '#fff' }}>IP</div>
          <span style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '-0.01em' }}>InfraPilot</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!loggedIn && (
            <button onClick={() => navigate('/login')} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid #30363d', borderRadius: '7px', color: '#8b949e', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Sign in
            </button>
          )}
          <button onClick={handleOpenApp} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 18px', background: '#58a6ff', border: 'none', borderRadius: '7px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 16px rgba(88,166,255,0.3)' }}>
            {loggedIn ? 'Open App' : 'Get started'} <ArrowRight size={13} />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: '900px', margin: '0 auto', padding: '80px 40px 60px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '20px', fontSize: '12px', color: '#58a6ff', fontWeight: 600, marginBottom: '24px' }}>
          <Rocket size={11} /> AI-native DevOps workspace
        </div>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: '20px' }}>
          The DevOps Engineer<br />
          <span style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            on Your Team
          </span>
        </h1>
        <p style={{ fontSize: '18px', color: '#8b949e', lineHeight: 1.7, maxWidth: '600px', margin: '0 auto 32px' }}>
          InfraPilot turns a GitHub URL and a cluster name into a fully deployed application — CI pipeline, Kubernetes manifests, secrets, and DNS — in a single pipeline run.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleGetStarted}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 28px', background: '#58a6ff', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 24px rgba(88,166,255,0.35)' }}
          >
            Get started free <ArrowRight size={15} />
          </button>
          <button
            onClick={handleDemo}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 28px', background: 'transparent', border: '1px solid #30363d', borderRadius: '8px', color: '#8b949e', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            View demo
          </button>
        </div>
        <p style={{ marginTop: 14, color: '#8b949e', fontSize: 12 }}>No credit card required · Free forever plan available</p>
      </section>

      {/* Pipeline demo */}
      <section style={{ maxWidth: '680px', margin: '0 auto', padding: '0 40px 80px' }}>
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ marginLeft: '8px', fontSize: '12px', color: '#8b949e', fontFamily: 'JetBrains Mono, monospace' }}>infrapilot — pipeline: my-app → prod-eks</span>
          </div>
          <div style={{ padding: '16px' }}>
            {PIPELINE_TASKS.map((t) => (
              <div key={t.n} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: t.n < PIPELINE_TASKS.length ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <div style={{ width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, background: t.done ? '#3fb950' : t.running ? '#58a6ff' : '#21262d', border: `1px solid ${t.done ? '#3fb950' : t.running ? '#58a6ff' : '#30363d'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
                  {t.done ? <CheckCircle2 size={10} color="#fff" /> : t.running ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', display: 'block' }} /> : null}
                </div>
                <span style={{ fontSize: '12px', color: t.done ? '#8b949e' : t.running ? '#e6edf3' : '#6e7681', fontFamily: 'JetBrains Mono, monospace', flex: 1 }}>
                  {t.n.toString().padStart(2, '0')} {t.label}
                </span>
                {t.stubbed && <span style={{ fontSize: '9px', color: '#d29922', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 4px', borderRadius: '3px', fontWeight: 600 }}>STUBBED</span>}
                {t.running && <span style={{ fontSize: '11px', color: '#58a6ff' }}>running…</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 40px 80px' }}>
        <h2 style={{ textAlign: 'center', fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '40px' }}>Everything in one workspace</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '10px', padding: '20px', position: 'relative', borderTop: `2px solid ${f.color}` }}>
              {f.badge && <span style={{ position: 'absolute', top: '12px', right: '12px', fontSize: '10px', fontWeight: 700, color: f.color, background: `${f.color}18`, border: `1px solid ${f.color}44`, padding: '2px 6px', borderRadius: '4px' }}>{f.badge}</span>}
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${f.color}18`, border: `1px solid ${f.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.color, marginBottom: '12px' }}>{f.icon}</div>
              <p style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>{f.title}</p>
              <p style={{ fontSize: '13px', color: '#8b949e', lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ maxWidth: '960px', margin: '0 auto', padding: '0 40px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 12px' }}>Simple, transparent pricing</h2>
          <p style={{ color: '#8b949e', fontSize: 15, margin: 0 }}>Start free. Scale as you grow. No surprises.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.875rem' }}>
          {PLANS.map((p) => (
            <div key={p.id} style={{ background: '#141419', border: `1px solid ${p.popular ? p.color + '55' : '#2a2a35'}`, borderRadius: 14, padding: '1.25rem', position: 'relative', display: 'flex', flexDirection: 'column', boxShadow: p.popular ? `0 0 28px ${p.color}14` : 'none' }}>
              {p.popular && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: p.color, color: '#fff', borderRadius: 20, padding: '3px 12px', fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Most Popular
                </div>
              )}
              {'badge' in p && p.badge && !p.popular && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: '#141419', color: p.color, border: `1px solid ${p.color}55`, borderRadius: 20, padding: '3px 12px', fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {p.badge}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.875rem' }}>
                <span style={{ color: p.color }}>{p.icon}</span>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e6edf3' }}>{p.name}</span>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e6edf3' }}>{p.price}</span>
                {p.price !== 'Custom' && <span style={{ color: '#8b949e', fontSize: '0.75rem' }}>/mo</span>}
                {p.price !== 'Custom' && p.annualPrice !== p.price && (
                  <div style={{ fontSize: '0.68rem', color: '#3fb950', marginTop: 2 }}>{p.annualPrice}/mo billed annually</div>
                )}
                {p.id === 'free' && <div style={{ fontSize: '0.68rem', color: '#8b949e', marginTop: 2 }}>Free forever</div>}
              </div>
              <ul style={{ listStyle: 'none', margin: '0 0 1.25rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.78rem' }}>
                    <Check size={12} color={p.color} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ color: '#8b949e', lineHeight: 1.4 }}>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={p.id === 'enterprise' ? () => window.open('mailto:sales@infrapilot.io', '_blank') : handleGetStarted}
                style={{ width: '100%', padding: '0.55rem', borderRadius: 8, border: p.popular ? 'none' : `1px solid ${p.color}44`, background: p.popular ? `linear-gradient(135deg, #4f46e5, #6366f1)` : 'transparent', color: p.popular ? '#fff' : p.color, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, boxShadow: p.popular ? '0 3px 12px rgba(79,70,229,0.4)' : 'none' } as React.CSSProperties}
              >
                {p.cta} {p.id !== 'enterprise' && <ArrowRight size={12} />}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: '600px', margin: '0 auto', padding: '0 40px 100px', textAlign: 'center' }}>
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '16px', padding: '48px 40px' }}>
          <h2 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '12px' }}>Ready to ship faster?</h2>
          <p style={{ fontSize: '14px', color: '#8b949e', marginBottom: '28px', lineHeight: 1.7 }}>
            Connect your cluster and deploy your first app in under 5 minutes.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleGetStarted} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 32px', background: '#58a6ff', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 24px rgba(88,166,255,0.3)' }}>
              {loggedIn ? 'Go to app' : 'Start for free'} <ArrowRight size={15} />
            </button>
            <button onClick={handleDemo} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px', background: 'transparent', border: '1px solid #30363d', borderRadius: '8px', color: '#8b949e', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Try demo
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
