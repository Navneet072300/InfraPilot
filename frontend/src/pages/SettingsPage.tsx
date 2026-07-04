import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import {
  Plus, Trash2, Edit2, CheckCircle2, Loader2,
  GitBranch, Shield, Server, Star, AlertTriangle, X,
  Eye, EyeOff, User, Bell, Cpu, CreditCard, Users, FileText,
  Smartphone, Copy, RefreshCw, ChevronRight, ChevronLeft,
  Lock, ToggleLeft, ToggleRight, ExternalLink, Plug,
  BellRing, Check, Send, Globe, Mail, MessageSquare, ChevronDown,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useClusterStore } from '../store/clusterStore';
import { useAuthStore } from '../store/authStore';
import type { ClusterConfig } from '../types';
import type {
  GeneralSettings, NotificationPrefs, AISettings, ActiveSession,
  TeamMember, TeamInvite, AuditEntry,
} from '../types/settings';
import { DEFAULT_NOTIF_PREFS } from '../types/settings';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)', purple: 'var(--accent)',
} as const;

type Tab = 'general' | 'security' | 'notifications' | 'alerts' | 'ai' | 'billing' | 'team' | 'audit';

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'general',       label: 'General',       icon: <User size={15} /> },
  { id: 'security',      label: 'Security',       icon: <Shield size={15} /> },
  { id: 'notifications', label: 'Notifications',  icon: <Bell size={15} /> },
  { id: 'alerts',        label: 'Alerts',         icon: <BellRing size={15} /> },
  { id: 'ai',            label: 'AI & Models',    icon: <Cpu size={15} /> },
  { id: 'billing',       label: 'Billing',        icon: <CreditCard size={15} /> },
  { id: 'team',          label: 'Team',           icon: <Users size={15} /> },
  { id: 'audit',         label: 'Audit Log',      icon: <FileText size={15} /> },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', background: V.bg, border: `1px solid ${V.border}`,
    borderRadius: 8, padding: '0.5rem 0.75rem', color: V.text,
    fontSize: '0.875rem', boxSizing: 'border-box', ...extra,
  };
}

function sel(extra?: React.CSSProperties): React.CSSProperties {
  return { ...inp(), cursor: 'pointer', colorScheme: 'dark', ...extra };
}

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 10, padding: '1.25rem', ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: '0 0 0.75rem', color: V.text, fontWeight: 600, fontSize: '0.95rem' }}>{children}</h3>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', color: V.muted, fontSize: '0.78rem', marginBottom: 4, fontWeight: 500 }}>{children}</label>;
}

function SaveBtn({ saving, saved, onClick, disabled }: { saving?: boolean; saved?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving || disabled}
      style={{
        padding: '0.5rem 1.25rem', borderRadius: 8, border: 'none',
        background: saved ? V.green : V.accent, color: '#fff', cursor: 'pointer',
        fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center',
        gap: 6, opacity: saving || disabled ? 0.6 : 1, transition: 'background 0.2s',
      }}
    >
      {saving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
      {saved ? '✓ Saved' : 'Save Changes'}
    </button>
  );
}

function ErrorBanner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div style={{ background: 'rgba(248,81,73,0.1)', border: `1px solid ${V.red}`, borderRadius: 8, padding: '0.75rem', color: V.red, fontSize: '0.85rem', marginBottom: '1rem' }}>
      {msg}
    </div>
  );
}

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.detail || `Request failed (${r.status})`);
  }
  return r.json();
}

// ─── Cluster Form ─────────────────────────────────────────────────────────────

interface ClusterFormProps {
  initial?: Partial<ClusterConfig>;
  onSave: (data: Partial<ClusterConfig>) => void;
  onClose: () => void;
  loading?: boolean;
  error?: string | null;
}

function ClusterForm({ initial, onSave, onClose, loading, error }: ClusterFormProps) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    environment: initial?.environment ?? 'dev',
    connection_type: initial?.connection_type ?? 'token',
    api_url: initial?.api_url ?? '',
    token: '',
    kubeconfig: '',
  });
  const [showToken, setShowToken] = useState(false);
  const [testResult, setTestResult] = useState<{ healthy?: boolean; error?: string; version?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const isEdit = !!initial?.name;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      const body: Record<string, string> = { connection_type: form.connection_type };
      if (form.api_url) body.api_url = form.api_url;
      if (form.token) body.token = form.token;
      if (form.kubeconfig) body.kubeconfig = form.kubeconfig;
      let res;
      if (isEdit) {
        const r = await fetch(`/api/settings/clusters/${encodeURIComponent(initial!.name!)}/test`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        res = await r.json();
      } else {
        const r = await fetch('/api/platform/test-cluster', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.name || 'test', ...body }),
        });
        res = await r.json();
      }
      setTestResult(res);
    } catch (e) {
      setTestResult({ healthy: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  function handleSubmit() {
    const payload: Partial<ClusterConfig> = {
      name: form.name,
      environment: form.environment as ClusterConfig['environment'],
      connection_type: form.connection_type,
      api_url: form.api_url || undefined,
    };
    if (form.token && !form.token.includes('***')) payload.token = form.token;
    if (form.kubeconfig && !form.kubeconfig.includes('***')) payload.kubeconfig = form.kubeconfig;
    onSave(payload);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ color: V.text, fontWeight: 600, fontSize: '1.1rem', margin: 0 }}>
            {isEdit ? 'Edit Cluster' : 'Add Cluster'}
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}>
            <X size={18} />
          </button>
        </div>
        <ErrorBanner msg={error ?? null} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {!isEdit && (
            <div>
              <Label>Cluster Name *</Label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. dev-aks" style={inp()} />
            </div>
          )}
          <div>
            <Label>Environment</Label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['dev', 'staging', 'prod'] as const).map((env) => (
                <button key={env} type="button" onClick={() => set('environment', env)}
                  style={{ flex: 1, padding: '0.4rem', borderRadius: 8, border: `1px solid ${form.environment === env ? V.accent : V.border}`, background: form.environment === env ? 'rgba(88,166,255,0.1)' : 'transparent', color: form.environment === env ? V.accent : V.muted, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }}>
                  {env}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Connection Type</Label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[{ val: 'token', label: 'Bearer Token' }, { val: 'kubeconfig', label: 'Kubeconfig' }].map(({ val, label }) => (
                <button key={val} type="button" onClick={() => set('connection_type', val)}
                  style={{ flex: 1, padding: '0.4rem', borderRadius: 8, border: `1px solid ${form.connection_type === val ? V.accent : V.border}`, background: form.connection_type === val ? 'rgba(88,166,255,0.1)' : 'transparent', color: form.connection_type === val ? V.accent : V.muted, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {form.connection_type === 'token' ? (
            <>
              <div>
                <Label>API Server URL</Label>
                <input value={form.api_url} onChange={(e) => set('api_url', e.target.value)} placeholder="https://k8s.example.com:6443" style={inp()} />
              </div>
              <div>
                <Label>Bearer Token {isEdit && <span style={{ color: V.muted, fontStyle: 'italic' }}>(leave blank to keep current)</span>}</Label>
                <div style={{ position: 'relative' }}>
                  <input type={showToken ? 'text' : 'password'} value={form.token} onChange={(e) => set('token', e.target.value)} placeholder={isEdit ? '••••••••••••' : 'eyJhbGciOiJSUzI1NiIs...'} style={inp({ paddingRight: '2.5rem' })} />
                  <button type="button" onClick={() => setShowToken(!showToken)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}>
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <Label>Kubeconfig {isEdit && <span style={{ color: V.muted, fontStyle: 'italic' }}>(leave blank to keep current)</span>}</Label>
              <textarea value={form.kubeconfig} onChange={(e) => set('kubeconfig', e.target.value)} placeholder="Paste kubeconfig YAML here..." rows={6}
                style={{ ...inp(), fontFamily: 'monospace', resize: 'vertical', fontSize: '0.8rem' }} />
            </div>
          )}
          {testResult && (
            <div style={{ borderRadius: 8, padding: '0.625rem 0.75rem', fontSize: '0.8rem', background: testResult.healthy ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)', border: `1px solid ${testResult.healthy ? V.green : V.red}`, color: testResult.healthy ? V.green : V.red }}>
              {testResult.healthy ? `✓ Connected — ${testResult.version || 'cluster reachable'}` : `✗ ${testResult.error || 'Connection failed'}`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.625rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleTest} disabled={testing}
            style={{ padding: '0.5rem 1rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.text, cursor: 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            {testing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={14} />} Test
          </button>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={loading || (!isEdit && !form.name)}
            style={{ padding: '0.5rem 1.25rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.6 : 1 }}>
            {loading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {isEdit ? 'Save Changes' : 'Add Cluster'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({ name, onConfirm, onClose }: { name: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: V.surface, border: `1px solid ${V.red}`, borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <AlertTriangle size={20} color={V.red} />
          <h2 style={{ margin: 0, color: V.text, fontSize: '1rem', fontWeight: 600 }}>Delete Cluster</h2>
        </div>
        <p style={{ color: V.muted, fontSize: '0.875rem', margin: '0 0 1.25rem' }}>
          Are you sure you want to delete <strong style={{ color: V.text }}>{name}</strong>? This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
          <button type="button" onClick={onConfirm} style={{ padding: '0.5rem 1rem', borderRadius: 8, border: 'none', background: V.red, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── General Tab ──────────────────────────────────────────────────────────────

function GeneralTab() {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [form, setForm] = useState<GeneralSettings>({
    name: user?.name || '',
    email: user?.email || '',
    avatar_color: user?.avatar_color || 'var(--accent)',
    timezone: 'UTC',
    default_environment: 'dev',
    default_iac_tool: 'terraform',
    default_cloud: 'aws',
    default_namespace: 'default',
    code_font_size: 14,
    experience_level: user?.experience_level ?? 'devops',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dangerConfirm, setDangerConfirm] = useState('');
  const [dangerAction, setDangerAction] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => {
      if (d.general) setForm((f) => ({ ...f, ...d.general }));
    }).catch(() => {});
  }, []);

  const set = (k: keyof GeneralSettings, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch('/api/settings/general', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).detail || 'Save failed');
      setUser?.({ experience_level: form.experience_level ?? undefined });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  const AVATAR_COLORS = ['var(--accent)', '#8b5cf6', '#ec4899', 'var(--error)', '#f97316', '#eab308', 'var(--success)', '#06b6d4', 'var(--accent)'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <ErrorBanner msg={err} />

      {/* Profile */}
      <SectionCard>
        <SectionTitle>Profile</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: `linear-gradient(135deg, ${form.avatar_color}, ${form.avatar_color}88)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {form.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'U'}
          </div>
          <div>
            <div style={{ color: V.muted, fontSize: '0.78rem', marginBottom: 6 }}>Avatar Color</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {AVATAR_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set('avatar_color', c)}
                  style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: `2px solid ${form.avatar_color === c ? V.text : 'transparent'}`, cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <Label>Display Name</Label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} style={inp()} />
          </div>
          <div>
            <Label>Email</Label>
            {user?.provider === 'github' || user?.provider === 'gitlab' ? (
              <div style={{ position: 'relative' }}>
                <input value={form.email} readOnly style={{ ...inp(), color: 'var(--text-muted)', cursor: 'default', paddingRight: 90 }} />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                  from {user.provider === 'github' ? 'GitHub' : 'GitLab'}
                </span>
              </div>
            ) : (
              <input value={form.email} onChange={(e) => set('email', e.target.value)} type="email" style={inp()} />
            )}
          </div>
        </div>
      </SectionCard>

      {/* Workspace */}
      <SectionCard>
        <SectionTitle>Workspace Defaults</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <Label>Timezone</Label>
            <select value={form.timezone} onChange={(e) => set('timezone', e.target.value)} style={sel()}>
              {['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Default Environment</Label>
            <select value={form.default_environment} onChange={(e) => set('default_environment', e.target.value as GeneralSettings['default_environment'])} style={sel()}>
              <option value="dev">Dev</option>
              <option value="staging">Staging</option>
              <option value="prod">Prod</option>
            </select>
          </div>
          <div>
            <Label>Default IaC Tool</Label>
            <select value={form.default_iac_tool} onChange={(e) => set('default_iac_tool', e.target.value as GeneralSettings['default_iac_tool'])} style={sel()}>
              <option value="terraform">Terraform</option>
              <option value="kustomize">Kustomize</option>
              <option value="helm">Helm</option>
              <option value="ansible">Ansible</option>
            </select>
          </div>
          <div>
            <Label>Default Cloud</Label>
            <select value={form.default_cloud} onChange={(e) => set('default_cloud', e.target.value as GeneralSettings['default_cloud'])} style={sel()}>
              <option value="aws">AWS</option>
              <option value="azure">Azure</option>
              <option value="gcp">GCP</option>
              <option value="bare-metal">Bare Metal</option>
            </select>
          </div>
          <div>
            <Label>Default Namespace</Label>
            <input value={form.default_namespace} onChange={(e) => set('default_namespace', e.target.value)} style={inp()} />
          </div>
        </div>
      </SectionCard>

      {/* Experience level */}
      <SectionCard>
        <SectionTitle>Experience Level</SectionTitle>
        <p style={{ fontSize: '0.8rem', color: V.muted, marginBottom: '0.875rem', lineHeight: 1.5 }}>
          Changes how InfraPilot describes things. <strong style={{ color: V.text }}>I build apps</strong> uses plain English. <strong style={{ color: V.text }}>I manage infrastructure</strong> uses technical terms.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { val: 'builder', icon: '👨‍💻', label: 'I build apps' },
            { val: 'devops',  icon: '⚙️',  label: 'I manage infrastructure' },
            { val: 'learning',icon: '🌱',  label: "I'm learning" },
          ] as { val: GeneralSettings['experience_level']; icon: string; label: string }[]).map(({ val, icon, label }) => (
            <button key={String(val)} type="button"
              onClick={() => setForm((f) => ({ ...f, experience_level: val }))}
              style={{
                flex: 1, padding: '10px 8px',
                background: form.experience_level === val ? 'rgba(88,166,255,0.1)' : 'transparent',
                border: `1.5px solid ${form.experience_level === val ? V.accent : V.border}`,
                borderRadius: 8, cursor: 'pointer',
                color: form.experience_level === val ? V.accent : V.muted,
                fontSize: '0.78rem', fontWeight: form.experience_level === val ? 700 : 400,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                transition: 'all 0.15s',
              }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} saved={saved} onClick={save} />
      </div>

      {/* Platforms link */}
      <SectionCard>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <SectionTitle>Connected Platforms</SectionTitle>
            <p style={{ margin: 0, color: V.muted, fontSize: '0.8rem' }}>
              Manage GitHub, clusters, secrets vaults, and monitoring integrations.
            </p>
          </div>
          <button type="button" onClick={() => navigate('/app/platforms')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.45rem 1rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <Plug size={13} /> Manage connected platforms →
          </button>
        </div>
      </SectionCard>

      {/* Danger Zone */}
      <SectionCard style={{ border: `1px solid rgba(248,81,73,0.4)` }}>
        <SectionTitle>Danger Zone</SectionTitle>
        {[
          { key: 'history', label: 'Clear Generation History', desc: 'Delete all saved generations. This cannot be undone.' },
          { key: 'platforms', label: 'Reset Platform Credentials', desc: 'Remove all stored API keys and tokens.' },
          { key: 'account', label: 'Delete Account', desc: 'Permanently delete your account and all data.' },
        ].map(({ key, label, desc }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 0', borderBottom: `1px solid ${V.border}` }}>
            <div>
              <div style={{ color: V.text, fontSize: '0.875rem', fontWeight: 500 }}>{label}</div>
              <div style={{ color: V.muted, fontSize: '0.78rem' }}>{desc}</div>
            </div>
            <button type="button" onClick={() => setDangerAction(key)}
              style={{ padding: '0.4rem 0.875rem', borderRadius: 8, border: `1px solid ${V.red}`, background: 'transparent', color: V.red, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }}>
              {label.split(' ')[0]}
            </button>
          </div>
        ))}
        {dangerAction && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ color: V.muted, fontSize: '0.8rem', marginBottom: 6 }}>
              Type <strong style={{ color: V.text }}>{['history', 'platforms', 'account'].find((k) => k === dangerAction) === 'history' ? 'clear history' : dangerAction === 'platforms' ? 'reset platforms' : 'delete my account'}</strong> to confirm:
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)}
                placeholder="Type to confirm..." style={inp({ flex: '1' as unknown as undefined })} />
              <button type="button" onClick={() => { setDangerAction(null); setDangerConfirm(''); }}
                style={{ padding: '0.5rem 1rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.875rem' }}>
                Cancel
              </button>
              <button type="button" disabled={dangerConfirm.toLowerCase() !== (dangerAction === 'history' ? 'clear history' : dangerAction === 'platforms' ? 'reset platforms' : 'delete my account')}
                style={{ padding: '0.5rem 1rem', borderRadius: 8, border: 'none', background: V.red, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: dangerConfirm.toLowerCase() !== (dangerAction === 'history' ? 'clear history' : dangerAction === 'platforms' ? 'reset platforms' : 'delete my account') ? 0.4 : 1 }}>
                Confirm
              </button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Password Strength ────────────────────────────────────────────────────────

function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: V.border };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['', V.red, V.yellow, 'var(--success)', 'var(--accent)'];
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score], color: colors[score] };
}

// ─── Security Tab ─────────────────────────────────────────────────────────────

function SecurityTab() {
  // Password section
  const [pw, setPw] = useState({ old: '', new: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const strength = passwordStrength(pw.new);

  // 2FA section
  const [twoFA, setTwoFA] = useState<{ enabled: boolean }>({ enabled: false });
  const [tfaModal, setTfaModal] = useState<'setup' | 'verify' | 'backup' | 'disable' | null>(null);
  const [tfaSetup, setTfaSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [tfaCode, setTfaCode] = useState('');
  const [tfaBackupCodes, setTfaBackupCodes] = useState<string[]>([]);
  const [tfaErr, setTfaErr] = useState<string | null>(null);
  const [tfaLoading, setTfaLoading] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [sessLoading, setSessLoading] = useState(false);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => {
      setTwoFA({ enabled: d.security?.totp_enabled ?? false });
    }).catch(() => {});
    loadSessions();
  }, []);

  async function loadSessions() {
    setSessLoading(true);
    try {
      const d = await apiFetch('/api/auth/sessions');
      setSessions(d.sessions || []);
    } catch { /* ignore */ } finally { setSessLoading(false); }
  }

  async function changePassword() {
    if (pw.new !== pw.confirm) { setPwErr('Passwords do not match'); return; }
    if (pw.new.length < 8) { setPwErr('Password must be at least 8 characters'); return; }
    setPwSaving(true); setPwErr(null);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: pw.old, new_password: pw.new }),
      });
      setPwOk(true); setPw({ old: '', new: '', confirm: '' });
      setTimeout(() => setPwOk(false), 3000);
    } catch (e) {
      setPwErr(String(e));
    } finally { setPwSaving(false); }
  }

  async function startSetup2FA() {
    setTfaLoading(true); setTfaErr(null);
    try {
      const d = await apiFetch('/api/auth/2fa/setup');
      setTfaSetup({ secret: d.secret, uri: d.uri });
      setTfaModal('setup');
    } catch (e) { setTfaErr(String(e)); } finally { setTfaLoading(false); }
  }

  async function verify2FA() {
    setTfaLoading(true); setTfaErr(null);
    try {
      const d = await apiFetch('/api/auth/2fa/enable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: tfaCode }),
      });
      setTfaBackupCodes(d.backup_codes || []);
      setTwoFA({ enabled: true });
      setTfaModal('backup');
    } catch (e) { setTfaErr(String(e)); } finally { setTfaLoading(false); }
  }

  async function disable2FA() {
    setTfaLoading(true); setTfaErr(null);
    try {
      await apiFetch('/api/auth/2fa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: tfaCode }),
      });
      setTwoFA({ enabled: false });
      setTfaModal(null); setTfaCode('');
    } catch (e) { setTfaErr(String(e)); } finally { setTfaLoading(false); }
  }

  async function revokeSession(id: number) {
    try {
      await apiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' });
      setSessions((s) => s.filter((x) => x.id !== id));
    } catch { /* ignore */ }
  }

  async function revokeAllSessions() {
    try {
      await apiFetch('/api/auth/sessions', { method: 'DELETE' });
      await loadSessions();
    } catch { /* ignore */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Password */}
      <SectionCard>
        <SectionTitle>Change Password</SectionTitle>
        <ErrorBanner msg={pwErr} />
        {pwOk && <div style={{ color: V.green, fontSize: '0.85rem', marginBottom: '0.75rem' }}>✓ Password updated successfully</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <Label>Current Password</Label>
            <div style={{ position: 'relative' }}>
              <input type={showOld ? 'text' : 'password'} value={pw.old} onChange={(e) => setPw((p) => ({ ...p, old: e.target.value }))} style={inp({ paddingRight: '2.5rem' })} />
              <button type="button" onClick={() => setShowOld(!showOld)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}>{showOld ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div>
            <Label>New Password</Label>
            <div style={{ position: 'relative' }}>
              <input type={showNew ? 'text' : 'password'} value={pw.new} onChange={(e) => setPw((p) => ({ ...p, new: e.target.value }))} style={inp({ paddingRight: '2.5rem' })} />
              <button type="button" onClick={() => setShowNew(!showNew)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}>{showNew ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
            {pw.new && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: strength.score >= i ? strength.color : V.border, transition: 'background 0.2s' }} />
                  ))}
                </div>
                <div style={{ fontSize: '0.75rem', color: strength.color }}>{strength.label}</div>
              </div>
            )}
          </div>
          <div>
            <Label>Confirm New Password</Label>
            <input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} style={inp({ borderColor: pw.confirm && pw.confirm !== pw.new ? V.red : V.border })} />
          </div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={changePassword} disabled={pwSaving || !pw.old || !pw.new || !pw.confirm}
            style={{ padding: '0.5rem 1.25rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: !pw.old || !pw.new || !pw.confirm ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {pwSaving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            Update Password
          </button>
        </div>
      </SectionCard>

      {/* 2FA */}
      <SectionCard>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <SectionTitle>Two-Factor Authentication</SectionTitle>
            <p style={{ color: V.muted, fontSize: '0.8rem', margin: 0 }}>
              {twoFA.enabled ? 'TOTP 2FA is active on your account.' : 'Add an extra layer of security with an authenticator app.'}
            </p>
          </div>
          {twoFA.enabled
            ? <span style={{ background: 'rgba(63,185,80,0.1)', color: V.green, borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 600 }}>Enabled</span>
            : <span style={{ background: 'rgba(248,81,73,0.1)', color: V.red, borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 600 }}>Disabled</span>}
        </div>
        <div style={{ marginTop: '0.875rem', display: 'flex', gap: 8 }}>
          {twoFA.enabled
            ? <button type="button" onClick={() => { setTfaCode(''); setTfaErr(null); setTfaModal('disable'); }}
                style={{ padding: '0.45rem 1rem', borderRadius: 8, border: `1px solid ${V.red}`, background: 'transparent', color: V.red, cursor: 'pointer', fontSize: '0.85rem' }}>
                Disable 2FA
              </button>
            : <button type="button" onClick={startSetup2FA} disabled={tfaLoading}
                style={{ padding: '0.45rem 1rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                {tfaLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Smartphone size={14} />}
                Set Up 2FA
              </button>}
        </div>
      </SectionCard>

      {/* 2FA Modals */}
      {(tfaModal === 'setup' || tfaModal === 'verify') && tfaSetup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 440 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, color: V.text, fontWeight: 600 }}>Set Up Authenticator</h2>
              <button type="button" onClick={() => { setTfaModal(null); setTfaSetup(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}><X size={18} /></button>
            </div>
            <p style={{ color: V.muted, fontSize: '0.82rem', margin: '0 0 1rem' }}>Scan the QR code with Google Authenticator, Authy, or similar.</p>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: 8, display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <QRCode value={tfaSetup.uri} size={160} />
            </div>
            <div style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: '1rem' }}>
              <div style={{ color: V.muted, fontSize: '0.72rem', marginBottom: 4 }}>Manual entry secret</div>
              <div style={{ color: V.text, fontFamily: 'monospace', fontSize: '0.875rem', letterSpacing: '0.1em', wordBreak: 'break-all' }}>{tfaSetup.secret}</div>
            </div>
            <ErrorBanner msg={tfaErr} />
            <Label>Enter the 6-digit code from your app</Label>
            <input value={tfaCode} onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456" maxLength={6} style={inp({ letterSpacing: '0.2em', fontSize: '1.2rem', textAlign: 'center', marginBottom: '1rem' })} />
            <button type="button" onClick={verify2FA} disabled={tfaLoading || tfaCode.length !== 6}
              style={{ width: '100%', padding: '0.625rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: tfaCode.length !== 6 ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {tfaLoading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              Verify & Enable
            </button>
          </div>
        </div>
      )}

      {tfaModal === 'backup' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 440 }}>
            <h2 style={{ margin: '0 0 0.5rem', color: V.text, fontWeight: 600 }}>Save Your Backup Codes</h2>
            <p style={{ color: V.muted, fontSize: '0.82rem', margin: '0 0 1rem' }}>Store these in a safe place. Each code can only be used once.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.875rem', marginBottom: '1rem' }}>
              {tfaBackupCodes.map((c) => (
                <div key={c} style={{ color: V.text, fontFamily: 'monospace', fontSize: '0.875rem', textAlign: 'center' }}>{c}</div>
              ))}
            </div>
            <button type="button" onClick={() => { navigator.clipboard.writeText(tfaBackupCodes.join('\n')); }}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.85rem', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Copy size={14} /> Copy All
            </button>
            <button type="button" onClick={() => setTfaModal(null)}
              style={{ width: '100%', padding: '0.625rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
              Done — I've saved my codes
            </button>
          </div>
        </div>
      )}

      {tfaModal === 'disable' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: V.surface, border: `1px solid ${V.red}`, borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 400 }}>
            <h2 style={{ margin: '0 0 0.5rem', color: V.text, fontWeight: 600 }}>Disable 2FA</h2>
            <p style={{ color: V.muted, fontSize: '0.82rem', margin: '0 0 1rem' }}>Enter your current 6-digit code to confirm.</p>
            <ErrorBanner msg={tfaErr} />
            <input value={tfaCode} onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456" maxLength={6} style={inp({ letterSpacing: '0.2em', fontSize: '1.2rem', textAlign: 'center', marginBottom: '1rem' })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setTfaModal(null); setTfaCode(''); }}
                style={{ flex: 1, padding: '0.5rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
              <button type="button" onClick={disable2FA} disabled={tfaLoading || tfaCode.length !== 6}
                style={{ flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', background: V.red, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: tfaCode.length !== 6 ? 0.5 : 1 }}>
                {tfaLoading ? '...' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Sessions */}
      <SectionCard>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
          <SectionTitle>Active Sessions</SectionTitle>
          <button type="button" onClick={revokeAllSessions} style={{ padding: '0.35rem 0.75rem', borderRadius: 6, border: `1px solid ${V.red}`, background: 'transparent', color: V.red, cursor: 'pointer', fontSize: '0.78rem' }}>
            Revoke All Others
          </button>
        </div>
        {sessLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: V.muted }} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sessions.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', background: V.surface, borderRadius: 8, border: `1px solid ${s.is_current ? V.accent : V.border}` }}>
                <div>
                  <div style={{ color: V.text, fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {s.device_info}
                    {s.is_current && <span style={{ fontSize: '0.7rem', color: V.accent, background: 'rgba(88,166,255,0.1)', borderRadius: 4, padding: '1px 6px' }}>This device</span>}
                  </div>
                  <div style={{ color: V.muted, fontSize: '0.75rem' }}>{s.ip_address} · {new Date(s.last_active).toLocaleDateString()}</div>
                </div>
                {!s.is_current && (
                  <button type="button" onClick={() => revokeSession(s.id)} style={{ padding: '0.3rem 0.6rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.78rem' }}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
            {sessions.length === 0 && <div style={{ color: V.muted, fontSize: '0.85rem' }}>No active sessions found.</div>}
          </div>
        )}
      </SectionCard>

    </div>
  );
}

// ─── Connected Platforms Tab ──────────────────────────────────────────────────

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

export function ConnectedPlatformsTab() {
  const qc = useQueryClient();
  const { addCluster, updateCluster, removeCluster, setActiveCluster } = useClusterStore();
  const [modal, setModal] = useState<'add' | { edit: ClusterConfig } | { del: string } | null>(null);
  const [mutErr, setMutErr] = useState<string | null>(null);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { healthy?: boolean; error?: string; version?: string }>>({});

  // GitHub PAT
  const [githubPat, setGithubPat] = useState('');
  const [savedPatMask, setSavedPatMask] = useState('');   // masked value from server
  const [patExpiry, setPatExpiry] = useState('');
  const [patSaving, setPatSaving] = useState(false);
  const [patSaved, setPatSaved] = useState(false);
  const [patValidating, setPatValidating] = useState(false);
  const [patValid, setPatValid] = useState<boolean | null>(null);
  const [patUsername, setPatUsername] = useState<string | null>(null);
  const [showPat, setShowPat] = useState(false);
  const [editingPat, setEditingPat] = useState(false);
  const [deletingPat, setDeletingPat] = useState(false);
  const [confirmDeletePat, setConfirmDeletePat] = useState(false);

  const { data: clusters = [], isLoading } = useQuery({
    queryKey: ['settings-clusters'],
    queryFn: () => fetch('/api/settings/clusters').then((r) => r.json()).then((d) => d.clusters as ClusterConfig[]),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    fetch('/api/settings/platform').then((r) => r.json()).then((d) => {
      if (d.github?.pat_expires_at) setPatExpiry(d.github.pat_expires_at);
      if (d.github?.pat) { setSavedPatMask(d.github.pat); setGithubPat(d.github.pat); }
      if (d.github?.username) setPatUsername(d.github.username);
    }).catch(() => {});
  }, []);

  const createMut = useMutation({
    mutationFn: (data: Partial<ClusterConfig>) => fetch('/api/settings/clusters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.detail); })).then((d) => d.cluster),
    onSuccess: (c) => { addCluster(c); qc.invalidateQueries({ queryKey: ['settings-clusters'] }); setModal(null); setMutErr(null); },
    onError: (e: Error) => setMutErr(e.message),
  });

  const editMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<ClusterConfig> }) =>
      fetch(`/api/settings/clusters/${encodeURIComponent(name)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()).then((d) => d.cluster),
    onSuccess: (c) => { updateCluster(c.name, c); qc.invalidateQueries({ queryKey: ['settings-clusters'] }); setModal(null); setMutErr(null); },
    onError: (e: Error) => setMutErr(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => fetch(`/api/settings/clusters/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(() => name),
    onSuccess: (name) => { removeCluster(name); qc.invalidateQueries({ queryKey: ['settings-clusters'] }); setModal(null); },
  });

  const activateMut = useMutation({
    mutationFn: (name: string) => fetch(`/api/settings/clusters/${encodeURIComponent(name)}/activate`, { method: 'POST' }).then(() => name),
    onSuccess: (name) => { setActiveCluster(name); qc.invalidateQueries({ queryKey: ['settings-clusters'] }); },
  });

  async function handleTest(name: string) {
    setTestingName(name);
    try {
      const res = await fetch(`/api/settings/clusters/${encodeURIComponent(name)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then((r) => r.json());
      setTestResults((r) => ({ ...r, [name]: res }));
    } finally { setTestingName(null); }
  }

  async function validateAndSaveGithubPat(token: string) {
    if (!token || token.includes('***')) return;
    setPatValidating(true);
    setPatValid(null);
    setPatUsername(null);
    try {
      const vr = await fetch('/api/github/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pat: token }),
      });
      const vdata = await vr.json();
      if (!(vdata.success || vdata.valid)) {
        setPatValid(false);
        return;
      }
      const username = vdata.username ?? '';
      setPatValid(true);
      if (username) setPatUsername(username);
      setPatSaving(true);
      // Save PAT and username — check that each write succeeded
      const [pr] = await Promise.all([
        fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.pat', value: token }) }),
        username ? fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.username', value: username }) }) : Promise.resolve(new Response('{}', { status: 200 })),
      ]);
      if (!pr.ok) {
        setPatValid(false);
        return;
      }
      setSavedPatMask(token);
      if (username) setPatUsername(username);
      setEditingPat(false);
      setPatSaved(true);
      setTimeout(() => setPatSaved(false), 3000);
    } catch {
      setPatValid(false);
    } finally {
      setPatValidating(false);
      setPatSaving(false);
    }
  }

  async function saveGithubPat() {
    await validateAndSaveGithubPat(githubPat);
  }

  function handlePatPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').trim();
    // Accept classic PATs (ghp_), fine-grained PATs (github_pat_), and OAuth tokens (gho_)
    if (pasted.startsWith('ghp_') || pasted.startsWith('github_pat_') || pasted.startsWith('gho_')) {
      e.preventDefault();
      setGithubPat(pasted);
      validateAndSaveGithubPat(pasted);
    }
  }

  async function deletePat() {
    setDeletingPat(true);
    try {
      await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.pat', value: '' }) });
      await fetch('/api/settings/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'github.username', value: '' }) });
      setGithubPat('');
      setSavedPatMask('');
      setPatUsername(null);
      setPatValid(null);
      setPatExpiry('');
      setEditingPat(false);
    } finally {
      setDeletingPat(false);
    }
  }

  const expiryDays = daysUntil(patExpiry);
  const envColor = (env: string) => env === 'prod' ? V.red : env === 'staging' ? V.yellow : V.green;


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* GitHub */}
      <SectionCard>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch size={18} color={V.text} />
            <SectionTitle>GitHub</SectionTitle>
            {patValid === true && patUsername && (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: V.green, background: 'rgba(63,185,80,0.12)', padding: '2px 8px', borderRadius: 100 }}>
                ✓ @{patUsername}
              </span>
            )}
          </div>
          {/* Generate PAT button — top right */}
          <a
            href="https://github.com/settings/tokens/new?scopes=repo,workflow,write:packages&description=InfraPilot"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 12px',
              background: 'transparent',
              border: `1px solid ${V.accent}`,
              borderRadius: 7,
              color: V.accent,
              fontSize: '0.78rem',
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <ExternalLink size={11} /> Generate PAT
          </a>
        </div>

        {/* Connected view — show when PAT is saved and not editing */}
        {savedPatMask && !editingPat ? (
          <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 9, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: V.green, background: 'rgba(63,185,80,0.12)', padding: '2px 8px', borderRadius: 100, whiteSpace: 'nowrap' }}>● Connected</span>
                <code style={{ fontSize: '0.78rem', color: V.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {savedPatMask.includes('***') ? savedPatMask : `${savedPatMask.slice(0, 8)}${'•'.repeat(16)}`}
                </code>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => { setGithubPat(''); setPatValid(null); setEditingPat(true); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'transparent', border: `1px solid ${V.border}`, borderRadius: 6, color: V.accent, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  <Edit2 size={12} /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeletePat(true)}
                  disabled={deletingPat}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'transparent', border: `1px solid ${V.border}`, borderRadius: 6, color: V.red, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  {deletingPat ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={12} />} Delete
                </button>
                {confirmDeletePat && (
                  <ConfirmDialog
                    title="Remove GitHub token?"
                    message="Your saved PAT will be deleted. You will need to reconnect to access private repositories."
                    confirmLabel="Delete"
                    danger
                    onConfirm={() => { setConfirmDeletePat(false); deletePat(); }}
                    onCancel={() => setConfirmDeletePat(false)}
                  />
                )}
              </div>
            </div>
            {expiryDays !== null && (
              expiryDays <= 14 ? (
                /* Warning / expired banner */
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: expiryDays <= 0 ? 'rgba(248,81,73,0.08)' : 'rgba(210,153,34,0.08)', border: `1px solid ${expiryDays <= 0 ? 'rgba(248,81,73,0.3)' : 'rgba(210,153,34,0.3)'}`, borderRadius: 8 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{expiryDays <= 0 ? '🔴' : '⚠️'}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '0.78rem', fontWeight: 700, color: expiryDays <= 0 ? V.red : V.yellow, margin: '0 0 3px' }}>
                      {expiryDays <= 0 ? 'Token expired' : `Token expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}`}
                    </p>
                    <p style={{ fontSize: '0.72rem', color: V.muted, margin: 0, lineHeight: 1.5 }}>
                      {expiryDays <= 0
                        ? 'Private repo deploys are blocked. Generate a new PAT and paste it below.'
                        : 'Generate a new PAT now to avoid interruption to private repo deployments.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open('https://github.com/settings/tokens/new?scopes=repo,workflow,write:packages&description=InfraPilot', '_blank')}
                    style={{ flexShrink: 0, padding: '4px 10px', background: expiryDays <= 0 ? V.red : V.yellow, border: 'none', borderRadius: 5, color: '#000', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Regenerate
                  </button>
                </div>
              ) : (
                /* Healthy — small inline badge */
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <span style={{ fontSize: '0.75rem', color: V.muted }}>Expires:</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, borderRadius: 4, padding: '2px 7px', background: 'rgba(63,185,80,0.12)', color: V.green }}>
                    in {expiryDays} days
                  </span>
                  <span style={{ fontSize: '0.72rem', color: V.muted }}>({patExpiry})</span>
                </div>
              )
            )}
            {expiryDays === null && savedPatMask && !editingPat && (
              <p style={{ fontSize: '0.72rem', color: V.muted, marginTop: 8 }}>No expiry set — token does not expire.</p>
            )}
          </div>
        ) : (
          <>
            <p style={{ color: V.muted, fontSize: '0.78rem', margin: '0 0 0.875rem', lineHeight: 1.6 }}>
              Click <strong style={{ color: V.text }}>Generate PAT</strong> → GitHub opens with{' '}
              <code style={{ background: V.surface, padding: '1px 4px', borderRadius: 4, fontSize: '0.75rem' }}>repo</code>,{' '}
              <code style={{ background: V.surface, padding: '1px 4px', borderRadius: 4, fontSize: '0.75rem' }}>workflow</code> and{' '}
              <code style={{ background: V.surface, padding: '1px 4px', borderRadius: 4, fontSize: '0.75rem' }}>write:packages</code>{' '}
              pre-selected → generate → paste below. Token is validated and saved automatically.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showPat ? 'text' : 'password'}
                  value={githubPat}
                  onChange={(e) => { setGithubPat(e.target.value); setPatValid(null); }}
                  onPaste={handlePatPaste}
                  placeholder="Paste token here — ghp_xxxxxxxxxxxx"
                  style={inp({
                    paddingRight: '2.5rem',
                    borderColor: patValid === true ? V.green : patValid === false ? V.red : V.border,
                  })}
                />
                <button type="button" onClick={() => setShowPat(!showPat)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted }}>
                  {showPat ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="button"
                onClick={saveGithubPat}
                disabled={patSaving || patValidating || !githubPat || githubPat.includes('***')}
                style={{ padding: '0.5rem 1rem', borderRadius: 8, border: 'none', background: patSaved ? V.green : V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, minWidth: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap' }}
              >
                {patValidating ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Checking…</> : patSaving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : patSaved ? '✓ Saved' : 'Validate & Save'}
              </button>
            </div>

            {patValid === false && (
              <p style={{ fontSize: '0.78rem', color: V.red, marginBottom: '0.5rem' }}>
                ✗ Token invalid or missing scopes. Try generating a new one.
              </p>
            )}
            {patValid === true && (
              <p style={{ fontSize: '0.78rem', color: V.green, marginBottom: '0.5rem' }}>
                ✓ Token verified and saved.
              </p>
            )}

            {editingPat && (
              <button
                type="button"
                onClick={() => { setEditingPat(false); setGithubPat(savedPatMask); setPatValid(null); }}
                style={{ background: 'none', border: 'none', color: V.muted, fontSize: '0.78rem', cursor: 'pointer', padding: 0, marginTop: 4 }}
              >
                ← Cancel
              </button>
            )}
          </>
        )}
      </SectionCard>

      {/* Clusters */}
      <SectionCard>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <SectionTitle>Kubernetes Clusters</SectionTitle>
            <p style={{ margin: '-0.5rem 0 0', color: V.muted, fontSize: '0.78rem' }}>{clusters.length} configured</p>
          </div>
          <button type="button" onClick={() => { setMutErr(null); setModal('add'); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.875rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
            <Plus size={14} /> Add Cluster
          </button>
        </div>
        {isLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: V.muted }} /> : clusters.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: V.muted, border: `1px dashed ${V.border}`, borderRadius: 10 }}>
            <Server size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>No clusters configured yet.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clusters.map((c) => {
              const test = testResults[c.name];
              return (
                <div key={c.name} style={{ background: V.surface, border: `1px solid ${c.active ? V.accent : V.border}`, borderRadius: 10, padding: '0.75rem 0.875rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: test ? (test.healthy ? V.green : V.red) : V.border, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: V.text, fontWeight: 600, fontSize: '0.875rem' }}>{c.name}</span>
                        {c.active && <span style={{ background: 'rgba(88,166,255,0.15)', color: V.accent, borderRadius: 4, padding: '1px 5px', fontSize: '0.68rem', fontWeight: 700 }}>ACTIVE</span>}
                        <span style={{ borderRadius: 4, padding: '1px 5px', fontSize: '0.68rem', fontWeight: 500, background: `${envColor(c.environment)}22`, color: envColor(c.environment) }}>{c.environment}</span>
                      </div>
                      <div style={{ color: V.muted, fontSize: '0.72rem' }}>{c.connection_type === 'kubeconfig' ? 'kubeconfig' : c.api_url || 'Bearer Token'}</div>
                    </div>
                    {test && <div style={{ fontSize: '0.72rem', color: test.healthy ? V.green : V.red }}>{test.healthy ? `✓ ${test.version || 'ok'}` : `✗ ${(test.error || '').slice(0, 30)}`}</div>}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button type="button" onClick={() => handleTest(c.name)} disabled={testingName === c.name} title="Test" style={{ padding: '0.3rem 0.55rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                        {testingName === c.name ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={11} />} Test
                      </button>
                      {!c.active && <button type="button" onClick={() => activateMut.mutate(c.name)} title="Activate" style={{ padding: '0.3rem 0.55rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 3 }}><Star size={11} /></button>}
                      <button type="button" onClick={() => { setMutErr(null); setModal({ edit: c }); }} style={{ padding: '0.3rem 0.55rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Edit2 size={13} /></button>
                      <button type="button" onClick={() => setModal({ del: c.name })} style={{ padding: '0.3rem 0.55rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.red, cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Trash2 size={13} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>


      {/* Cluster modals */}
      {modal === 'add' && <ClusterForm onSave={(data) => createMut.mutate(data)} onClose={() => setModal(null)} loading={createMut.isPending} error={mutErr} />}
      {modal && typeof modal === 'object' && 'edit' in modal && <ClusterForm initial={modal.edit} onSave={(data) => editMut.mutate({ name: modal.edit.name, data })} onClose={() => setModal(null)} loading={editMut.isPending} error={mutErr} />}
      {modal && typeof modal === 'object' && 'del' in modal && <DeleteConfirm name={modal.del} onConfirm={() => deleteMut.mutate(modal.del)} onClose={() => setModal(null)} />}

      <SecretsVaultSection />
    </div>
  );
}

// ─── Secrets Vault ────────────────────────────────────────────────────────────

const SECRET_TYPES = [
  { id: 'api_key',      label: 'API Key',             color: '#6366f1' },
  { id: 'token',        label: 'Access Token',        color: '#8b5cf6' },
  { id: 'password',     label: 'Password',            color: '#ec4899' },
  { id: 'aws_creds',    label: 'AWS Credentials',     color: '#f97316' },
  { id: 'gcp_sa',       label: 'GCP Service Account', color: '#3b82f6' },
  { id: 'azure_creds',  label: 'Azure Credentials',   color: '#0ea5e9' },
  { id: 'database_url', label: 'Database URL',        color: '#10b981' },
  { id: 'ssh_key',      label: 'SSH Key',             color: '#f59e0b' },
  { id: 'webhook_url',  label: 'Webhook URL',         color: '#64748b' },
  { id: 'other',        label: 'Other',               color: '#6b7280' },
];

interface SecretEntry {
  id: string; name: string; type: string; description: string; value: string; created_at: string;
}

function typeColor(type: string) {
  return SECRET_TYPES.find(t => t.id === type)?.color ?? '#6b7280';
}
function typeLabel(type: string) {
  return SECRET_TYPES.find(t => t.id === type)?.label ?? type;
}

function SecretsVaultSection() {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'api_key', value: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [showValue, setShowValue] = useState(false);

  useEffect(() => {
    fetch('/api/settings/secrets', { credentials: 'include' })
      .then(r => r.json()).then(d => setSecrets(d.secrets ?? [])).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function addSecret() {
    if (!form.name.trim() || !form.value.trim()) return;
    setSaving(true);
    try {
      const r = await fetch('/api/settings/secrets', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      const entry = await r.json();
      setSecrets(prev => [...prev, entry]);
      setForm({ name: '', type: 'api_key', value: '', description: '' });
      setShowAdd(false);
      setShowValue(false);
    } catch { /* toast handled by global */ }
    finally { setSaving(false); }
  }

  async function removeSecret(id: string) {
    await fetch(`/api/settings/secrets/${id}`, { method: 'DELETE', credentials: 'include' });
    setSecrets(prev => prev.filter(s => s.id !== id));
  }

  return (
    <SectionCard>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
        <SectionTitle>Secrets & Credentials</SectionTitle>
        <button type="button" onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.85rem', background: V.accent, border: 'none', borderRadius: 7, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={13} /> Add Secret
        </button>
      </div>
      <p style={{ fontSize: '0.8rem', color: V.muted, margin: '0 0 0.875rem', lineHeight: 1.5 }}>
        Store API keys, passwords, tokens and cloud credentials securely. Values are masked in the UI. Use the Deploy Wizard to bulk-upload .env files.
      </p>

      {loading && <div style={{ color: V.muted, fontSize: '0.82rem' }}>Loading…</div>}

      {!loading && secrets.length === 0 && !showAdd && (
        <div style={{ padding: '1.25rem', textAlign: 'center', border: `1px dashed ${V.border}`, borderRadius: 8, color: V.muted, fontSize: '0.82rem' }}>
          No secrets stored yet. Click <strong style={{ color: V.text }}>Add Secret</strong> to store an API key, password, or credential.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: showAdd ? '0.75rem' : 0 }}>
        {secrets.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.625rem 0.75rem', background: V.surface, borderRadius: 8, border: `1px solid ${V.border}` }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: `${typeColor(s.type)}18`, color: typeColor(s.type), border: `1px solid ${typeColor(s.type)}30`, whiteSpace: 'nowrap' }}>
              {typeLabel(s.type)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: V.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
              {s.description && <div style={{ fontSize: '0.75rem', color: V.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>}
            </div>
            <code style={{ fontSize: '0.75rem', color: V.muted, fontFamily: 'monospace', flexShrink: 0 }}>{s.value}</code>
            <button type="button" onClick={() => removeSecret(s.id)} style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.red, cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <div style={{ border: `1px solid ${V.accent}40`, borderRadius: 10, padding: '0.875rem', background: `${V.accent}06` }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: V.text, marginBottom: '0.75rem' }}>New Secret</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '0.625rem' }}>
            <div>
              <Label>Name *</Label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. OpenAI API Key" style={inp()} />
            </div>
            <div>
              <Label>Type</Label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={sel()}>
                {SECRET_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '0.625rem' }}>
            <Label>Value *</Label>
            <div style={{ position: 'relative' }}>
              <input
                type={showValue ? 'text' : 'password'}
                value={form.value}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                placeholder="Paste the secret value here"
                style={{ ...inp(), paddingRight: 64 }}
              />
              <button type="button" onClick={() => setShowValue(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted, fontSize: '0.72rem' }}>
                {showValue ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <Label>Description (optional)</Label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What is this secret used for?" style={inp()} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={addSecret} disabled={saving || !form.name.trim() || !form.value.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1rem', background: V.accent, border: 'none', borderRadius: 7, color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', opacity: (!form.name.trim() || !form.value.trim()) ? 0.5 : 1 }}>
              {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
              Save Secret
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setForm({ name: '', type: 'api_key', value: '', description: '' }); setShowValue(false); }} style={{ padding: '0.5rem 0.875rem', background: 'transparent', border: `1px solid ${V.border}`, borderRadius: 7, color: V.muted, fontSize: '0.82rem', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Notifications Tab ────────────────────────────────────────────────────────

const NOTIF_GROUPS: { label: string; keys: (keyof NotificationPrefs)[]; desc?: string }[] = [
  { label: 'Pipelines', keys: ['pipeline_completed', 'pipeline_failed', 'pipeline_approval', 'pipeline_step'] },
  { label: 'Kubernetes', keys: ['pod_crashloop', 'node_not_ready', 'high_memory', 'pod_restarts'] },
  { label: 'Usage', keys: ['daily_usage_summary', 'approaching_limits', 'new_features'] },
  { label: 'Delivery', keys: ['inapp', 'email', 'slack'] },
];

const NOTIF_LABELS: Record<string, string> = {
  pipeline_completed: 'Pipeline completed', pipeline_failed: 'Pipeline failed', pipeline_approval: 'Approval required',
  pipeline_step: 'Step-by-step updates', pod_crashloop: 'Pod CrashLoopBackOff', node_not_ready: 'Node NotReady',
  high_memory: 'High memory usage', pod_restarts: 'Pod restart events', daily_usage_summary: 'Daily usage digest',
  approaching_limits: 'Approaching plan limits', new_features: 'New features & updates',
  inapp: 'In-app notifications', email: 'Email notifications', slack: 'Slack webhook',
};

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-checked={on} role="switch"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: on ? V.accent : V.muted }}>
      {on ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
    </button>
  );
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF_PREFS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => {
      if (d.notifications) setPrefs({ ...DEFAULT_NOTIF_PREFS, ...d.notifications });
    }).catch(() => {});
  }, []);

  function toggle(k: keyof NotificationPrefs) {
    setPrefs((p) => ({ ...p, [k]: !p[k] }));
  }

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/settings/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {NOTIF_GROUPS.map(({ label, keys }) => (
        <SectionCard key={label}>
          <SectionTitle>{label}</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {keys.map((k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: `1px solid ${V.border}` }}>
                <span style={{ color: V.text, fontSize: '0.875rem' }}>{NOTIF_LABELS[k]}</span>
                <Toggle on={prefs[k]} onToggle={() => toggle(k)} />
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} saved={saved} onClick={save} />
      </div>
    </div>
  );
}

// ─── AI & Models Tab ──────────────────────────────────────────────────────────

const AGENT_NAMES = ['Code Generator', 'Diagram Architect', 'K8s Diagnostician', 'Pipeline Builder', 'IaC Generator'];

function AIModelsTab() {
  const [form, setForm] = useState<AISettings>({
    primary_endpoint: 'https://eo9fkwadwkvrsp-8888.proxy.runpod.net',
    primary_model: 'gemma4:31b',
    secondary_endpoint: '',
    secondary_model: '',
    temperature: 0.2,
    max_tokens: 4096,
    streaming: true,
    system_prompt_addendum: '',
  });
  const [health, setHealth] = useState<{ ok: boolean; latency?: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [agentModels, setAgentModels] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => {
      if (d.ai) setForm((f) => ({ ...f, ...d.ai }));
    }).catch(() => {});
  }, []);

  const set = (k: keyof AISettings, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function checkHealth() {
    setChecking(true); setHealth(null);
    try {
      const d = await apiFetch('/api/settings/ai/health');
      setHealth({ ok: d.healthy, latency: d.latency_ms });
    } catch {
      setHealth({ ok: false });
    } finally { setChecking(false); }
  }

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/settings/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Primary endpoint */}
      <SectionCard>
        <SectionTitle>Primary Model Endpoint</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <Label>Endpoint URL</Label>
            <input value={form.primary_endpoint} onChange={(e) => set('primary_endpoint', e.target.value)} placeholder="https://eo9fkwadwkvrsp-8888.proxy.runpod.net" style={inp()} />
          </div>
          <div>
            <Label>Model</Label>
            <input value={form.primary_model} onChange={(e) => set('primary_model', e.target.value)} placeholder="gemma4:31b" style={inp()} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={checkHealth} disabled={checking}
            style={{ padding: '0.4rem 0.875rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.text, cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            {checking ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
            Check Health
          </button>
          {health && (
            <span style={{ fontSize: '0.8rem', color: health.ok ? V.green : V.red }}>
              {health.ok ? `✓ Reachable (${health.latency}ms)` : '✗ Unreachable'}
            </span>
          )}
        </div>
      </SectionCard>

      {/* Fallback endpoint */}
      <SectionCard>
        <SectionTitle>Fallback Endpoint</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
          <div>
            <Label>Endpoint URL</Label>
            <input value={form.secondary_endpoint} onChange={(e) => set('secondary_endpoint', e.target.value)} placeholder="Optional fallback" style={inp()} />
          </div>
          <div>
            <Label>Model</Label>
            <input value={form.secondary_model} onChange={(e) => set('secondary_model', e.target.value)} placeholder="claude-haiku-4-5-20251001" style={inp()} />
          </div>
        </div>
      </SectionCard>

      {/* Per-agent assignment */}
      <SectionCard>
        <SectionTitle>Per-Agent Model Assignment</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {AGENT_NAMES.map((name) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: `1px solid ${V.border}` }}>
              <span style={{ color: V.text, fontSize: '0.875rem' }}>{name}</span>
              <select value={agentModels[name] || 'primary'} onChange={(e) => setAgentModels((m) => ({ ...m, [name]: e.target.value }))}
                style={{ ...sel(), width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}>
                <option value="primary">Primary ({form.primary_model || 'default'})</option>
                {form.secondary_model && <option value="secondary">Fallback ({form.secondary_model})</option>}
              </select>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Generation settings */}
      <SectionCard>
        <SectionTitle>Generation Settings</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <Label>Temperature: {form.temperature.toFixed(2)}</Label>
            <input type="range" min={0} max={1} step={0.05} value={form.temperature} onChange={(e) => set('temperature', parseFloat(e.target.value))} style={{ width: '100%', accentColor: V.accent }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: V.muted }}>
              <span>Precise (0)</span><span>Creative (1)</span>
            </div>
          </div>
          <div>
            <Label>Max Tokens: {form.max_tokens.toLocaleString()}</Label>
            <input type="range" min={512} max={16384} step={512} value={form.max_tokens} onChange={(e) => set('max_tokens', parseInt(e.target.value))} style={{ width: '100%', accentColor: V.accent }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: V.muted }}>
              <span>512</span><span>16,384</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: V.text, fontSize: '0.875rem' }}>Streaming responses</span>
            <Toggle on={form.streaming} onToggle={() => set('streaming', !form.streaming)} />
          </div>
          <div>
            <Label>System Prompt Addendum</Label>
            <textarea value={form.system_prompt_addendum} onChange={(e) => set('system_prompt_addendum', e.target.value)} rows={4}
              placeholder="Additional instructions appended to every system prompt..." style={{ ...inp(), fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
        </div>
      </SectionCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} saved={saved} onClick={save} />
      </div>
    </div>
  );
}

// ─── Billing Tab ──────────────────────────────────────────────────────────────

const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
const PLAN_COLOR: Record<string, string> = { free: V.muted, pro: V.accent, team: V.purple, enterprise: V.yellow };
const PLAN_LIMITS: Record<string, { ai: number | 'unlimited'; pipelines: number | 'unlimited'; diagnose: number | 'unlimited' }> = {
  free:       { ai: 50,          pipelines: 3,           diagnose: 3 },
  pro:        { ai: 'unlimited', pipelines: 'unlimited',  diagnose: 'unlimited' },
  team:       { ai: 'unlimited', pipelines: 'unlimited',  diagnose: 'unlimited' },
  enterprise: { ai: 'unlimited', pipelines: 'unlimited',  diagnose: 'unlimited' },
};

function UsageBar({ label, used, limit, color }: { label: string; used: number; limit: number | 'unlimited'; color: string }) {
  const pct = limit === 'unlimited' ? 0 : Math.min(100, (used / (limit as number)) * 100);
  const nearLimit = limit !== 'unlimited' && pct >= 80;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: V.muted, marginBottom: 5 }}>
        <span>{label}</span>
        <span style={{ color: nearLimit ? V.red : V.text, fontWeight: 600 }}>
          {limit === 'unlimited' ? `${used} used · Unlimited` : `${used} / ${limit}`}
        </span>
      </div>
      {limit !== 'unlimited' && (
        <div style={{ height: 5, background: V.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: nearLimit ? V.red : color, borderRadius: 3, transition: 'width 0.4s ease' }} />
        </div>
      )}
    </div>
  );
}

const QUICK_INVOICES = [
  { date: 'Jun 1, 2026', desc: 'Pro Plan — Monthly', amount: '$49.00' },
  { date: 'May 1, 2026', desc: 'Pro Plan — Monthly', amount: '$49.00' },
  { date: 'Apr 1, 2026', desc: 'Pro Plan — Monthly', amount: '$49.00' },
];

function BillingTab() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const plan = user?.plan ?? 'free';
  const planLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const planColor = PLAN_COLOR[plan] ?? V.muted;

  // Mock usage for display — real values come from /api/subscription/usage
  const usedAI = plan === 'free' ? 12 : 847;
  const usedPipelines = plan === 'free' ? 1 : 34;
  const usedDiagnose = plan === 'free' ? 0 : 12;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Plan card */}
      <SectionCard>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 8, background: `${planColor}18`, border: `1px solid ${planColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CreditCard size={17} color={planColor} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: V.text }}>{PLAN_LABEL[plan]} Plan</div>
              <div style={{ fontSize: '0.75rem', color: V.muted }}>
                {plan === 'free' ? 'No payment method on file' : 'Renews Jul 29, 2026 · •••• 4242'}
              </div>
            </div>
          </div>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: planColor, background: `${planColor}18`, border: `1px solid ${planColor}33`, borderRadius: 6, padding: '3px 9px', textTransform: 'uppercase' }}>
            Active
          </span>
        </div>

        {/* Usage bars */}
        <SectionTitle>Today's Usage</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.25rem' }}>
          <UsageBar label="AI requests" used={usedAI} limit={planLimits.ai} color={V.accent} />
          <UsageBar label="Pipeline runs" used={usedPipelines} limit={planLimits.pipelines} color={V.purple} />
          <UsageBar label="Diagnose runs" used={usedDiagnose} limit={planLimits.diagnose} color={V.green} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => navigate('/app/subscription')}
            style={{ flex: 1, padding: '0.575rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {plan === 'free' ? 'Upgrade Plan' : 'Manage Subscription'} <ChevronRight size={14} />
          </button>
          {plan !== 'free' && (
            <button type="button"
              style={{ padding: '0.575rem 1rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.85rem' }}>
              Cancel
            </button>
          )}
        </div>
      </SectionCard>

      {/* Invoice history */}
      {plan !== 'free' && (
        <SectionCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <div style={{ color: V.text, fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent Invoices</div>
            <button type="button" onClick={() => navigate('/app/subscription')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: V.muted, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              View all <ChevronRight size={12} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {QUICK_INVOICES.map((inv) => (
              <div key={inv.date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: V.bg, borderRadius: 7, fontSize: '0.82rem' }}>
                <div>
                  <div style={{ color: V.text, fontWeight: 500 }}>{inv.desc}</div>
                  <div style={{ color: V.muted, fontSize: '0.72rem' }}>{inv.date}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, color: V.text }}>{inv.amount}</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, background: 'rgba(63,185,80,0.1)', color: V.green, borderRadius: 4, padding: '2px 6px' }}>Paid</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Upgrade nudge for free */}
      {plan === 'free' && (
        <SectionCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.25rem 0' }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Star size={16} color={V.accent} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: V.text, marginBottom: 2 }}>Unlock Design & Monitor modes</div>
              <div style={{ fontSize: '0.78rem', color: V.muted }}>Pro gives you unlimited AI, 5 clusters, custom model endpoints, and more.</div>
            </div>
            <button type="button" onClick={() => navigate('/app/subscription')}
              style={{ padding: '0.45rem 1rem', borderRadius: 7, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
              See plans
            </button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────

function TeamTab() {
  const { user } = useAuthStore();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [wsName, setWsName] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    if (user?.plan !== 'team') return;
    setLoading(true);
    Promise.all([
      apiFetch('/api/team/members').then((d) => { setMembers(d.members || []); }),
      apiFetch('/api/team/invites').then((d) => { setInvites(d.invites || []); }),
      apiFetch('/api/settings').then((d) => { if (d.team?.workspace_name) setWsName(d.team.workspace_name); }),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, [user?.plan]);

  if (user?.plan !== 'team') {
    return (
      <SectionCard style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
        <Lock size={36} color={V.muted} style={{ marginBottom: '1rem' }} />
        <h3 style={{ margin: '0 0 0.5rem', color: V.text }}>Team Plan Required</h3>
        <p style={{ color: V.muted, fontSize: '0.875rem', margin: '0 0 1.5rem' }}>Upgrade to Team to invite members, assign roles, and collaborate.</p>
        <button type="button" onClick={() => {}} style={{ padding: '0.625rem 1.5rem', borderRadius: 8, border: 'none', background: V.purple, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
          Upgrade to Team
        </button>
      </SectionCard>
    );
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const d = await apiFetch('/api/team/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
      setInvites((i) => [...i, d.invite]);
      setInviteEmail('');
    } catch { /* ignore */ } finally { setInviting(false); }
  }

  async function cancelInvite(id: number) {
    try {
      await apiFetch(`/api/team/invites/${id}`, { method: 'DELETE' });
      setInvites((i) => i.filter((x) => x.id !== id));
    } catch { /* ignore */ }
  }

  async function removeMember(id: number) {
    try {
      await apiFetch(`/api/team/members/${id}`, { method: 'DELETE' });
      setMembers((m) => m.filter((x) => x.id !== id));
    } catch { /* ignore */ }
  }

  async function saveTeamSettings() {
    try {
      await apiFetch('/api/settings/team', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_name: wsName }) });
      setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 2000);
    } catch { /* ignore */ }
  }

  const roleColor = (role: string) => role === 'owner' ? V.accent : role === 'admin' ? V.purple : V.muted;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Team settings */}
      <SectionCard>
        <SectionTitle>Team Settings</SectionTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Label>Workspace Name</Label>
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="My Team" style={inp()} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <SaveBtn saving={false} saved={settingsSaved} onClick={saveTeamSettings} />
          </div>
        </div>
      </SectionCard>

      {/* Members */}
      <SectionCard>
        <SectionTitle>Members ({members.length})</SectionTitle>
        {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: V.muted }} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', background: V.surface, borderRadius: 8, border: `1px solid ${V.border}` }}>
                <div>
                  <div style={{ color: V.text, fontSize: '0.875rem', fontWeight: 500 }}>{m.name} {m.is_current && <span style={{ fontSize: '0.7rem', color: V.accent }}>(you)</span>}</div>
                  <div style={{ color: V.muted, fontSize: '0.75rem' }}>{m.email}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: roleColor(m.role), background: `${roleColor(m.role)}18`, borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase' }}>{m.role}</span>
                  {!m.is_current && m.role !== 'owner' && (
                    <button type="button" onClick={() => removeMember(m.id)} style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.red, cursor: 'pointer' }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Invite */}
      <SectionCard>
        <SectionTitle>Invite Member</SectionTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@example.com" type="email" style={inp()} />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ ...sel(), width: 'auto', padding: '0.5rem 0.625rem' }}>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="button" onClick={invite} disabled={inviting || !inviteEmail.trim()}
            style={{ padding: '0.5rem 1rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, opacity: !inviteEmail.trim() ? 0.5 : 1 }}>
            {inviting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
            Invite
          </button>
        </div>
        {invites.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ color: V.muted, fontSize: '0.78rem', marginBottom: 6 }}>Pending Invites</div>
            {invites.map((inv) => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: V.surface, borderRadius: 8, border: `1px solid ${V.border}`, marginBottom: 4 }}>
                <div>
                  <span style={{ color: V.text, fontSize: '0.85rem' }}>{inv.email}</span>
                  <span style={{ color: V.muted, fontSize: '0.75rem', marginLeft: 8 }}>· {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                </div>
                <button type="button" onClick={() => cancelInvite(inv.id)} style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer' }}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actionType, setActionType] = useState('');
  const [loading, setLoading] = useState(false);
  const LIMIT = 20;

  async function load(p = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (search) params.set('search', search);
      if (actionType) params.set('action_type', actionType);
      const d = await apiFetch(`/api/audit-log?${params}`);
      setEntries(d.entries || []);
      setTotal(d.total || 0);
      setPage(p);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  useEffect(() => { load(1); }, []);

  function exportCSV() {
    const header = 'Time,Action,Resource,IP,Status\n';
    const rows = entries.map((e) => `${e.created_at},${e.action},${e.resource},${e.ip_address},${e.status}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'audit-log.csv'; a.click();
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)}
          placeholder="Search action or resource..." style={{ ...inp(), flex: '1', minWidth: 200 }} />
        <select value={actionType} onChange={(e) => { setActionType(e.target.value); }}
          style={{ ...sel(), width: 'auto', padding: '0.5rem 0.625rem' }}>
          <option value="">All actions</option>
          <option value="login">Login</option>
          <option value="password_change">Password change</option>
          <option value="cluster">Cluster</option>
          <option value="pipeline">Pipeline</option>
          <option value="api_key">API key</option>
        </select>
        <button type="button" onClick={() => load(1)} style={{ padding: '0.5rem 0.875rem', borderRadius: 8, border: 'none', background: V.accent, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>Filter</button>
        <button type="button" onClick={exportCSV} style={{ padding: '0.5rem 0.875rem', borderRadius: 8, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', fontSize: '0.85rem' }}>Export CSV</button>
      </div>

      {/* Table */}
      <div style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: V.surface }}>
              {['Time', 'Action', 'Resource', 'IP', 'Status'].map((h) => (
                <th key={h} style={{ padding: '0.625rem 0.875rem', textAlign: 'left', color: V.muted, fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: V.muted }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              </td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: V.muted }}>No audit entries found.</td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} style={{ borderTop: `1px solid ${V.border}` }}>
                <td style={{ padding: '0.5rem 0.875rem', color: V.muted, whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString()}</td>
                <td style={{ padding: '0.5rem 0.875rem', color: V.text }}>{e.action}</td>
                <td style={{ padding: '0.5rem 0.875rem', color: V.muted, fontFamily: 'monospace' }}>{e.resource || '—'}</td>
                <td style={{ padding: '0.5rem 0.875rem', color: V.muted }}>{e.ip_address || '—'}</td>
                <td style={{ padding: '0.5rem 0.875rem' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, borderRadius: 4, padding: '2px 6px', background: e.status === 'success' ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)', color: e.status === 'success' ? V.green : V.red }}>
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: V.muted, fontSize: '0.8rem' }}>{total} total entries</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" onClick={() => load(page - 1)} disabled={page <= 1}
            style={{ padding: '0.35rem 0.6rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: page <= 1 ? V.border : V.muted, cursor: page <= 1 ? 'default' : 'pointer' }}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ color: V.text, fontSize: '0.82rem' }}>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => load(page + 1)} disabled={page >= totalPages}
            style={{ padding: '0.35rem 0.6rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: page >= totalPages ? V.border : V.muted, cursor: page >= totalPages ? 'default' : 'pointer' }}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Alerts Tab ───────────────────────────────────────────────────────────────

type ChannelType = 'slack' | 'teams' | 'email' | 'discord' | 'gchat' | 'webhook';
type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

interface AlertChannel {
  id: string;
  channel_type: ChannelType;
  name: string;
  is_active: boolean;
  alert_on: AlertSeverity[];
  config_preview: Record<string, string>;
  created_at: string | null;
}

const CHANNEL_META: Record<ChannelType, { label: string; color: string; icon: React.ReactNode; fields: { key: string; label: string; placeholder: string; guide: string }[] }> = {
  slack: {
    label: 'Slack', color: '#4A154B', icon: <MessageSquare size={14} />,
    fields: [{ key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/…', guide: 'In Slack: Apps → Incoming Webhooks → Add → choose channel → copy Webhook URL' }],
  },
  teams: {
    label: 'Microsoft Teams', color: '#6264A7', icon: <MessageSquare size={14} />,
    fields: [{ key: 'webhook_url', label: 'Incoming Webhook URL', placeholder: 'https://…webhook.office.com/webhookb2/…', guide: 'In Teams: channel → ⋯ → Connectors → Incoming Webhook → Create → copy URL' }],
  },
  email: {
    label: 'Email', color: '#22c55e', icon: <Mail size={14} />,
    fields: [{ key: 'address', label: 'Email address', placeholder: 'you@example.com', guide: 'Alerts are sent from alerts@infrapilot.dev via Resend. Check spam if you don\'t receive the test.' }],
  },
  discord: {
    label: 'Discord', color: '#5865F2', icon: <MessageSquare size={14} />,
    fields: [{ key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…', guide: 'In Discord: Server Settings → Integrations → Webhooks → New Webhook → copy URL' }],
  },
  gchat: {
    label: 'Google Chat', color: '#00AC47', icon: <MessageSquare size={14} />,
    fields: [{ key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://chat.googleapis.com/v1/spaces/…', guide: 'In Google Chat: open a Space → Apps & integrations → Add webhooks → copy URL' }],
  },
  webhook: {
    label: 'Custom Webhook', color: '#6366f1', icon: <Globe size={14} />,
    fields: [
      { key: 'url', label: 'Endpoint URL', placeholder: 'https://your-server.com/infrapilot-hook', guide: 'Your server must respond with 2xx. Payloads are JSON. Add a secret to verify signatures.' },
      { key: 'secret', label: 'HMAC secret (optional)', placeholder: 'your-signing-secret', guide: 'InfraPilot signs each request with SHA-256 HMAC. Verify the X-InfraPilot-Signature header.' },
    ],
  },
};

const SEV_COLORS: Record<AlertSeverity, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e',
};

function AlertsTab() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen]           = useState(false);
  const [editChannel, setEditChannel]   = useState<AlertChannel | null>(null);
  const [testingId, setTestingId]       = useState<string | null>(null);
  const [testResult, setTestResult]     = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [deleting, setDeleting]         = useState<string | null>(null);

  // Form state
  const [formType, setFormType]   = useState<ChannelType>('slack');
  const [formName, setFormName]   = useState('');
  const [formConfig, setFormConfig] = useState<Record<string, string>>({});
  const [formSevs, setFormSevs]   = useState<AlertSeverity[]>(['critical', 'high']);
  const [formErr, setFormErr]     = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [showGuide, setShowGuide] = useState<Record<string, boolean>>({});

  const { data: channels = [], isLoading } = useQuery<AlertChannel[]>({
    queryKey: ['alert-channels'],
    queryFn: async () => { const r = await fetch('/api/alert-channels'); return r.json(); },
  });

  function openAdd() {
    setFormType('slack'); setFormName(''); setFormConfig({}); setFormSevs(['critical', 'high']);
    setFormErr(''); setShowGuide({}); setEditChannel(null); setAddOpen(true);
  }

  function openEdit(ch: AlertChannel) {
    setFormType(ch.channel_type); setFormName(ch.name);
    setFormConfig({}); setFormSevs(ch.alert_on);
    setFormErr(''); setShowGuide({}); setEditChannel(ch); setAddOpen(true);
  }

  async function saveChannel() {
    setFormErr(''); setFormSaving(true);
    try {
      const meta = CHANNEL_META[formType];
      const configValid = meta.fields.every((f) => f.key === 'secret' || formConfig[f.key]?.trim());
      if (!configValid) { setFormErr('Fill in all required fields.'); setFormSaving(false); return; }
      if (!formName.trim()) { setFormErr('Name is required.'); setFormSaving(false); return; }

      const body: Record<string, unknown> = { name: formName, alert_on: formSevs };
      if (editChannel) {
        if (Object.keys(formConfig).length > 0) body.config = formConfig;
        const r = await fetch(`/api/alert-channels/${editChannel.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).detail ?? 'Save failed');
      } else {
        body.channel_type = formType; body.config = formConfig;
        const r = await fetch('/api/alert-channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).detail ?? 'Save failed');
      }
      qc.invalidateQueries({ queryKey: ['alert-channels'] });
      setAddOpen(false);
    } catch (e: unknown) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFormSaving(false);
    }
  }

  async function deleteChannel(id: string) {
    if (!confirm('Delete this alert channel?')) return;
    setDeleting(id);
    await fetch(`/api/alert-channels/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['alert-channels'] });
    setDeleting(null);
  }

  async function testChannel(id: string) {
    setTestingId(id); setTestResult((p) => ({ ...p, [id]: { ok: false, msg: 'Sending…' } }));
    try {
      const r = await fetch(`/api/alert-channels/${id}/test`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Test failed');
      setTestResult((p) => ({ ...p, [id]: { ok: true, msg: data.message ?? 'Sent!' } }));
    } catch (e: unknown) {
      setTestResult((p) => ({ ...p, [id]: { ok: false, msg: e instanceof Error ? e.message : 'Failed' } }));
    } finally {
      setTestingId(null);
    }
  }

  async function toggleActive(ch: AlertChannel) {
    await fetch(`/api/alert-channels/${ch.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !ch.is_active }) });
    qc.invalidateQueries({ queryKey: ['alert-channels'] });
  }

  const sectionStyle: React.CSSProperties = { background: 'var(--bg-surface)', border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.25rem' };
  const btnPrimary: React.CSSProperties = { background: V.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.85rem', fontWeight: 600, padding: '0.5rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 };
  const btnSecondary: React.CSSProperties = { background: 'transparent', border: `1px solid ${V.border}`, borderRadius: 8, color: V.muted, fontSize: '0.8rem', padding: '0.4rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 };
  const inputStyle = inp();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: V.text }}>Alert Channels</h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: V.muted }}>Send incident alerts to Slack, Teams, Email, Discord, Google Chat, or any webhook.</p>
        </div>
        <button type="button" onClick={openAdd} style={btnPrimary}><Plus size={14} />Add Channel</button>
      </div>

      {/* Channel list */}
      {isLoading ? (
        <div style={{ color: V.muted, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />Loading…</div>
      ) : channels.length === 0 ? (
        <div style={{ ...sectionStyle, textAlign: 'center', padding: '2rem' }}>
          <BellRing size={28} color={V.muted} style={{ marginBottom: 10 }} />
          <div style={{ color: V.text, fontSize: '0.9rem', marginBottom: 4 }}>No alert channels yet</div>
          <div style={{ color: V.muted, fontSize: '0.82rem', marginBottom: 16 }}>Add a channel to receive incident notifications.</div>
          <button type="button" onClick={openAdd} style={btnPrimary}><Plus size={13} />Add your first channel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {channels.map((ch) => {
            const meta = CHANNEL_META[ch.channel_type];
            const res = testResult[ch.id];
            return (
              <div key={ch.id} style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 14 }}>
                {/* Type badge */}
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `${meta.color}22`, border: `1px solid ${meta.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color, flexShrink: 0 }}>
                  {meta.icon}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.9rem', color: V.text, fontWeight: 500 }}>{ch.name}</span>
                    <span style={{ fontSize: '0.72rem', color: V.muted }}>({meta.label})</span>
                    {!ch.is_active && <span style={{ fontSize: '0.7rem', color: V.muted, background: `${V.border}`, padding: '1px 6px', borderRadius: 4 }}>Disabled</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                    {ch.alert_on.map((s) => (
                      <span key={s} style={{ fontSize: '0.68rem', color: SEV_COLORS[s], background: `${SEV_COLORS[s]}18`, border: `1px solid ${SEV_COLORS[s]}33`, borderRadius: 100, padding: '1px 7px', fontWeight: 700, textTransform: 'uppercase' }}>{s}</span>
                    ))}
                  </div>
                  {res && (
                    <div style={{ marginTop: 4, fontSize: '0.75rem', color: res.ok ? '#22c55e' : '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {res.ok ? <Check size={10} /> : <X size={10} />}{res.msg}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" onClick={() => toggleActive(ch)} style={{ ...btnSecondary, color: ch.is_active ? V.accent : V.muted }}>
                    {ch.is_active ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                    {ch.is_active ? 'On' : 'Off'}
                  </button>
                  <button type="button" onClick={() => testChannel(ch.id)} disabled={testingId === ch.id || !ch.is_active} style={{ ...btnSecondary, opacity: !ch.is_active ? 0.4 : 1 }}>
                    {testingId === ch.id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={11} />}Test
                  </button>
                  <button type="button" onClick={() => openEdit(ch)} style={btnSecondary}><Edit2 size={11} />Edit</button>
                  <button type="button" onClick={() => deleteChannel(ch.id)} disabled={deleting === ch.id}
                    style={{ ...btnSecondary, color: '#ef4444', borderColor: '#ef444433' }}>
                    {deleting === ch.id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={11} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-surface)', border: `1px solid ${V.border}`, borderRadius: 14, width: '100%', maxWidth: 540, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: `1px solid ${V.border}` }}>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: V.text }}>{editChannel ? 'Edit Channel' : 'Add Alert Channel'}</div>
              <button type="button" onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', color: V.muted, cursor: 'pointer' }}><X size={16} /></button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              {/* Channel type */}
              {!editChannel && (
                <div>
                  <div style={{ fontSize: '0.78rem', color: V.muted, marginBottom: 8 }}>Channel type</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {(Object.keys(CHANNEL_META) as ChannelType[]).map((t) => {
                      const m = CHANNEL_META[t];
                      const active = formType === t;
                      return (
                        <button key={t} type="button" onClick={() => { setFormType(t); setFormConfig({}); setFormErr(''); setShowGuide({}); }}
                          style={{ border: `1px solid ${active ? m.color : V.border}`, borderRadius: 8, background: active ? `${m.color}18` : 'transparent', color: active ? m.color : V.muted, padding: '10px 8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: active ? 700 : 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                          {m.icon}{m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Name */}
              <div>
                <label style={{ fontSize: '0.78rem', color: V.muted, display: 'block', marginBottom: 4 }}>Display name</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={`My ${CHANNEL_META[formType].label} channel`} style={inputStyle} />
              </div>

              {/* Config fields */}
              {CHANNEL_META[formType].fields.map((field) => (
                <div key={field.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <label style={{ fontSize: '0.78rem', color: V.muted }}>{field.label}{field.key !== 'secret' ? ' *' : ''}</label>
                    <button type="button" onClick={() => setShowGuide((p) => ({ ...p, [field.key]: !p[field.key] }))}
                      style={{ background: 'none', border: 'none', color: V.muted, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 2, fontSize: '0.72rem' }}>
                      How to get this <ChevronDown size={10} style={{ transform: showGuide[field.key] ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    </button>
                  </div>
                  {showGuide[field.key] && (
                    <div style={{ background: `${V.accent}12`, border: `1px solid ${V.accent}33`, borderRadius: 6, padding: '8px 12px', marginBottom: 6, fontSize: '0.77rem', color: V.muted }}>{field.guide}</div>
                  )}
                  {editChannel
                    ? <input value={formConfig[field.key] ?? ''} onChange={(e) => setFormConfig((p) => ({ ...p, [field.key]: e.target.value }))} placeholder={`Leave blank to keep existing ${field.label.toLowerCase()}`} style={inputStyle} />
                    : <input value={formConfig[field.key] ?? ''} onChange={(e) => setFormConfig((p) => ({ ...p, [field.key]: e.target.value }))} placeholder={field.placeholder} style={inputStyle} />
                  }
                </div>
              ))}

              {/* Alert on severities */}
              <div>
                <div style={{ fontSize: '0.78rem', color: V.muted, marginBottom: 8 }}>Alert on severity</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['critical', 'high', 'medium', 'low'] as AlertSeverity[]).map((s) => {
                    const on = formSevs.includes(s);
                    return (
                      <button key={s} type="button" onClick={() => setFormSevs((p) => on ? p.filter((x) => x !== s) : [...p, s])}
                        style={{ border: `1px solid ${on ? SEV_COLORS[s] : V.border}`, borderRadius: 100, background: on ? `${SEV_COLORS[s]}20` : 'transparent', color: on ? SEV_COLORS[s] : V.muted, padding: '4px 12px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: on ? 700 : 400, textTransform: 'capitalize' }}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              {formErr && <div style={{ color: '#ef4444', fontSize: '0.8rem' }}>{formErr}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: `1px solid ${V.border}`, paddingTop: '1rem' }}>
                <button type="button" onClick={() => setAddOpen(false)} style={btnSecondary}>Cancel</button>
                <button type="button" onClick={saveChannel} disabled={formSaving} style={{ ...btnPrimary, opacity: formSaving ? 0.7 : 1 }}>
                  {formSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
                  {editChannel ? 'Save changes' : 'Add channel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');

  function renderTab() {
    switch (tab) {
      case 'general':       return <GeneralTab />;
      case 'security':      return <SecurityTab />;
      case 'notifications': return <NotificationsTab />;
      case 'alerts':        return <AlertsTab />;
      case 'ai':            return <AIModelsTab />;
      case 'billing':       return <BillingTab />;
      case 'team':          return <TeamTab />;
      case 'audit':         return <AuditLogTab />;
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, background: V.bg }}>
      {/* Left nav */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: `1px solid ${V.border}`,
        padding: '1.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 2,
        background: 'var(--bg-base)',
      }}>
        <div style={{ color: V.muted, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.75rem', paddingLeft: '0.5rem' }}>
          Settings
        </div>
        {NAV_ITEMS.map(({ id, label, icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '0.5rem 0.75rem', borderRadius: 8, border: 'none',
                background: active ? 'rgba(88,166,255,0.1)' : 'transparent',
                color: active ? V.accent : V.muted,
                cursor: 'pointer', textAlign: 'left', fontSize: '0.85rem',
                fontWeight: active ? 600 : 400, transition: 'all 0.12s',
              }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 1.5rem', color: V.text, fontWeight: 700, fontSize: '1.3rem' }}>
            {NAV_ITEMS.find((n) => n.id === tab)?.label}
          </h1>
          {renderTab()}
        </div>
      </div>
    </div>
  );
}
