import { useNavigate } from 'react-router-dom';
import { Rocket, Wand2, Stethoscope, Compass, Activity, ArrowRight, CheckCircle2, Check, Zap, Shield, Users, Building2, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';

const FEATURES = [
  { icon: <Rocket size={20} />, title: 'Pipeline', desc: 'Git repo to live URL in one shot. AI generates CI, K8s manifests, secrets, DNS — then deploys and troubleshoots automatically.', color: 'var(--accent)', badge: 'Hero feature' },
  { icon: <Wand2 size={20} />, title: 'Generate', desc: 'Natural language to production-ready IaC. Terraform, Kustomize, Helm, Ansible — all from one prompt with cluster context.', color: 'var(--info)' },
  { icon: <Stethoscope size={20} />, title: 'Diagnose', desc: 'Paste logs or pull live pod data. AI-powered root cause analysis with diff views and runbook generation.', color: 'var(--success)' },
  { icon: <Compass size={20} />, title: 'Design', desc: 'Architecture diagrams, cost estimates, compliance checks. Interactive React Flow canvas with Terraform output.', color: 'var(--accent-light)' },
  { icon: <Activity size={20} />, title: 'Monitor', desc: 'Live cluster health, cost anomaly detection, infrastructure drift scanning. 30-second polling, no agents needed.', color: 'var(--warning)' },
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
    id: 'free', name: 'Free', icon: <Zap size={18} />, price: '$0', annualPrice: '$0', color: 'var(--text-muted)', popular: false,
    features: ['1 cluster', '50 AI requests / day', '3 pipeline runs / day', 'Pipeline, Generate, Diagnose', 'Community support', '7-day history'],
    cta: 'Get started free',
  },
  {
    id: 'pro', name: 'Pro', icon: <Shield size={18} />, price: '$49', annualPrice: '$39', color: 'var(--accent)', popular: true,
    features: ['5 clusters', 'Unlimited AI requests', 'All 5 modes: Design + Monitor', 'Custom model endpoints', 'API key access', '90-day history'],
    cta: 'Start with Pro',
  },
  {
    id: 'team', name: 'Team', icon: <Users size={18} />, price: '$199', annualPrice: '$169', color: 'var(--accent-light)', popular: false,
    features: ['15 clusters', '10 team seats (RBAC)', 'Vault & ArgoCD integrations', 'Audit log + SSO', 'Slack notifications', '365-day history'],
    cta: 'Start with Team',
    badge: 'New',
  },
  {
    id: 'enterprise', name: 'Enterprise', icon: <Building2 size={18} />, price: 'Custom', annualPrice: 'Custom', color: 'var(--warning)', popular: false,
    features: ['Unlimited clusters', 'Unlimited seats', 'SAML / OIDC SSO', 'On-premise deployment', 'SLA 99.9% + dedicated Slack', 'Custom AI fine-tuning'],
    cta: 'Contact Sales',
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, setDemoMode } = useAuthStore();
  const { theme, toggle } = useThemeStore();
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', transition: 'background-color 0.2s ease, color 0.2s ease' }}>

      {/* Nav */}
      <nav style={{
        height: '60px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 32px',
        justifyContent: 'space-between', position: 'sticky', top: 0,
        background: 'var(--glass-bg)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'linear-gradient(135deg, var(--accent), #a78bfa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: 800, color: '#fff',
            boxShadow: '0 2px 10px var(--accent-glow)',
          }}>IP</div>
          <span style={{ fontWeight: 800, fontSize: '18px', letterSpacing: '-0.02em' }}>
            Infra<span style={{ color: 'var(--accent)' }}>Pilot</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Theme Switcher Button */}
          <button
            type="button"
            onClick={toggle}
            title="Toggle Light/Dark Theme"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, borderRadius: 8,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-focus)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {!loggedIn && (
            <button
              onClick={() => navigate('/login')}
              className="ip-button-secondary"
              style={{ padding: '7px 16px', fontSize: '13px' }}
            >
              Sign in
            </button>
          )}

          <button
            onClick={handleOpenApp}
            className="ip-button-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '13px' }}
          >
            {loggedIn ? 'Open App' : 'Get started'} <ArrowRight size={14} />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: '960px', margin: '0 auto', padding: '80px 24px 60px', textAlign: 'center', position: 'relative' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '5px 14px', background: 'var(--badge-bg)',
          border: '1px solid var(--border)', borderRadius: '9999px',
          fontSize: '12.5px', color: 'var(--accent-text)', fontWeight: 600, marginBottom: '24px',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <Rocket size={13} /> AI-native DevOps workspace
        </div>

        <h1 style={{
          fontSize: 'clamp(36px, 5.5vw, 64px)', fontWeight: 800,
          lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: '20px',
          color: 'var(--text-primary)',
        }}>
          The AI DevOps Engineer<br />
          <span style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            For Modern Teams
          </span>
        </h1>

        <p style={{
          fontSize: '18px', color: 'var(--text-secondary)',
          lineHeight: 1.6, maxWidth: '620px', margin: '0 auto 36px',
        }}>
          InfraPilot turns a GitHub repository into a fully deployed cloud application — CI pipelines, Kubernetes manifests, secrets, and DNS — in a single click.
        </p>

        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleGetStarted}
            className="ip-button-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 30px', fontSize: '15px' }}
          >
            Get started free <ArrowRight size={16} />
          </button>
          <button
            onClick={handleDemo}
            className="ip-button-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 26px', fontSize: '15px' }}
          >
            View live demo
          </button>
        </div>

        <p style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}>No credit card required · Free plan available forever</p>
      </section>

      {/* Pipeline demo box */}
      <section style={{ maxWidth: '740px', margin: '0 auto', padding: '0 24px 80px' }}>
        <div className="ip-card" style={{ overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--error)' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--warning)' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)' }} />
            <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              infrapilot — pipeline: my-app → prod-eks
            </span>
          </div>
          <div style={{ padding: '18px 22px', background: 'var(--bg-base)' }}>
            {PIPELINE_TASKS.map((t) => (
              <div key={t.n} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: t.n < PIPELINE_TASKS.length ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, background: t.done ? 'var(--success-bg)' : t.running ? 'var(--badge-bg)' : 'var(--bg-hover)', border: `1px solid ${t.done ? 'var(--success)' : t.running ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {t.done ? <CheckCircle2 size={12} color="var(--success)" /> : t.running ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', display: 'block', animation: 'pulseDot 1s infinite' }} /> : null}
                </div>
                <span style={{ fontSize: '12.5px', color: t.done ? 'var(--text-secondary)' : t.running ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', flex: 1, opacity: t.done ? 0.8 : 1 }}>
                  {t.n.toString().padStart(2, '0')} {t.label}
                </span>
                {t.stubbed && <span style={{ fontSize: '9px', color: 'var(--warning)', background: 'var(--warning-bg)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>STUBBED</span>}
                {t.running && <span style={{ fontSize: '11px', color: 'var(--accent-text)', fontWeight: 600 }}>running…</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section style={{ maxWidth: '1040px', margin: '0 auto', padding: '0 24px 80px' }}>
        <h2 style={{ textAlign: 'center', fontSize: '30px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '40px', color: 'var(--text-primary)' }}>Everything in one unified workspace</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="ip-card ip-card-hover" style={{ padding: '24px', position: 'relative', borderTop: `3px solid ${f.color}` }}>
              {f.badge && <span style={{ position: 'absolute', top: '16px', right: '16px', fontSize: '10.5px', fontWeight: 700, color: f.color, background: 'var(--badge-bg)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: '6px' }}>{f.badge}</span>}
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-hover)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.color, marginBottom: '14px' }}>{f.icon}</div>
              <p style={{ fontWeight: 700, fontSize: '16px', marginBottom: '8px', color: 'var(--text-primary)' }}>{f.title}</p>
              <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ maxWidth: '1040px', margin: '0 auto', padding: '0 24px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 12px', color: 'var(--text-primary)' }}>Simple, transparent pricing</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 16, margin: 0 }}>Start free. Scale as your platform grows.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {PLANS.map((p) => (
            <div key={p.id} className="ip-card" style={{ padding: '20px', position: 'relative', display: 'flex', flexDirection: 'column', borderColor: p.popular ? 'var(--border-focus)' : 'var(--border)', boxShadow: p.popular ? 'var(--shadow-md)' : 'var(--shadow-sm)' }}>
              {p.popular && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: '#fff', borderRadius: 20, padding: '3px 12px', fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Most Popular
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '12px' }}>
                <span style={{ color: p.color }}>{p.icon}</span>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{p.name}</span>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>{p.price}</span>
                {p.price !== 'Custom' && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>/mo</span>}
                {p.price !== 'Custom' && p.annualPrice !== p.price && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--success)', marginTop: 3 }}>{p.annualPrice}/mo billed annually</div>
                )}
                {p.id === 'free' && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>Free forever</div>}
              </div>
              <ul style={{ listStyle: 'none', margin: '0 0 1.5rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <Check size={13} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={p.id === 'enterprise' ? () => window.open('mailto:sales@infrapilot.io', '_blank') : handleGetStarted}
                className={p.popular ? 'ip-button-primary' : 'ip-button-secondary'}
                style={{ width: '100%', padding: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {p.cta} {p.id !== 'enterprise' && <ArrowRight size={13} />}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: '640px', margin: '0 auto', padding: '0 24px 100px', textAlign: 'center' }}>
        <div className="ip-card" style={{ padding: '48px 36px', boxShadow: 'var(--shadow-lg)' }}>
          <h2 style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '12px', color: 'var(--text-primary)' }}>Ready to ship faster?</h2>
          <p style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '28px', lineHeight: 1.6 }}>
            Connect your cluster and deploy your first application in under 5 minutes.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleGetStarted} className="ip-button-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 32px', fontSize: '15px' }}>
              {loggedIn ? 'Go to app' : 'Start for free'} <ArrowRight size={16} />
            </button>
            <button onClick={handleDemo} className="ip-button-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '15px' }}>
              Try demo
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
