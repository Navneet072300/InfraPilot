import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Mail, Lock, User, Eye, EyeOff, GitFork } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

const V = {
  bg: '#0d1117', surface: '#161b22', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e', accent: '#58a6ff',
  red: '#f85149',
} as const;

type Tab = 'social' | 'email';
type Step = 'form' | 'otp';

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

export function SignupPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { setProfile } = useProfileStore();

  const [tab, setTab] = useState<Tab>('social');
  const [step, setStep] = useState<Step>('form');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [otp, setOtp] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleEmailSignup() {
    if (!name || !email || !password) return;
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Signup failed');
      setStep('otp');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Signup failed');
    } finally { setLoading(false); }
  }

  async function handleOTPVerify() {
    if (otp.length !== 6) return;
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/auth/otp/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: email, code: otp, name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Invalid OTP');
      // Cookie set by backend; store user in memory and sync profile
      login(data.user);
      setProfile({ name: data.user.name || '', email: data.user.email || '', plan: data.user.plan ?? 'free' });
      navigate('/app', { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Verification failed');
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
          <h1 style={{ margin: '0 0 6px', color: V.text, fontWeight: 800, fontSize: 22 }}>Create your account</h1>
          <p style={{ margin: 0, color: V.muted, fontSize: 14 }}>
            Already have one?{' '}
            <span style={{ color: V.accent, cursor: 'pointer' }} onClick={() => navigate('/login')}>Sign in</span>
          </p>
        </div>

        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 14, padding: '28px 28px 24px' }}>
          {step === 'otp' ? (
            /* OTP verification step */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📧</div>
                <h3 style={{ margin: '0 0 6px', color: V.text, fontSize: 16, fontWeight: 700 }}>Check your email</h3>
                <p style={{ margin: 0, color: V.muted, fontSize: 13 }}>
                  We sent a 6-digit code to <strong style={{ color: V.text }}>{email}</strong>
                </p>
              </div>
              {error && (
                <div style={{ background: 'rgba(248,81,73,0.1)', border: `1px solid rgba(248,81,73,0.3)`, borderRadius: 8, padding: '10px 14px', color: V.red, fontSize: 13 }}>{error}</div>
              )}
              <input
                type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleOTPVerify()}
                style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 28, fontWeight: 700, padding: '14px', background: V.bg, border: `1px solid ${V.border}`, borderRadius: 10, color: V.text, outline: 'none', fontFamily: 'monospace' }}
                autoFocus
              />
              <button type="button" disabled={otp.length !== 6 || loading} onClick={handleOTPVerify}
                style={{ padding: '12px', borderRadius: 10, border: 'none', background: otp.length === 6 ? V.accent : V.border, color: '#fff', fontSize: 14, fontWeight: 600, cursor: otp.length === 6 ? 'pointer' : 'default', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Verifying…' : 'Verify & Create Account'}
              </button>
              <button type="button" onClick={() => { setStep('form'); setOtp(''); setError(''); }}
                style={{ background: 'none', border: 'none', color: V.muted, fontSize: 12, cursor: 'pointer' }}>
                ← Back
              </button>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: 'flex', background: V.bg, borderRadius: 10, padding: 3, marginBottom: 24, gap: 2 }}>
                {(['social', 'email'] as Tab[]).map((t) => (
                  <button key={t} type="button" onClick={() => { setTab(t); setError(''); }}
                    style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: 'none', background: tab === t ? V.surface : 'transparent', color: tab === t ? V.text : V.muted, fontSize: 12, fontWeight: tab === t ? 600 : 400, cursor: 'pointer' }}>
                    {t === 'social' ? 'Social' : 'Email'}
                  </button>
                ))}
              </div>

              {error && (
                <div style={{ background: 'rgba(248,81,73,0.1)', border: `1px solid rgba(248,81,73,0.3)`, borderRadius: 8, padding: '10px 14px', marginBottom: 18, color: V.red, fontSize: 13 }}>
                  {error}
                </div>
              )}

              {/* Social */}
              {tab === 'social' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <a href="/api/auth/google"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px', borderRadius: 10, border: `1px solid ${V.border}`, background: V.bg, color: V.text, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                    <GoogleIcon /> Continue with Google
                  </a>
                  <a href="/api/auth/github"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px', borderRadius: 10, border: `1px solid ${V.border}`, background: V.bg, color: V.text, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                    <GitFork size={18} /> Continue with GitHub
                  </a>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: V.muted, fontSize: 12, margin: '4px 0' }}>
                    <div style={{ flex: 1, height: 1, background: V.border }} />
                    or sign up with email
                    <div style={{ flex: 1, height: 1, background: V.border }} />
                  </div>
                  <button type="button" onClick={() => setTab('email')}
                    style={{ padding: '11px', borderRadius: 10, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Mail size={15} /> Sign up with Email
                  </button>
                </div>
              )}

              {/* Email */}
              {tab === 'email' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: 'Full Name', icon: <User size={14} />, value: name, set: setName, type: 'text', placeholder: 'Your name' },
                    { label: 'Email', icon: <Mail size={14} />, value: email, set: setEmail, type: 'email', placeholder: 'you@example.com' },
                  ].map(({ label, icon, value, set, type, placeholder }) => (
                    <div key={label}>
                      <label style={{ display: 'block', color: V.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: V.muted, pointerEvents: 'none' }}>{icon}</span>
                        <input type={type} value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder}
                          style={{ ...inputStyle, paddingLeft: 36 }}
                          onFocus={(e) => e.target.style.borderColor = V.accent}
                          onBlur={(e) => e.target.style.borderColor = V.border} />
                      </div>
                    </div>
                  ))}
                  <div>
                    <label style={{ display: 'block', color: V.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <Lock size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: V.muted, pointerEvents: 'none' }} />
                      <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters"
                        style={{ ...inputStyle, paddingLeft: 36, paddingRight: 40 }}
                        onFocus={(e) => e.target.style.borderColor = V.accent}
                        onBlur={(e) => e.target.style.borderColor = V.border}
                        onKeyDown={(e) => e.key === 'Enter' && handleEmailSignup()} />
                      <button type="button" onClick={() => setShowPass((s) => !s)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted, padding: 2 }}>
                        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <button type="button" disabled={loading || !name || !email || !password} onClick={handleEmailSignup}
                    style={{ padding: '12px', borderRadius: 10, border: 'none', background: V.accent, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: loading ? 0.7 : 1 }}>
                    {loading ? 'Creating account…' : <><ArrowRight size={15} /> Create Account</>}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', color: V.muted, fontSize: 12, marginTop: 20, lineHeight: 1.6 }}>
          By signing up you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
