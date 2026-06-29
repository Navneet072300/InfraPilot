import { useSearchParams } from 'react-router-dom';
import { GitBranch } from 'lucide-react';

const V = {
  bg: '#0d1117', surface: '#161b22', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e', accent: '#58a6ff',
  red: '#f85149',
} as const;

const ERROR_MESSAGES: Record<string, string> = {
  github_failed: 'GitHub sign-in failed. Please try again.',
  github_no_email: 'Your GitHub account has no public email. Enable a primary email in GitHub settings and retry.',
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
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#fff', margin: '0 auto 18px' }}>
            IP
          </div>
          <h1 style={{ margin: '0 0 8px', color: V.text, fontWeight: 800, fontSize: 24 }}>Welcome to InfraPilot</h1>
          <p style={{ margin: 0, color: V.muted, fontSize: 14, lineHeight: 1.6 }}>
            Sign in with GitHub to access your repositories<br />and start deploying infrastructure.
          </p>
        </div>

        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 14, padding: '32px 28px' }}>
          {error && (
            <div style={{ background: 'rgba(248,81,73,0.1)', border: `1px solid rgba(248,81,73,0.3)`, borderRadius: 8, padding: '10px 14px', marginBottom: 24, color: V.red, fontSize: 13 }}>
              {error}
            </div>
          )}

          <a
            href="/api/auth/github"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '13px 20px', borderRadius: 10,
              background: '#238636', border: '1px solid #2ea043',
              color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#2ea043')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#238636')}
          >
            <GitBranch size={20} /> Continue with GitHub
          </a>

          <p style={{ textAlign: 'center', color: V.muted, fontSize: 12, margin: '20px 0 0', lineHeight: 1.6 }}>
            InfraPilot uses GitHub OAuth. We request <code style={{ background: '#0d1117', padding: '1px 5px', borderRadius: 4 }}>user:email</code> and{' '}
            <code style={{ background: '#0d1117', padding: '1px 5px', borderRadius: 4 }}>repo</code> scopes so you can connect your repositories directly — no separate token setup needed.
          </p>
        </div>
      </div>
    </div>
  );
}
