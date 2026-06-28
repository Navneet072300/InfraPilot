import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { useIsBuilder } from '../../hooks/useTerminology';

interface TipContent {
  title: string;
  body: string;
  learnMore?: string | null;
}

export const HELP_TIPS: Record<string, TipContent> = {
  namespace: {
    title: 'App section',
    body: "Think of this like a folder that keeps your app's files separate from other apps on the same server. Your app lives in its own section so it doesn't interfere with other apps.",
    learnMore: null,
  },
  pod: {
    title: 'App instance',
    body: 'One running copy of your app. If you run 3 copies for reliability, you have 3 pods. If one crashes, the other 2 keep serving users while the crashed one restarts automatically.',
    learnMore: 'Why run multiple copies?',
  },
  secret: {
    title: 'Password / private value',
    body: "Your app needs passwords (like your database password) to run. These are stored encrypted so no one can read them — not even us. Your app gets them automatically when it starts.",
    learnMore: 'How are they kept safe?',
  },
  imagePullBackOff: {
    title: "Can't download app package",
    body: "Before your app can run, the server needs to download a packaged version of your code (called a container image). This error means the download failed — usually because of a missing password for your private code storage.",
    learnMore: null,
  },
  kubeconfig: {
    title: 'Server connection file',
    body: "A file that contains everything InfraPilot needs to talk to your server — the address, a certificate, and a key. It's like a VPN config file but for your Kubernetes cluster.",
    learnMore: 'How do I find this file?',
  },
  pat: {
    title: 'GitHub password for apps',
    body: "A special password you create just for InfraPilot. It's safer than your real GitHub password because: you can delete it anytime, you can limit what it can access, and GitHub alerts you if it gets leaked.",
    learnMore: 'How to create one (2 min)',
  },
  bearerToken: {
    title: 'Server access key',
    body: "A long string of letters and numbers that proves InfraPilot is allowed to talk to your server. Like a very long password that your server understands.",
    learnMore: null,
  },
  helm: {
    title: 'App installer',
    body: "Helm packages your app and all its configuration into a single installable bundle. Like an .exe or .dmg for your server — one command installs everything.",
    learnMore: null,
  },
  kustomize: {
    title: 'Environment settings',
    body: "A tool that lets you have one base app configuration and then layer different settings on top — like one version for testing and one version for live. No duplication.",
    learnMore: null,
  },
  argocd: {
    title: 'Auto-sync tool',
    body: "ArgoCD watches your GitHub for changes. When you push new configuration, ArgoCD automatically applies it to your server. Think of it as a robot that keeps your server in sync with your code.",
    learnMore: null,
  },
  vault: {
    title: 'Password manager for apps',
    body: "HashiCorp Vault is like 1Password but for your servers. It stores all your app's passwords securely and gives them to your app only when needed. Apps never store passwords themselves.",
    learnMore: null,
  },
};

interface HelpTipProps {
  tip: keyof typeof HELP_TIPS;
  size?: number;
}

export function HelpTip({ tip, size = 13 }: HelpTipProps) {
  const isBuilder = useIsBuilder();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const content = HELP_TIPS[tip];

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (!isBuilder || !content) return null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={content.title}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center',
          transition: 'color 0.15s',
        }}
      >
        <HelpCircle size={size} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 8, width: 260, zIndex: 1000,
          background: 'var(--bg-surface)', border: '1px solid var(--accent)',
          borderRadius: 8, padding: '12px 14px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {/* Arrow */}
          <div style={{
            position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
            width: 8, height: 8, background: 'var(--bg-surface)', border: '1px solid var(--accent)',
            borderTop: 'none', borderLeft: 'none',
          }} />
          <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', margin: '0 0 6px' }}>
            {content.title}
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
            {content.body}
          </p>
          {content.learnMore && (
            <a
              href="#"
              style={{ display: 'inline-block', marginTop: 8, fontSize: '11px', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
              onClick={(e) => e.preventDefault()}
            >
              {content.learnMore} →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
