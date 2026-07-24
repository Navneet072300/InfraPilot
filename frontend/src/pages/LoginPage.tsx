import { useSearchParams } from 'react-router-dom';

const ERROR_MESSAGES: Record<string, string> = {
  github_failed:    'GitHub sign-in failed. Please try again.',
  github_no_email:  'Your GitHub account has no public email. Enable a primary email in GitHub settings and retry.',
  gitlab_failed:    'GitLab sign-in failed. Please try again.',
  gitlab_no_email:  'Your GitLab account has no public email. Add a primary email in GitLab settings and retry.',
  session_failed:   'Session expired. Please sign in again.',
  db_unavailable:   'Service temporarily unavailable. Please try again shortly.',
};

function GitHubLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function GitLabLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 0 0-.867 0L16.418 9.45H7.582L4.918 1.263a.455.455 0 0 0-.867 0L1.386 9.45.044 13.587a.924.924 0 0 0 .331 1.023L12 23.054l11.625-8.444a.92.92 0 0 0 .33-1.023" />
    </svg>
  );
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get('error');
  const error = errorCode ? (ERROR_MESSAGES[errorCode] ?? 'Sign-in failed. Please try again.') : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="animate-fade-in-up" style={{ width: '100%', maxWidth: 380 }}>
        {/* Logo + wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16,
            background: 'linear-gradient(135deg, var(--accent) 0%, #a78bfa 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 800, color: '#fff',
            margin: '0 auto 16px',
            boxShadow: '0 4px 20px var(--accent-glow)',
          }}>
            IP
          </div>
          <h1 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontWeight: 800, fontSize: 24, letterSpacing: '-0.02em' }}>
            Infra<span style={{ color: 'var(--accent)' }}>Pilot</span>
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.6 }}>
            Sign in with your Git provider to connect<br />repositories and deploy infrastructure.
          </p>
        </div>

        {/* Card */}
        <div className="ip-card" style={{ padding: '28px 24px', boxShadow: 'var(--shadow-md)' }}>
          {error && (
            <div style={{ background: 'var(--error-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, color: 'var(--error)', fontSize: 12, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          {/* GitHub button */}
          <a
            href="/api/auth/github"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '12px 20px', borderRadius: 10,
              background: '#24292f', border: '1px solid #444c56',
              color: '#ffffff', fontSize: 14, fontWeight: 600, textDecoration: 'none',
              width: '100%', boxSizing: 'border-box',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            <GitHubLogo size={18} /> Continue with GitHub
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* GitLab button */}
          <a
            href="/api/auth/gitlab"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '12px 20px', borderRadius: 10,
              background: '#fc6d26', border: '1px solid #e24329',
              color: '#ffffff', fontSize: 14, fontWeight: 600, textDecoration: 'none',
              width: '100%', boxSizing: 'border-box',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 8px rgba(252,109,38,0.2)',
            }}
          >
            <GitLabLogo size={18} /> Continue with GitLab
          </a>

          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5, margin: '20px 0 0', lineHeight: 1.6 }}>
            Requests <code style={{ background: 'var(--bg-hover)', padding: '2px 5px', borderRadius: 4, color: 'var(--text-secondary)', fontSize: 10.5 }}>read_user</code> / <code style={{ background: 'var(--bg-hover)', padding: '2px 5px', borderRadius: 4, color: 'var(--text-secondary)', fontSize: 10.5 }}>repo</code> scopes.
          </p>
        </div>

        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, marginTop: 20, lineHeight: 1.6 }}>
          By continuing you agree to InfraPilot's terms of service.
        </p>
      </div>
    </div>
  );
}
