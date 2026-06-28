import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';

export function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { setProfile } = useProfileStore();

  useEffect(() => {
    const error = params.get('error');
    if (error) {
      navigate('/login?error=' + error, { replace: true });
      return;
    }

    // Cookie was set by the backend before redirecting here — just validate it
    fetch('/api/auth/me')
      .then((r) => {
        if (!r.ok) throw new Error('Not authenticated');
        return r.json();
      })
      .then((user) => {
        login(user);
        setProfile({ name: user.name || '', email: user.email || '', plan: user.plan ?? 'free' });
        navigate('/app', { replace: true });
      })
      .catch(() => navigate('/login?error=session_failed', { replace: true }));
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#8b949e', fontSize: 14 }}>
        <div style={{ width: 16, height: 16, border: '2px solid #58a6ff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        Signing you in…
      </div>
    </div>
  );
}
