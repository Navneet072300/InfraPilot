import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Mail, Lock, Eye, EyeOff, GitFork } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

const V = {
  bg: '#0d1117', surface: '#161b22', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e', accent: '#58a6ff',
  red: '#f85149',
} as const;

type Tab = 'social' | 'email';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuthStore();
  const { setProfile } = useProfileStore();

  const [tab, setTab] = useState<Tab>('social');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const errorCode = searchParams.get('error');
  const ERROR_MESSAGES: Record<string, string> = {
    google_failed: 'Google sign-in failed. Check your credentials and try again.',
    github_failed: 'GitHub sign-in failed. Check your credentials and try again.',
    github_no_email: 'Your GitHub account has no public email. Enable a primary email in GitHub settings and retry.',
    session_failed: 'Session expired. Please sign in again.',
    db_unavailable: 'Service temporarily unavailable. Please try again shortly.',
  };
  const [error, setError] = useState(errorCode ? (ERROR_MESSAGES[errorCode] ?? 'Sign-in failed. Please try again.') : '');

  async function handleEmailLogin() {
    if (!email || !password) return;
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Login failed');
      // Cookie was set by backend; store user in memory and sync profile
      login(data.user);
      setProfile({ name: data.user.name || '', email: data.user.email || '', plan: data.user.plan ?? 'free' });
      navigate('/app', { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally { setLoading(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: V.bg,
    border: `1px solid ${V.border}`, borderRadius: 10,
    padding: '11px 14px', color: V.text, fontSize: 14, outline: 'none', fontFamily: 'inherit',
  };

  return (
    <div style={{ minHeight: '100vh', background: V.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff', margin: '0 auto 14px', cursor: 'pointer' }}
            onClick={() => navigate('/')}
          >
            IP
          </div>
          <h1 style={{ margin: '0 0 6px', color: V.text, fontWeight: 800, fontSize: 22 }}>Welcome back</h1>
          <p style={{ margin: 0, color: V.muted, fontSize: 14 }}>
            Don't have an account?{' '}
            <span style={{ color: V.accent, cursor: 'pointer' }} onClick={() => navigate('/signup')}>Sign up</span>
          </p>
        </div>

        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 14, padding: '28px 28px 24px' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', background: V.bg, borderRadius: 10, padding: 3, marginBottom: 24, gap: 2 }}>
            {(['social', 'email'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setError(''); }}
                style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: 'none', background: tab === t ? V.surface : 'transparent', color: tab === t ? V.text : V.muted, fontSize: 12, fontWeight: tab === t ? 600 : 400, cursor: 'pointer' }}
              >
                {t === 'social' ? 'Social' : 'Email'}
              </button>
            ))}
          </div>

          {error && (
            <div style={{ background: 'rgba(248,81,73,0.1)', border: `1px solid rgba(248,81,73,0.3)`, borderRadius: 8, padding: '10px 14px', marginBottom: 18, color: V.red, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Social tab */}
          {tab === 'social' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <a
                href="/api/auth/google"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px', borderRadius: 10, border: `1px solid ${V.border}`, background: V.bg, color: V.text, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
              >
                <GoogleIcon /> Continue with Google
              </a>
              <a
                href="/api/auth/github"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px', borderRadius: 10, border: `1px solid ${V.border}`, background: V.bg, color: V.text, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
              >
                <GitFork size={18} /> Continue with GitHub
              </a>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: V.muted, fontSize: 12, margin: '4px 0' }}>
                <div style={{ flex: 1, height: 1, background: V.border }} />
                or use email & password
                <div style={{ flex: 1, height: 1, background: V.border }} />
              </div>
              <button type="button" onClick={() => setTab('email')} style={{ padding: '11px', borderRadius: 10, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Mail size={15} /> Email & Password
              </button>
            </div>
          )}

          {/* Email tab */}
          {tab === 'email' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', color: V.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: V.muted, pointerEvents: 'none' }} />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                    style={{ ...inputStyle, paddingLeft: 36 }}
                    onFocus={(e) => e.target.style.borderColor = V.accent}
                    onBlur={(e) => e.target.style.borderColor = V.border} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', color: V.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: V.muted, pointerEvents: 'none' }} />
                  <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                    style={{ ...inputStyle, paddingLeft: 36, paddingRight: 40 }}
                    onFocus={(e) => e.target.style.borderColor = V.accent}
                    onBlur={(e) => e.target.style.borderColor = V.border}
                    onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()} />
                  <button type="button" onClick={() => setShowPass((s) => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted, padding: 2 }}>
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <button type="button" disabled={loading || !email || !password} onClick={handleEmailLogin}
                style={{ padding: '12px', borderRadius: 10, border: 'none', background: V.accent, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Signing in…' : <><ArrowRight size={15} /> Sign In</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
