import { useState } from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  onTokenSaved: (token: string) => void;
  existingToken?: string;
  daysUntilExpiry?: number | null;
  connectedUsername?: string;
  repoCount?: number;
  tokenAddedDaysAgo?: number | null;
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'JetBrains Mono, monospace',
  outline: 'none',
  boxSizing: 'border-box',
};

function SetupGuide({ title, onSaved }: { title: string; onSaved: (t: string) => void }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showSteps, setShowSteps] = useState(true);

  async function testAndSave() {
    if (!token.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch('/api/github/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pat: token }),
      });
      const data = await r.json();
      if (data.success || data.valid) {
        setTestResult({ ok: true, msg: `Connected${data.username ? ` as @${data.username}` : ' successfully'}` });
        onSaved(token);
      } else {
        setTestResult({ ok: false, msg: data.error || 'Token invalid or missing repo/workflow scopes' });
      }
    } catch {
      setTestResult({ ok: false, msg: 'Connection failed — check your network' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
      <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: 'var(--text-primary)' }}>{title}</p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
        InfraPilot needs access to your GitHub repositories to read code and set up automatic deploys.
      </p>

      <a
        href="https://github.com/settings/tokens/new?scopes=repo,workflow,write:packages&description=InfraPilot"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', background: 'var(--accent)', borderRadius: 6,
          color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none', marginBottom: 16,
        }}
      >
        <ExternalLink size={12} /> Open GitHub token page
      </a>

      <button
        type="button"
        onClick={() => setShowSteps((s) => !s)}
        style={{ marginLeft: 10, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}
      >
        {showSteps ? 'Hide steps ▲' : 'Show steps ▾'}
      </button>

      {showSteps && (
        <ol style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 2, paddingLeft: 18, marginBottom: 16 }}>
          <li>Note name: type <code style={{ color: 'var(--accent)' }}>InfraPilot</code></li>
          <li>Expiration: <strong style={{ color: 'var(--text-primary)' }}>90 days</strong></li>
          <li>Check these boxes: <strong style={{ color: 'var(--text-primary)' }}>repo</strong> and <strong style={{ color: 'var(--text-primary)' }}>workflow</strong> (nothing else needed)</li>
          <li>Click <strong style={{ color: 'var(--text-primary)' }}>Generate token</strong></li>
          <li>Copy it — <strong style={{ color: 'var(--warning)' }}>you only see it once</strong></li>
        </ol>
      )}

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Paste your token here</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type={show ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_●●●●●●●●●●●●●●●"
            style={{ ...inp, paddingRight: 36 }}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          type="button"
          onClick={testAndSave}
          disabled={!token.trim() || testing}
          style={{
            padding: '8px 16px', background: token.trim() ? 'var(--accent)' : 'var(--bg-hover)',
            border: 'none', borderRadius: 6, color: token.trim() ? '#fff' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 600, cursor: token.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
          }}
        >
          {testing ? 'Testing…' : 'Test & Save →'}
        </button>
      </div>

      {testResult && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
          color: testResult.ok ? 'var(--success)' : 'var(--error)', marginBottom: 8,
        }}>
          {testResult.ok ? <CheckCircle2 size={13} /> : null}
          {testResult.msg}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
        🔒 Stored encrypted. We cannot read it.
      </p>
    </div>
  );
}

export function GitHubPATSetup({ onTokenSaved, existingToken, daysUntilExpiry, connectedUsername, repoCount, tokenAddedDaysAgo }: Props) {
  const [rotating, setRotating] = useState(false);

  if (existingToken && !rotating) {
    const expiringSoon = daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry < 14;

    return (
      <div style={{ background: 'var(--bg-surface)', border: `1px solid ${expiringSoon ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>GitHub</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', background: 'rgba(34,197,94,0.1)', padding: '2px 7px', borderRadius: 100 }}>
              ● Connected
            </span>
          </div>
        </div>

        {connectedUsername && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            @{connectedUsername}{repoCount !== undefined ? ` · ${repoCount} repositories` : ''}
          </p>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          Token: <code style={{ color: 'var(--text-primary)' }}>{existingToken}</code>
          {tokenAddedDaysAgo !== null && tokenAddedDaysAgo !== undefined ? ` · Added ${tokenAddedDaysAgo} days ago` : ''}
          {daysUntilExpiry !== null && daysUntilExpiry !== undefined ? ` · Expires in ${daysUntilExpiry} days` : ''}
        </p>

        {expiringSoon && (
          <div style={{ fontSize: 12, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            ⚠️ Token expires in {daysUntilExpiry} days
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={async () => {
              try {
                const r = await fetch('/api/github/validate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ pat: existingToken }),
                });
                const d = await r.json();
                alert(d.valid ? '✓ Connection is working' : `✗ ${d.error}`);
              } catch { alert('Connection test failed'); }
            }}
            style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}
          >
            Test Connection
          </button>
          <button
            type="button"
            onClick={() => setRotating(true)}
            style={{ padding: '5px 12px', background: 'transparent', border: `1px solid ${expiringSoon ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 5, color: expiringSoon ? 'var(--warning)' : 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={11} /> Rotate Token
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Remove GitHub connection?')) {
                onTokenSaved('');
              }
            }}
            style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--error)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Trash2 size={11} /> Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <SetupGuide
      title={rotating ? 'Enter new token to replace current' : 'Connect GitHub'}
      onSaved={(t) => { setRotating(false); onTokenSaved(t); }}
    />
  );
}
