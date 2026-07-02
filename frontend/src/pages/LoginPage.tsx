import { useSearchParams } from 'react-router-dom';
import { GitBranch, GitMerge } from 'lucide-react';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  red: 'var(--error)',
} as const;

const ERROR_MESSAGES: Record<string, string> = {
  github_failed: 'GitHub sign-in failed. Please try again.',
  github_no_email: 'Your GitHub account has no public email. Enable a primary email in GitHub settings and retry.',
  gitlab_failed: 'GitLab sign-in failed. Please try again.',
  gitlab_no_email: 'Your GitLab account has no public email. Add a primary email in GitLab settings and retry.',
  session_failed: 'Session expired. Please sign in again.',
  db_unavailable: 'Service temporarily unavailable. Please try again shortly.',
};

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get('error');
  const error = errorCode ? (ERROR_MESSAGES[errorCode] ?? 'Sign-in failed. Please try again.') : '';

  return (
    <div style={{ minHeight: '100vh', background: V.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,var(--accent),#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#fff', margin: '0 auto 18px' }}>
            IP
          </div>
          <h1 style={{ margin: '0 0 8px', color: V.text, fontWeight: 800, fontSize: 24 }}>Welcome to InfraPilot</h1>
          <p style={{ margin: 0, color: V.muted, fontSize: 14, lineHeight: 1.6 }}>
            Sign in with your Git provider to connect your<br />repositories and start deploying infrastructure.
          </p>
        </div>

        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 14, padding: '32px 28px' }}>
          {error && (
            <div style={{ background: 'rgba(248,81,73,0.1)', border: `1px solid rgba(248,81,73,0.3)`, borderRadius: 8, padding: '10px 14px', marginBottom: 24, color: V.red, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* GitHub */}
          <a
            href="/api/auth/github"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '13px 20px', borderRadius: 10,
              background: 'var(--success)', border: '1px solid #2ea043',
              color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#2ea043')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--success)')}
          >
            <GitBranch size={20} /> Continue with GitHub
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
            <div style={{ flex: 1, height: 1, background: V.border }} />
            <span style={{ color: V.muted, fontSize: 12 }}>or</span>
            <div style={{ flex: 1, height: 1, background: V.border }} />
          </div>

          {/* GitLab */}
          <a
            href="/api/auth/gitlab"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '13px 20px', borderRadius: 10,
              background: '#fc6d26', border: '1px solid #e24329',
              color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#e24329')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#fc6d26')}
          >
            <GitMerge size={20} /> Continue with GitLab
          </a>

          <p style={{ textAlign: 'center', color: V.muted, fontSize: 12, margin: '20px 0 0', lineHeight: 1.6 }}>
            We request <code style={{ background: 'var(--bg-base)', padding: '1px 5px', borderRadius: 4 }}>read_user</code> / <code style={{ background: 'var(--bg-base)', padding: '1px 5px', borderRadius: 4 }}>repo</code> scopes
            so you can connect your repositories directly — no separate token setup needed.
          </p>
        </div>
      </div>
    </div>
  );
}
