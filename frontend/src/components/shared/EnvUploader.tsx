import { useCallback, useRef, useState } from 'react';
import { Upload, Eye, EyeOff, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

const V = {
  bg: 'var(--bg-base)', surface: 'var(--bg-surface)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-secondary)', accent: 'var(--accent)',
  green: 'var(--success)', red: 'var(--error)', yellow: 'var(--warning)',
} as const;

export interface ParsedSecret {
  name: string;
  value: string;
  secret_type: string;
}

interface Props {
  onSecretsParsed: (secrets: ParsedSecret[]) => void;
  existingSecretNames?: string[];
  context?: 'deployment' | 'vault' | 'platforms';
  onCancel?: () => void;
}

// Heuristic: does this look like a real secret vs plain config?
function looksLikeSecret(key: string, value: string): boolean {
  const secretPatterns = /secret|key|token|password|passwd|pwd|auth|jwt|api_key|credential|private|cert|seed/i;
  const plainPatterns = /^(NODE_ENV|PORT|HOST|DEBUG|LOG_LEVEL|APP_NAME|APP_ENV|TZ|LANG|RAILS_ENV|DJANGO_SETTINGS_MODULE|CI|DISABLE_)$/i;
  if (plainPatterns.test(key)) return false;
  if (secretPatterns.test(key)) return true;
  // Long values (>16 chars) are likely secrets
  return value.length > 16;
}

function guessType(key: string): string {
  const k = key.toUpperCase();
  if (k.includes('DATABASE') || k.includes('DB_URL') || k.includes('POSTGRES') || k.includes('MYSQL') || k.includes('MONGO')) return 'database_url';
  if (k.includes('AWS_') || k.includes('S3_')) return 'aws_creds';
  if (k.includes('GCP_') || k.includes('GOOGLE_')) return 'gcp_sa';
  if (k.includes('AZURE_')) return 'azure_creds';
  if (k.includes('JWT') || k.includes('TOKEN') || k.includes('BEARER')) return 'token';
  if (k.includes('PASSWORD') || k.includes('PASSWD') || k.includes('PWD')) return 'password';
  if (k.includes('SSH')) return 'ssh_key';
  if (k.includes('WEBHOOK')) return 'webhook_url';
  if (k.includes('KEY') || k.includes('SECRET')) return 'api_key';
  return 'other';
}

function parseEnvText(text: string): { secrets: ParsedSecret[]; errors: string[] } {
  const secrets: ParsedSecret[] = [];
  const errors: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      errors.push(`Line ${idx + 1}: no = found`);
      return;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (!key) return;
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    secrets.push({ name: key, value, secret_type: guessType(key) });
  });
  return { secrets, errors };
}

export function EnvUploader({ onSecretsParsed, existingSecretNames = [], context: _context = 'vault', onCancel }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState<ParsedSecret[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const parse = useCallback((text: string) => {
    const { secrets, errors: errs } = parseEnvText(text);
    setParsed(secrets);
    setErrors(errs);
  }, []);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setPasteText(text);
      parse(text);
      setMode('paste');
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleSave() {
    if (!parsed.length) return;
    setSaving(true);
    try {
      const r = await fetch('/api/settings/secrets/bulk', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secrets: parsed }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || 'Save failed');
      onSecretsParsed(parsed);
      setParsed([]); setPasteText(''); setErrors([]);
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setSaving(false);
    }
  }

  const toggleReveal = (name: string) => setRevealed(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const newCount = parsed.filter(s => !existingSecretNames.includes(s.name)).length;
  const overwriteCount = parsed.filter(s => existingSecretNames.includes(s.name)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Mode switcher */}
      <div style={{ display: 'flex', gap: 0, background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: 3, alignSelf: 'flex-start' }}>
        {(['upload', 'paste'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ padding: '5px 16px', borderRadius: 6, border: 'none', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', background: mode === m ? V.surface : 'transparent', color: mode === m ? V.text : V.muted, transition: 'all 0.15s' }}>
            {m === 'upload' ? 'Upload file' : 'Paste content'}
          </button>
        ))}
      </div>

      {mode === 'upload' ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? V.accent : V.border}`,
            borderRadius: 10, padding: '2rem', textAlign: 'center', cursor: 'pointer',
            background: dragging ? `${V.accent}08` : 'transparent',
            transition: 'all 0.15s',
          }}
        >
          <Upload size={24} style={{ marginBottom: 8, color: V.muted }} />
          <p style={{ margin: 0, color: V.text, fontWeight: 500, fontSize: '0.9rem' }}>Drag and drop your .env file here</p>
          <p style={{ margin: '4px 0 12px', color: V.muted, fontSize: '0.78rem' }}>or</p>
          <button type="button" style={{ padding: '6px 18px', borderRadius: 7, border: `1px solid ${V.accent}`, background: 'transparent', color: V.accent, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
            Browse files
          </button>
          <p style={{ margin: '12px 0 0', color: V.muted, fontSize: '0.72rem' }}>Supports: .env, .env.local, .env.production · Plain text KEY=value format</p>
          <input ref={fileRef} type="file" accept=".env,.txt" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      ) : (
        <div>
          <textarea
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); parse(e.target.value); }}
            placeholder={'DATABASE_URL=postgres://user:pass@host/db\nJWT_SECRET=mysecret\nAPI_KEY=sk-abc123'}
            rows={8}
            style={{ width: '100%', background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, padding: '0.75rem', color: V.text, fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
          />
        </div>
      )}

      {/* Parse errors */}
      {errors.length > 0 && (
        <div style={{ background: 'rgba(248,81,73,0.08)', border: `1px solid ${V.red}40`, borderRadius: 8, padding: '0.625rem 0.75rem' }}>
          {errors.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: V.red, fontSize: '0.78rem' }}>
              <AlertTriangle size={12} /> {e}
            </div>
          ))}
        </div>
      )}

      {/* Preview table */}
      {parsed.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.625rem' }}>
            <CheckCircle2 size={14} color={V.green} />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: V.text }}>
              Parsed {parsed.length} secret{parsed.length !== 1 ? 's' : ''}
            </span>
            {newCount > 0 && <span style={{ fontSize: '0.72rem', background: 'rgba(63,185,80,0.12)', color: V.green, borderRadius: 4, padding: '1px 6px' }}>{newCount} new</span>}
            {overwriteCount > 0 && <span style={{ fontSize: '0.72rem', background: 'rgba(210,153,34,0.12)', color: V.yellow, borderRadius: 4, padding: '1px 6px' }}>⚠ {overwriteCount} will overwrite</span>}
          </div>

          <div style={{ border: `1px solid ${V.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', padding: '6px 10px', background: V.surface, borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: V.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Key</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: V.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Value</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: V.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>View</span>
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {parsed.map(s => {
                const isNew = !existingSecretNames.includes(s.name);
                const isSensitive = looksLikeSecret(s.name, s.value);
                const show = revealed.has(s.name);
                return (
                  <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', padding: '7px 10px', borderBottom: `1px solid ${V.border}`, background: !isNew ? 'rgba(210,153,34,0.04)' : 'transparent', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: V.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      {!isNew && <span style={{ fontSize: '0.66rem', color: V.yellow }}>overwrite</span>}
                    </div>
                    <code style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: V.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {!isSensitive ? s.value : show ? s.value : '●'.repeat(Math.min(s.value.length, 12))}
                    </code>
                    {isSensitive ? (
                      <button type="button" onClick={() => toggleReveal(s.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: V.muted, padding: '2px', display: 'flex' }}>
                        {show ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    ) : (
                      <span style={{ color: V.muted, fontSize: '0.72rem', paddingLeft: 4 }}>plain</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 6, fontSize: '0.72rem', color: V.muted, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span>🔒</span> Values are stored encrypted with AES-256. They will be injected into your deployment.
          </div>
        </div>
      )}

      {/* Actions */}
      {(parsed.length > 0 || onCancel) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {parsed.length > 0 && (
            <button type="button" onClick={handleSave} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1.25rem', background: V.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {saving ? 'Saving…' : `Save ${parsed.length} secret${parsed.length !== 1 ? 's' : ''} →`}
            </button>
          )}
          {onCancel && (
            <button type="button" onClick={onCancel}
              style={{ padding: '0.5rem 1rem', background: 'transparent', border: `1px solid ${V.border}`, borderRadius: 8, color: V.muted, fontSize: '0.875rem', cursor: 'pointer' }}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
