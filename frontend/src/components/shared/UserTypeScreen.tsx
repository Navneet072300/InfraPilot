import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import type { ExperienceLevel } from '../../lib/terminology';

interface Choice {
  level: ExperienceLevel;
  icon: string;
  title: string;
  lines: string[];
}

const CHOICES: Choice[] = [
  {
    level: 'builder',
    icon: '👨‍💻',
    title: 'I build apps',
    lines: ["I write code. I want my app live.", "I don't deal with servers much."],
  },
  {
    level: 'devops',
    icon: '⚙️',
    title: 'I manage infrastructure',
    lines: ['I work with Kubernetes, CI/CD,', 'deployments, and cloud platforms.'],
  },
  {
    level: 'learning',
    icon: '🌱',
    title: "I'm learning",
    lines: ["I'm new to deployment and want", 'to understand how it works.'],
  },
];

interface Props {
  onDone: () => void;
}

export function UserTypeScreen({ onDone }: Props) {
  const { setUser } = useAuthStore();
  const [selected, setSelected] = useState<ExperienceLevel | null>(null);
  const [saving, setSaving] = useState(false);

  // Auto-dismiss with devops default if user hasn't interacted after 5 minutes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!selected) skip();
    }, 5 * 60 * 1000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function skip() {
    setUser({ experience_level: 'devops' });
    try {
      await fetch('/api/settings/general', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experience_level: 'devops' }),
      });
    } catch { /* best-effort */ }
    onDone();
  }

  async function confirm() {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch('/api/settings/general', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experience_level: selected }),
      });
      setUser({ experience_level: selected });
    } catch {
      // best-effort — apply locally regardless
      setUser({ experience_level: selected });
    } finally {
      setSaving(false);
      onDone();
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--bg-base)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 440, padding: '0 20px' }}>
        {/* Skip button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            onClick={skip}
            title="Skip for now — we'll use DevOps mode by default"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: '4px 8px' }}
          >
            Skip for now ✕
          </button>
        </div>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
            InfraPilot
          </div>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, textAlign: 'center' }}>
          How do you usually work?
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 28 }}>
          This helps InfraPilot use the right language for you.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CHOICES.map((c) => {
            const active = selected === c.level;
            return (
              <button
                key={c.level}
                type="button"
                onClick={() => setSelected(c.level)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 16,
                  padding: '16px 20px',
                  background: active ? 'rgba(88,166,255,0.08)' : 'var(--bg-surface)',
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  transition: 'all 0.15s',
                  width: '100%',
                }}
              >
                <span style={{ fontSize: 26, flexShrink: 0, lineHeight: 1.2 }}>{c.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text-primary)', marginBottom: 4 }}>
                    {c.title}
                  </div>
                  {c.lines.map((l, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{l}</div>
                  ))}
                </div>
                <div style={{ marginLeft: 'auto', flexShrink: 0, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={confirm}
          disabled={!selected || saving}
          style={{
            width: '100%', marginTop: 24, padding: '12px',
            background: selected ? 'var(--accent)' : 'var(--bg-hover)',
            border: 'none', borderRadius: 8,
            color: selected ? '#fff' : 'var(--text-muted)',
            fontSize: 14, fontWeight: 700, cursor: selected ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Continue →'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          You can change this anytime in Settings → General
        </p>
      </div>
    </div>
  );
}
