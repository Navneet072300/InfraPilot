import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HelpCircle, Zap, Terminal, GitBranch, Activity, Layout, Map,
  Keyboard, ChevronRight, ExternalLink, Search,
  Bug, Lightbulb, BookOpen, Loader2, ArrowRight, Stethoscope,
  LayoutDashboard, Server,
} from 'lucide-react';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)', purple: 'var(--accent)',
} as const;

const QUICK_START = [
  {
    icon: <Server size={20} />,
    color: '#326ce5',
    title: 'Connect Your Cluster',
    desc: 'Go to Integrations, add a Kubernetes cluster with its API URL and bearer token. Once connected it becomes your active cluster.',
    route: '/app/platforms',
  },
  {
    icon: <Zap size={20} />,
    color: '#f78166',
    title: 'Deploy Your First App',
    desc: 'Open Deploy, enter your repo URL and target namespace. InfraPilot generates the CI/CD manifests and deploys automatically.',
    route: '/app/deploy',
  },
  {
    icon: <Terminal size={20} />,
    color: V.accent,
    title: 'Generate Kubernetes YAML',
    desc: 'Use Generate mode to describe what you need in plain English — InfraPilot writes production-ready YAML scoped to your cluster.',
    route: '/app/generate',
  },
];

const SHORTCUTS = [
  { keys: ['⌘', '↵'], desc: 'Submit / Generate' },
  { keys: ['Esc'], desc: 'Close modal / Cancel' },
  { keys: ['⌘', 'K'], desc: 'Command palette (coming soon)' },
  { keys: ['⌘', '/'], desc: 'Focus mode input' },
  { keys: ['Tab'], desc: 'Cycle pipeline tasks' },
  { keys: ['⌘', 'Shift', 'C'], desc: 'Copy code block' },
];

const MODES = [
  {
    icon: <Zap size={16} />,
    title: 'Deploy',
    route: '/app/deploy',
    color: '#f78166',
    desc: 'Full CI/CD pipeline generation from repo URL.',
    bullets: ['Detects language, Dockerfile, and existing manifests', 'Generates GitHub Actions + Helm / Kustomize', 'Auto-mode or step-by-step review', 'Push to cluster on confirm'],
  },
  {
    icon: <Terminal size={16} />,
    title: 'Generate',
    route: '/app/generate',
    color: V.accent,
    desc: 'AI-powered Kubernetes YAML with live cluster context.',
    bullets: ['Injects active cluster and namespace into every prompt', 'Syntax-highlighted output with one-click copy', 'Streaming responses from Claude', '"Add to Pipeline" sends output downstream'],
  },
  {
    icon: <Stethoscope size={16} />,
    title: 'Diagnose',
    route: '/app/diagnose',
    color: V.yellow,
    desc: 'AI root-cause analysis from pod logs and cluster state.',
    bullets: ['Browse pod errors and deployment status', 'Live kubectl describe and log streaming', 'Structured cause tree with fix steps', 'One-click command execution with confirmation'],
  },
  {
    icon: <Layout size={16} />,
    title: 'Design',
    route: '/app/design',
    color: V.purple,
    desc: 'Architecture diagram generation.',
    bullets: ['Generates interactive infrastructure diagrams', 'Services, databases, queues, gateways', 'Copy as Mermaid or export JSON', 'Auto-layout with configurable styles'],
  },
  {
    icon: <Activity size={16} />,
    title: 'Monitor',
    route: '/app/monitor',
    color: V.green,
    desc: 'Live cluster health and connected monitoring platforms.',
    bullets: ['Health, issues, resources, metrics in one view', 'Connects to Grafana, Datadog, Prometheus, New Relic', 'AI-powered issue detection and alerts', 'Polls every 30 seconds'],
  },
  {
    icon: <LayoutDashboard size={16} />,
    title: 'Resources',
    route: '/app/resources',
    color: '#f0883e',
    desc: 'Kubernetes resource browser.',
    bullets: ['Nodes: status, roles, version, capacity', 'Pods: status, readiness, restarts, image', 'Events: warnings highlighted', 'Namespace-scoped filtering'],
  },
];

const FAQS = [
  { q: 'How do I connect my Kubernetes cluster?', a: 'Go to Integrations (sidebar) → Add Kubernetes Cluster. Enter the cluster name, environment, API server URL, and a bearer token with at least read access to pods and deployments. Hit Connect — the cluster becomes active immediately.' },
  { q: 'Cluster shows red / connection failed', a: 'Click Edit on the cluster in Integrations and paste a fresh bearer token. The token needs read access to pods, deployments, and nodes. Check that the API server URL is reachable from InfraPilot.' },
  { q: 'AI generation is slow or times out', a: 'Streaming can take 15–60 seconds for complex prompts. If it consistently times out, check that your Anthropic API key is valid and has quota remaining. Shorter, more focused prompts tend to be faster.' },
  { q: 'Pods are not loading in Resources or Diagnose', a: 'The connected service account needs read access to pods in the namespace. If you see a 403, check the RBAC binding. InfraPilot uses: get, list, watch on pods, services, deployments, nodes, events.' },
  { q: 'How do I invite teammates?', a: 'Team plan required. Go to Settings → Team, enter the email address, choose a role (Admin, Member, or Viewer), and send the invite. They\'ll receive an email with a sign-up link that joins your workspace automatically.' },
  { q: 'Can I use my own AI model?', a: 'Yes — Pro plan and above. Go to Settings → AI Model and enter your Ollama, vLLM, or compatible OpenAI-format endpoint URL. All generation requests will route through your own model.' },
  { q: 'Where can I download the generated YAML?', a: 'Every code block in Generate and Deploy modes has a Copy button. For full pipeline manifests, use the Download button in the Deploy summary step to get a ZIP of all generated files.' },
  { q: 'Two-factor authentication is not accepting my code', a: 'TOTP codes are time-based. Check that your device clock is synced (Settings → Date & Time → Automatic). If the code was generated more than 30 seconds ago, wait for the next rotation and try again.' },
];

const CHANGELOG = [
  { version: 'v2.2.0', date: 'July 2026', notes: ['Diagnose mode: 5-tab UI with pod errors, deployments, kubectl describe, logs, and AI resolution', 'Monitor Metrics: bring-your-own monitoring — Grafana, Datadog, Prometheus, New Relic', 'Integrations: GitHub PAT creation link, expiry display and warning badge', 'GitHub PAT now stores and shows expiry date with 10-day warning'] },
  { version: 'v2.1.0', date: 'June 2026', notes: ['Settings hub with 8-tab layout', 'Security: 2FA (TOTP), API keys, session management', 'Team plan: invite flow, roles, audit log', 'Profile dashboard: activity feed, usage metrics'] },
  { version: 'v2.0.0', date: 'May 2026', notes: ['Full auth migration to httpOnly cookie sessions', 'PostgreSQL persistence for all settings', 'Real-time streaming generation', 'Cluster health polling via React Query'] },
  { version: 'v1.0.0', date: 'April 2026', notes: ['Initial release: Deploy, Generate, Diagnose, Design, Monitor, Resources'] },
];

function FaqAccordion({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${V.border}` }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.9rem 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}>
        <span style={{ color: V.text, fontWeight: 500, fontSize: '0.875rem' }}>{q}</span>
        <ChevronRight size={15} color={V.muted} style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <p style={{ color: V.muted, fontSize: '0.825rem', margin: '0 0 0.9rem', lineHeight: 1.65 }}>{a}</p>
      )}
    </div>
  );
}

function SupportForm({ type }: { type: 'bug' | 'feature' }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await fetch(type === 'bug' ? '/api/support/bug' : '/api/support/feature', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(type === 'bug' ? { description: text } : { request: text }),
      });
      setDone(true); setText('');
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  if (done) {
    return (
      <div style={{ background: 'rgba(63,185,80,0.08)', border: `1px solid ${V.green}33`, borderRadius: 8, padding: '1rem', color: V.green, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        ✓ {type === 'bug' ? "Bug report submitted. We'll respond within 24 hours." : 'Feature request added to the roadmap — thank you!'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={type === 'bug' ? 'Describe what happened, steps to reproduce, and what you expected...' : 'Describe the feature or improvement you\'d like to see...'}
        style={{ width: '100%', background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.625rem 0.75rem', color: V.text, fontSize: '0.83rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
      <button type="button" onClick={submit} disabled={loading || !text.trim()}
        style={{ alignSelf: 'flex-start', padding: '0.45rem 1.25rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: !text.trim() ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: 600, opacity: !text.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        {loading && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
        Submit
      </button>
    </div>
  );
}

export default function HelpPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [supportTab, setSupportTab] = useState<'bug' | 'feature'>('bug');

  const q = search.toLowerCase();
  const filteredFaqs = FAQS.filter((f) => !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  const filteredModes = MODES.filter((m) => !q || m.title.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q));

  return (
    <div style={{ padding: '1.75rem 2rem', maxWidth: 880, margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: `${V.accent}18`, border: `1px solid ${V.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: V.accent }}>
            <HelpCircle size={18} />
          </div>
          <div>
            <h1 style={{ margin: 0, color: V.text, fontWeight: 700, fontSize: '1.35rem' }}>Help Center</h1>
            <p style={{ margin: 0, color: V.muted, fontSize: '0.8rem' }}>Guides, shortcuts, troubleshooting, and support</p>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginTop: '1rem' }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: V.muted, pointerEvents: 'none' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search help topics — cluster, deploy, diagnose…"
            style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '0.65rem 0.75rem 0.65rem 2.5rem', color: V.text, fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: V.muted, cursor: 'pointer', padding: 2 }}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* Quick Start */}
      {!q && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 0.875rem', color: V.text, fontWeight: 600, fontSize: '0.95rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={15} color={V.accent} /> Quick Start
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {QUICK_START.map(({ icon, color, title, desc, route }) => (
              <div key={title} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}18`, border: `1px solid ${color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
                  {icon}
                </div>
                <div style={{ color: V.text, fontWeight: 600, fontSize: '0.875rem' }}>{title}</div>
                <p style={{ color: V.muted, fontSize: '0.78rem', margin: 0, lineHeight: 1.55, flex: 1 }}>{desc}</p>
                <button type="button" onClick={() => navigate(route)}
                  style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: V.accent, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, padding: 0 }}>
                  Get started <ArrowRight size={11} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Keyboard Shortcuts */}
      {!q && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 0.875rem', color: V.text, fontWeight: 600, fontSize: '0.95rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Keyboard size={15} color={V.accent} /> Keyboard Shortcuts
          </h2>
          <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {SHORTCUTS.map(({ keys, desc }, i) => (
              <div key={desc} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', borderBottom: i < SHORTCUTS.length - 1 ? `1px solid ${V.border}33` : 'none' }}>
                <span style={{ color: V.muted, fontSize: '0.825rem' }}>{desc}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {keys.map((k) => (
                    <kbd key={k} style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 5, padding: '2px 7px', fontSize: '0.72rem', color: V.text, fontFamily: 'monospace' }}>{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mode Reference */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 0.875rem', color: V.text, fontWeight: 600, fontSize: '0.95rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Map size={15} color={V.accent} /> Mode Reference
        </h2>
        {filteredModes.length === 0 ? (
          <div style={{ color: V.muted, textAlign: 'center', padding: '2rem', background: V.surface, borderRadius: 10, border: `1px solid ${V.border}` }}>No modes match your search.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.75rem' }}>
            {filteredModes.map(({ icon, title, route, color, desc, bullets }) => (
              <div key={title} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: `${color}18`, border: `1px solid ${color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
                      {icon}
                    </div>
                    <span style={{ color: V.text, fontWeight: 600, fontSize: '0.875rem' }}>{title}</span>
                  </div>
                  <button type="button" onClick={() => navigate(route)}
                    style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', color: V.accent, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4 }}>
                    Open <ArrowRight size={10} />
                  </button>
                </div>
                <p style={{ color: V.muted, fontSize: '0.78rem', margin: 0, lineHeight: 1.5 }}>{desc}</p>
                <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {bullets.map((b) => <li key={b} style={{ color: V.muted, fontSize: '0.75rem' }}>{b}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 0.875rem', color: V.text, fontWeight: 600, fontSize: '0.95rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <HelpCircle size={15} color={V.accent} /> Frequently Asked Questions
        </h2>
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '0.25rem 1rem' }}>
          {filteredFaqs.length === 0
            ? <div style={{ color: V.muted, padding: '1.5rem', textAlign: 'center', fontSize: '0.875rem' }}>No results for "{search}"</div>
            : filteredFaqs.map((f) => <FaqAccordion key={f.q} q={f.q} a={f.a} />)}
        </div>
      </section>

      {/* Changelog */}
      {!q && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 0.875rem', color: V.text, fontWeight: 600, fontSize: '0.95rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <GitBranch size={15} color={V.accent} /> What's New
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {CHANGELOG.map(({ version, date, notes }, i) => (
              <div key={version} style={{ background: V.surface, border: `1px solid ${i === 0 ? V.accent + '44' : V.border}`, borderRadius: 10, padding: '0.875rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
                  <span style={{ color: i === 0 ? V.accent : V.text, fontWeight: 700, fontSize: '0.875rem', fontFamily: 'monospace' }}>{version}</span>
                  {i === 0 && <span style={{ fontSize: '0.65rem', fontWeight: 700, color: V.accent, background: `${V.accent}14`, borderRadius: 4, padding: '1px 6px' }}>LATEST</span>}
                  <span style={{ color: V.muted, fontSize: '0.75rem', marginLeft: 'auto' }}>{date}</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {notes.map((n) => <li key={n} style={{ color: V.muted, fontSize: '0.78rem' }}>{n}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Contact Support */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 0.875rem', color: V.text, fontWeight: 600, fontSize: '0.95rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bug size={15} color={V.accent} /> Contact Support
        </h2>
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0.625rem 1rem', borderBottom: `1px solid ${V.border}`, gap: 4 }}>
            {([['bug', 'Report a Bug', <Bug size={12} />], ['feature', 'Request a Feature', <Lightbulb size={12} />]] as const).map(([key, label, icon]) => (
              <button key={key} type="button" onClick={() => setSupportTab(key)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.35rem 0.875rem', borderRadius: 6, border: 'none', background: supportTab === key ? `${V.accent}18` : 'transparent', color: supportTab === key ? V.accent : V.muted, cursor: 'pointer', fontSize: '0.82rem', fontWeight: supportTab === key ? 600 : 400 }}>
                {icon} {label}
              </button>
            ))}
          </div>
          <div style={{ padding: '1rem' }}>
            <SupportForm type={supportTab} />
          </div>
        </div>
      </section>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10 }}>
        <div style={{ color: V.muted, fontSize: '0.8rem' }}>
          InfraPilot <strong style={{ color: V.text }}>v2.2.0</strong> · FastAPI · React · Anthropic Claude
        </div>
        <a href="mailto:support@infrapilot.io" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: V.accent, fontSize: '0.8rem', textDecoration: 'none' }}>
          <ExternalLink size={13} /> support@infrapilot.io
        </a>
      </div>
    </div>
  );
}
