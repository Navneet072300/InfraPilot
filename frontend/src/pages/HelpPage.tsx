import { useState } from 'react';
import {
  HelpCircle, Zap, Terminal, GitBranch, Activity, Layout, Map,
  Keyboard, ChevronRight, ChevronDown, ExternalLink, Search,
  Bug, Lightbulb, BookOpen, Loader2,
} from 'lucide-react';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)', purple: '#bc8cff',
} as const;

// ─── Quick Start Cards ────────────────────────────────────────────────────────

const QUICK_START = [
  {
    icon: <BookOpen size={20} />,
    color: V.accent,
    title: 'Connect Your Cluster',
    desc: 'Settings → Connected Platforms → Add Cluster. Add bearer token or kubeconfig, test connection, then activate.',
  },
  {
    icon: <Zap size={20} />,
    color: '#f78166',
    title: 'Run Your First Pipeline',
    desc: 'Open Pipeline mode, enter your repo URL and namespace. InfraPilot generates CI/CD manifests and deploys for you.',
  },
  {
    icon: <Terminal size={20} />,
    color: V.purple,
    title: 'Generate Kubernetes YAML',
    desc: 'Generate mode injects your active cluster and namespace into every prompt. Describe what you need in plain English.',
  },
];

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

const SHORTCUTS = [
  { keys: ['⌘', '↵'], desc: 'Submit / Generate' },
  { keys: ['Esc'], desc: 'Close modal / Cancel' },
  { keys: ['⌘', 'K'], desc: 'Command palette (coming soon)' },
  { keys: ['⌘', '/'], desc: 'Focus mode input' },
  { keys: ['Tab'], desc: 'Cycle pipeline tasks' },
  { keys: ['⌘', 'Shift', 'C'], desc: 'Copy code block' },
];

// ─── Mode Reference ───────────────────────────────────────────────────────────

const MODES = [
  { icon: <Zap size={16} />, title: 'Pipeline', path: '/app/pipeline', color: '#f78166', desc: 'Full CI/CD pipeline generation from repo URL.', bullets: ['Analyzes repo language, Dockerfile, manifests', '11-step: lint → build → push → deploy', 'Auto-mode or step-by-step review', 'GitHub Actions + Kustomize/Helm'] },
  { icon: <Terminal size={16} />, title: 'Generate', path: '/app/generate', color: V.accent, desc: 'AI-powered Kubernetes YAML with cluster context.', bullets: ['Injects active cluster + namespace into every prompt', 'Syntax-highlighted output with copy button', '"Add to Pipeline" sends output downstream', 'Streaming from Claude claude-sonnet-4-6'] },
  { icon: <Activity size={16} />, title: 'Diagnose', path: '/app/diagnose', color: V.yellow, desc: 'AI root-cause analysis from pod logs.', bullets: ['Paste logs manually or fetch live from pod', 'Live tab: select pod → auto-fetch logs', 'Structured diagnosis with fix suggestions', 'Streams in real time'] },
  { icon: <Layout size={16} />, title: 'Design', path: '/app/design', color: V.purple, desc: 'Architecture diagram generation.', bullets: ['Generates React Flow diagrams', 'Services, databases, queues, gateways', 'Copy Mermaid or export as JSON', 'Auto-layout with configurable styles'] },
  { icon: <Map size={16} />, title: 'Monitor', path: '/app/monitor', color: V.green, desc: 'Live cluster health dashboard.', bullets: ['Green = reachable, Red = 401/expired', 'Node, pod counts, warning events', 'Inline token-fix form', 'Polls every 30 seconds'] },
  { icon: <GitBranch size={16} />, title: 'Resources', path: '/app/resources', color: '#f0883e', desc: 'Kubernetes resource browser.', bullets: ['Nodes: status, roles, version, capacity', 'Pods: status, readiness, restarts, image', 'Events: warnings highlighted', 'Namespace-scoped filtering'] },
];

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQS = [
  { q: 'Cluster shows red / token expired', a: 'Go to Settings → Connected Platforms, click Edit on the cluster, and paste a fresh Bearer Token. Click Test to verify, then Save. Monitor updates within 30 seconds.' },
  { q: 'AI generation is slow or times out', a: 'Check that ANTHROPIC_API_KEY is set in backend/.env. Streaming can take 15–60 seconds for complex prompts. Check backend logs for 401 or quota errors.' },
  { q: 'Pods not loading in Resources / Live Cluster tab', a: "The service account needs at least read access to pods in the namespace. InfraPilot's kubectl whitelist allows: get, describe, logs, rollout, apply, top, version, cluster-info." },
  { q: 'Backend fails to start: address already in use', a: 'Run: lsof -ti :8000 | xargs kill -9 then restart. Or change PORT in .env.' },
  { q: 'Docker Compose: frontend can\'t reach backend', a: 'nginx proxies /api/* to http://backend:8000. Ensure both services are on the infrapilot network. Check: docker compose logs backend.' },
  { q: 'Two-factor authentication not accepting my code', a: 'TOTP codes are time-based. Check that your device clock is synced. If setup was more than 30 seconds ago, try the next code rotation.' },
];

// ─── Changelog ────────────────────────────────────────────────────────────────

const CHANGELOG = [
  { version: 'v2.1.0', date: 'June 2026', notes: ['Settings hub with 8-tab layout', 'Security: 2FA (TOTP), API keys, session management', 'Team plan: invite flow, roles, audit log', 'Profile dashboard: activity feed, usage metrics', 'UserMenu dropdown with plan badge'] },
  { version: 'v2.0.0', date: 'May 2026', notes: ['Full auth migration to httpOnly cookie sessions', 'PostgreSQL persistence for all settings', 'Real-time streaming generation', 'Cluster health polling via React Query'] },
  { version: 'v1.0.0', date: 'April 2026', notes: ['Initial release: Pipeline, Generate, Diagnose, Design, Monitor, Resources'] },
];

// ─── Component helpers ────────────────────────────────────────────────────────

function FaqAccordion({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${V.border}` }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ color: V.text, fontWeight: 500, fontSize: '0.875rem' }}>{q}</span>
        {open ? <ChevronDown size={16} color={V.muted} /> : <ChevronRight size={16} color={V.muted} />}
      </button>
      {open && (
        <p style={{ color: V.muted, fontSize: '0.825rem', margin: '0 0 0.875rem', lineHeight: 1.6 }}>{a}</p>
      )}
    </div>
  );
}

// ─── Support Form ─────────────────────────────────────────────────────────────

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
      <div style={{ background: 'rgba(63,185,80,0.08)', border: `1px solid ${V.green}`, borderRadius: 8, padding: '0.875rem', color: V.green, fontSize: '0.875rem' }}>
        ✓ {type === 'bug' ? 'Bug report submitted. We\'ll respond within 24 hours.' : 'Feature request added to the roadmap — thank you!'}
      </div>
    );
  }

  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder={type === 'bug' ? 'Describe the bug, steps to reproduce, expected vs actual behavior...' : 'Describe the feature or improvement you\'d like to see...'}
        style={{ width: '100%', background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.625rem 0.75rem', color: V.text, fontSize: '0.82rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }} />
      <button type="button" onClick={submit} disabled={loading || !text.trim()}
        style={{ padding: '0.45rem 1rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, opacity: !text.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        {loading && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
        Submit
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [search, setSearch] = useState('');
  const [supportTab, setSupportTab] = useState<'bug' | 'feature'>('bug');

  const q = search.toLowerCase();
  const filteredFaqs = FAQS.filter((f) => !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  const filteredModes = MODES.filter((m) => !q || m.title.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q));

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ margin: 0, color: V.text, fontWeight: 700, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpCircle size={22} color={V.accent} /> Help Center
        </h1>
        <p style={{ margin: '0.25rem 0 1rem', color: V.muted, fontSize: '0.875rem' }}>
          Getting started, keyboard shortcuts, mode reference, and troubleshooting
        </p>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: V.muted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search help topics..."
            style={{ width: '100%', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '0.6rem 0.75rem 0.6rem 2.25rem', color: V.text, fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none' }} />
        </div>
      </div>

      {/* Quick Start */}
      {!q && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 1rem', color: V.text, fontWeight: 600, fontSize: '1rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}` }}>
            Quick Start
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {QUICK_START.map(({ icon, color, title, desc }) => (
              <div key={title} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, marginBottom: '0.75rem' }}>
                  {icon}
                </div>
                <div style={{ color: V.text, fontWeight: 600, fontSize: '0.875rem', marginBottom: 4 }}>{title}</div>
                <p style={{ color: V.muted, fontSize: '0.78rem', margin: 0, lineHeight: 1.55 }}>{desc}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Keyboard Shortcuts */}
      {!q && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 1rem', color: V.text, fontWeight: 600, fontSize: '1rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Keyboard size={16} /> Keyboard Shortcuts
          </h2>
          <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '0.875rem 1rem' }}>
            {SHORTCUTS.map(({ keys, desc }) => (
              <div key={desc} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: `1px solid ${V.border}33` }}>
                <span style={{ color: V.muted, fontSize: '0.825rem' }}>{desc}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {keys.map((k) => (
                    <kbd key={k} style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 5, padding: '2px 7px', fontSize: '0.75rem', color: V.text, fontFamily: 'monospace' }}>{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mode Reference */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 1rem', color: V.text, fontWeight: 600, fontSize: '1rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}` }}>
          Mode Reference
        </h2>
        {filteredModes.length === 0 ? (
          <div style={{ color: V.muted, textAlign: 'center', padding: '1.5rem' }}>No modes match your search.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.75rem' }}>
            {filteredModes.map(({ icon, title, path, color, desc, bullets }) => (
              <div key={title} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.625rem' }}>
                  <span style={{ color }}>{icon}</span>
                  <div>
                    <div style={{ color: V.text, fontWeight: 600, fontSize: '0.875rem' }}>{title}</div>
                    <div style={{ color: V.muted, fontSize: '0.68rem', fontFamily: 'monospace' }}>{path}</div>
                  </div>
                </div>
                <p style={{ color: V.muted, fontSize: '0.78rem', margin: '0 0 0.5rem', lineHeight: 1.5 }}>{desc}</p>
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
        <h2 style={{ margin: '0 0 1rem', color: V.text, fontWeight: 600, fontSize: '1rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}` }}>
          Frequently Asked Questions
        </h2>
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, padding: '0.5rem 1rem' }}>
          {filteredFaqs.length === 0
            ? <div style={{ color: V.muted, padding: '1rem', textAlign: 'center', fontSize: '0.875rem' }}>No results for "{search}"</div>
            : filteredFaqs.map((f) => <FaqAccordion key={f.q} q={f.q} a={f.a} />)}
        </div>
      </section>

      {/* Changelog */}
      {!q && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 1rem', color: V.text, fontWeight: 600, fontSize: '1rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}` }}>
            Changelog
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {CHANGELOG.map(({ version, date, notes }, i) => (
              <div key={version} style={{ background: V.surface, border: `1px solid ${i === 0 ? V.accent + '44' : V.border}`, borderRadius: 10, padding: '0.875rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
                  <span style={{ color: i === 0 ? V.accent : V.text, fontWeight: 700, fontSize: '0.875rem' }}>{version}</span>
                  {i === 0 && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: V.accent, background: 'rgba(88,166,255,0.1)', borderRadius: 4, padding: '1px 6px' }}>LATEST</span>}
                  <span style={{ color: V.muted, fontSize: '0.78rem', marginLeft: 'auto' }}>{date}</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {notes.map((n) => <li key={n} style={{ color: V.muted, fontSize: '0.78rem' }}>{n}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Support */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 1rem', color: V.text, fontWeight: 600, fontSize: '1rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${V.border}` }}>
          Contact Support
        </h2>
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0.625rem 1rem', borderBottom: `1px solid ${V.border}`, gap: 6 }}>
            {([['bug', 'Report a Bug', <Bug size={13} />], ['feature', 'Request a Feature', <Lightbulb size={13} />]] as const).map(([key, label, icon]) => (
              <button key={key} type="button" onClick={() => setSupportTab(key)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.35rem 0.75rem', borderRadius: 6, border: 'none', background: supportTab === key ? V.bg : 'transparent', color: supportTab === key ? V.text : V.muted, cursor: 'pointer', fontSize: '0.82rem', fontWeight: supportTab === key ? 600 : 400 }}>
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
      <div style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 10, padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: V.muted, fontSize: '0.8rem' }}>
          InfraPilot <strong style={{ color: V.text }}>v2.1.0</strong> · FastAPI · React · Anthropic Claude
        </div>
        <a href="https://github.com/anthropics/claude-code/issues" target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: V.accent, fontSize: '0.8rem', textDecoration: 'none' }}>
          <ExternalLink size={13} /> GitHub Issues
        </a>
      </div>
    </div>
  );
}
