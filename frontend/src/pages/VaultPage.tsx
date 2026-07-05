import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Eye, EyeOff, Copy, Check, Loader2,
  KeyRound, Search, X, ShieldCheck,
} from 'lucide-react';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)',
} as const;

const SECRET_TYPES = [
  { id: 'api_key',      label: 'API Key',             color: '#6366f1' },
  { id: 'token',        label: 'Access Token',        color: '#8b5cf6' },
  { id: 'password',     label: 'Password',            color: '#ec4899' },
  { id: 'aws_creds',    label: 'AWS',                 color: '#f97316' },
  { id: 'gcp_sa',       label: 'GCP',                 color: '#3b82f6' },
  { id: 'azure_creds',  label: 'Azure',               color: '#0ea5e9' },
  { id: 'database_url', label: 'Database URL',        color: '#10b981' },
  { id: 'ssh_key',      label: 'SSH Key',             color: '#f59e0b' },
  { id: 'webhook_url',  label: 'Webhook URL',         color: '#64748b' },
  { id: 'other',        label: 'Other',               color: '#6b7280' },
];

function typeColor(t: string) { return SECRET_TYPES.find(s => s.id === t)?.color ?? '#6b7280'; }
function typeLabel(t: string) { return SECRET_TYPES.find(s => s.id === t)?.label ?? t; }

interface Secret {
  id: string; name: string; secret_type: string; description: string | null;
  value: string; created_at: string | null;
}

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', background: V.bg, border: `1px solid ${V.border}`,
    borderRadius: 8, padding: '0.5rem 0.75rem', color: V.text,
    fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none', ...extra,
  };
}

// ─── Add Modal ────────────────────────────────────────────────────────────────

interface AddModalProps { onClose: () => void; onSaved: (s: Secret) => void; }

function AddModal({ onClose, onSaved }: AddModalProps) {
  const [form, setForm] = useState({ name: '', secret_type: 'api_key', value: '', description: '' });
  const [showVal, setShowVal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!form.name.trim() || !form.value.trim()) return;
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/vault', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? 'Failed to save');
      onSaved(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: '1.5rem', width: 480, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: V.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={16} style={{ color: V.accent }} /> New Secret
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: V.muted, cursor: 'pointer', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {err && (
          <div style={{ background: `${V.red}18`, border: `1px solid ${V.red}44`, borderRadius: 8, padding: '0.6rem 0.875rem', fontSize: '0.82rem', color: V.red, marginBottom: '0.875rem' }}>
            {err}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: V.muted, marginBottom: 4 }}>Name *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. OPENAI_API_KEY"
              style={inp()}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: V.muted, marginBottom: 4 }}>Type</label>
            <select
              value={form.secret_type}
              onChange={e => setForm(f => ({ ...f, secret_type: e.target.value }))}
              style={{ ...inp(), cursor: 'pointer', colorScheme: 'dark' }}
            >
              {SECRET_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: V.muted, marginBottom: 4 }}>Value *</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showVal ? 'text' : 'password'}
              value={form.value}
              onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
              placeholder="Paste the secret value"
              style={{ ...inp(), paddingRight: '4.5rem', fontFamily: showVal ? 'monospace' : 'inherit' }}
            />
            <button
              type="button"
              onClick={() => setShowVal(v => !v)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted, fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              {showVal ? <EyeOff size={12} /> : <Eye size={12} />}
              {showVal ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: V.muted, marginBottom: 4 }}>Description <span style={{ color: V.muted, fontWeight: 400 }}>(optional)</span></label>
          <input
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="What is this secret used for?"
            style={inp()}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={save}
            disabled={saving || !form.name.trim() || !form.value.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1.25rem', background: V.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', opacity: (!form.name.trim() || !form.value.trim()) ? 0.5 : 1 }}
          >
            {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
            Save Secret
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '0.5rem 1rem', background: 'transparent', border: `1px solid ${V.border}`, borderRadius: 8, color: V.muted, fontSize: '0.85rem', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Secret Row ───────────────────────────────────────────────────────────────

function SecretRow({ secret, onDelete }: { secret: Secret; onDelete: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [plainVal, setPlainVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [delConfirm, setDelConfirm] = useState(false);

  async function fetchPlain() {
    if (plainVal) { setRevealed(v => !v); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/vault/${secret.id}/reveal`, { method: 'POST', credentials: 'include' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail);
      setPlainVal(data.value);
      setRevealed(true);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }

  async function copyToClipboard() {
    let val = plainVal;
    if (!val) {
      try {
        const r = await fetch(`/api/vault/${secret.id}/reveal`, { method: 'POST', credentials: 'include' });
        const data = await r.json();
        if (r.ok) { val = data.value; setPlainVal(data.value); }
      } catch { return; }
    }
    await navigator.clipboard.writeText(val).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const displayValue = revealed && plainVal ? plainVal : secret.value;
  const color = typeColor(secret.secret_type);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 1rem', background: V.surface, border: `1px solid ${V.border}`, borderRadius: 10, transition: 'border-color 0.15s' }}>
      {/* Type badge */}
      <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${color}18`, color, border: `1px solid ${color}30`, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {typeLabel(secret.secret_type)}
      </span>

      {/* Name + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: V.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {secret.name}
        </div>
        {secret.description && (
          <div style={{ fontSize: '0.75rem', color: V.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {secret.description}
          </div>
        )}
      </div>

      {/* Masked / revealed value */}
      <code style={{ fontSize: '0.78rem', color: V.muted, fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {displayValue}
      </code>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {/* Reveal toggle */}
        <button
          type="button"
          title={revealed ? 'Hide value' : 'Reveal value'}
          onClick={fetchPlain}
          disabled={loading}
          style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : revealed ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>

        {/* Copy */}
        <button
          type="button"
          title="Copy to clipboard"
          onClick={copyToClipboard}
          style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: copied ? V.green : V.muted, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>

        {/* Delete */}
        {delConfirm ? (
          <>
            <button
              type="button"
              onClick={() => onDelete(secret.id)}
              style={{ padding: '0.3rem 0.6rem', borderRadius: 6, border: `1px solid ${V.red}44`, background: `${V.red}18`, color: V.red, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setDelConfirm(false)}
              style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <button
            type="button"
            title="Delete secret"
            onClick={() => setDelConfirm(true)}
            style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: `1px solid ${V.border}`, background: 'transparent', color: V.muted, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Vault Page ───────────────────────────────────────────────────────────────

export default function VaultPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/vault', { credentials: 'include' });
      const data = await r.json();
      setSecrets(data.secrets ?? []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteSecret(id: string) {
    await fetch(`/api/vault/${id}`, { method: 'DELETE', credentials: 'include' });
    setSecrets(prev => prev.filter(s => s.id !== id));
  }

  const usedTypes = [...new Set(secrets.map(s => s.secret_type))];

  const filtered = secrets.filter(s => {
    const matchType = typeFilter === 'all' || s.secret_type === typeFilter;
    const matchSearch = !search.trim() || s.name.toLowerCase().includes(search.toLowerCase()) || (s.description ?? '').toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <div style={{ padding: '2rem', maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: V.text, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `${V.accent}22`, border: `1px solid ${V.accent}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <KeyRound size={16} style={{ color: V.accent }} />
            </div>
            Vault
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: V.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={12} style={{ color: V.green }} />
            All values encrypted at rest with AES-256 (Fernet)
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1.1rem', background: V.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <Plus size={14} /> Add Secret
        </button>
      </div>

      {/* Search + filter bar */}
      {secrets.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: V.muted, pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter secrets…"
              style={{ ...inp(), paddingLeft: 30, paddingRight: search ? 30 : '0.75rem' }}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: V.muted, display: 'flex', alignItems: 'center' }}>
                <X size={12} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', ...usedTypes].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                style={{ padding: '0.3rem 0.75rem', borderRadius: 6, border: `1px solid ${typeFilter === t ? V.accent : V.border}`, background: typeFilter === t ? `${V.accent}18` : 'transparent', color: typeFilter === t ? V.accent : V.muted, fontSize: '0.78rem', fontWeight: typeFilter === t ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {t === 'all' ? `All (${secrets.length})` : typeLabel(t)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2rem', color: V.muted, fontSize: '0.875rem' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3.5rem 1rem', border: `1px dashed ${V.border}`, borderRadius: 12, color: V.muted }}>
          {secrets.length === 0 ? (
            <>
              <KeyRound size={36} style={{ color: V.muted, marginBottom: '0.875rem', opacity: 0.4 }} />
              <div style={{ fontWeight: 600, color: V.text, marginBottom: 6 }}>No secrets yet</div>
              <div style={{ fontSize: '0.82rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
                Store API keys, passwords, tokens, and cloud credentials encrypted at rest.
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.5rem 1.25rem', background: V.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
              >
                <Plus size={14} /> Add your first secret
              </button>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, color: V.text, marginBottom: 4 }}>No results</div>
              <div style={{ fontSize: '0.82rem' }}>Try a different search or filter</div>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(s => (
            <SecretRow key={s.id} secret={s} onDelete={deleteSecret} />
          ))}
        </div>
      )}

      {/* Count */}
      {secrets.length > 0 && !loading && (
        <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: V.muted, textAlign: 'right' }}>
          {filtered.length === secrets.length ? `${secrets.length} secret${secrets.length !== 1 ? 's' : ''}` : `${filtered.length} of ${secrets.length}`}
        </div>
      )}

      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onSaved={s => { setSecrets(prev => [s, ...prev]); setShowAdd(false); }}
        />
      )}
    </div>
  );
}
