import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LandingPage } from './pages/LandingPage';
import { Onboarding } from './pages/Onboarding';
import { AppLayout } from './components/layout/AppLayout';
import { PipelineMode } from './components/modes/PipelineMode';
import { DeployMode } from './components/modes/DeployMode';
import { GenerateMode } from './components/modes/GenerateMode';
import { DiagnoseMode } from './components/modes/DiagnoseMode';
import { DesignMode } from './components/modes/DesignMode';
import { MonitorMode } from './components/modes/MonitorMode';
import SettingsPage from './pages/SettingsPage';
import ResourcesPage from './pages/ResourcesPage';
import ProfilePage from './pages/ProfilePage';
import HelpPage from './pages/HelpPage';
import SubscriptionPage from './pages/SubscriptionPage';
import { ReposPage } from './pages/ReposPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { AuthCallback } from './components/auth/AuthCallback';
import { useClusterStore } from './store/clusterStore';
import { useAuthStore } from './store/authStore';
import { UserTypeScreen } from './components/shared/UserTypeScreen';
import { useThemeStore } from './store/themeStore';
import { ToastContainer } from './components/shared/ToastContainer';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function ConfigLoader({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const setClusters = useClusterStore((s) => s.setClusters);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/platform/config')
      .then((r) => r.json())
      .then((data: { configured: boolean; clusters?: { name: string; environment: string; active: boolean; connection_type?: string }[] }) => {
        if (data.configured && data.clusters) {
          setClusters(
            data.clusters.map((c) => ({
              name: c.name,
              environment: c.environment as 'dev' | 'staging' | 'prod',
              connection_type: (c.connection_type === 'kubeconfig' ? 'kubeconfig' : 'token') as 'token' | 'kubeconfig',
              api_url: '', token: '', kubeconfig: '', active: c.active,
            }))
          );
        }
        const path = window.location.pathname;
        if (!data.configured && path.startsWith('/app')) {
          navigate('/onboarding', { replace: true });
        }
      })
      .catch(() => {/* Backend not reachable — allow app to open anyway */})
      .finally(() => setReady(true));
  }, [navigate, setClusters]);

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '14px' }}>
          <div style={{ width: '16px', height: '16px', border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const checkSession = useAuthStore((s) => s.checkSession);
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => { checkSession(); }, [checkSession]);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  return <>{children}</>;
}

const Spinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)' }}>
    <div style={{ width: 18, height: 18, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
  </div>
);

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const [typeChosen, setTypeChosen] = useState(false);

  if (isLoading) return <Spinner />;
  if (!isAuthenticated()) return <Navigate to="/login" replace />;

  // Show user-type selection on first login (experience_level not set yet)
  const needsTypeSelection = !isDemoMode && user && user.experience_level === null && !typeChosen;
  if (needsTypeSelection) {
    return <UserTypeScreen onDone={() => setTypeChosen(true)} />;
  }

  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return <Spinner />;
  if (isAuthenticated()) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function AppShell() {
  return (
    <AppLayout>
      <Routes>
        <Route path="pipeline"     element={<PipelineMode />} />
        <Route path="generate"     element={<GenerateMode />} />
        <Route path="diagnose"     element={<DiagnoseMode />} />
        <Route path="design"       element={<DesignMode />} />
        <Route path="monitor"      element={<MonitorMode />} />
        <Route path="repos"        element={<ReposPage />} />
        <Route path="deploy"       element={<DeployMode />} />
        <Route path="history"      element={<HistoryPage />} />
        <Route path="resources"    element={<ResourcesPage />} />
        <Route path="settings"     element={<SettingsPage />} />
        <Route path="profile"      element={<ProfilePage />} />
        <Route path="subscription" element={<SubscriptionPage />} />
        <Route path="help"         element={<HelpPage />} />
        <Route index element={<Navigate to="pipeline" replace />} />
        <Route path="*" element={<Navigate to="pipeline" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
        <ConfigLoader>
          <ToastContainer />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login"  element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
            <Route path="/signup" element={<RedirectIfAuthed><SignupPage /></RedirectIfAuthed>} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/app/*" element={<RequireAuth><AppShell /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConfigLoader>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
