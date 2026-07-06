import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Zap, Terminal, Shield, Copy, Check } from 'lucide-react';
import { useStream } from '../../hooks/useStream';
import type { DiagnosisCause, CauseStatus, SREChatMessage } from '../../types';

// ── CommandConfirmModal (also exported for use in parent) ─────────────────────

function cmdRisk(cmd: string): 'read' | 'write' | 'destructive' {
  const c = cmd.trim().toLowerCase();
  if (/kubectl.*(delete\s+(deployment|namespace|node|service|pv)|exec\b|port-forward\b)/.test(c)) return 'destructive';
  if (/kubectl\s+delete\s+pod\b/.test(c)) return 'destructive';
  if (/kubectl\s+(apply|patch|create|rollout\s+restart|scale)\b/.test(c)) return 'write';
  return 'read';
}

export function CommandConfirmModal({ command, onConfirm, onCancel }: {
  command: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const risk = cmdRisk(command);
  const riskColor = risk === 'destructive' ? 'var(--error)' : risk === 'write' ? 'var(--warning)' : 'var(--success)';
  const riskLabel = risk === 'destructive' ? 'DESTRUCTIVE' : risk === 'write' ? 'WRITE' : 'READ';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, width: 480, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Shield size={16} style={{ color: riskColor }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Confirm Command</span>
          <span style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 100, background: `${riskColor}22`, border: `1px solid ${riskColor}`, color: riskColor, fontSize: 10, fontWeight: 700 }}>
            {riskLabel}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          This command will run on your connected cluster:
        </p>
        <pre style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '0 0 20px' }}>
          {command}
        </pre>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel}
            style={{ padding: '8px 18px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            style={{ padding: '8px 18px', background: riskColor, border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Run Command
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CmdBlock (local, minimal) ─────────────────────────────────────────────────

function CmdBlock({ command, onRun }: { command: string; onRun: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 8, overflow: 'hidden' }}>
      <pre style={{ margin: 0, padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {command}
      </pre>
      <div style={{ borderTop: '1px solid var(--bg-hover)', padding: '3px 7px', display: 'flex', gap: 4 }}>
        <button type="button"
          onClick={() => { navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer', padding: '1px 5px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
          {copied ? <Check size={8} /> : <Copy size={8} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={onRun}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 3, color: '#fff', cursor: 'pointer', padding: '1px 8px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Terminal size={8} /> Run
        </button>
      </div>
    </div>
  );
}

// ── SREChat ───────────────────────────────────────────────────────────────────

interface SREChatProps {
  sessionId: string | null;
  headerData: { severity: string; what_is_happening: string; pod_name?: string | null; namespace?: string | null; cluster?: string | null } | null;
  causes: DiagnosisCause[];
  causeStatuses: Record<string, CauseStatus>;
}

export function SREChat({ sessionId, headerData, causes, causeStatuses }: SREChatProps) {
  const [messages, setMessages] = useState<SREChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [cmdToConfirm, setCmdToConfirm] = useState<string | null>(null);
  const [commandResults, setCommandResults] = useState<{ command: string; output: string }[]>([]);

  const msgIdRef = useRef('');
  const cmdOutputRef = useRef('');
  const cmdMsgIdRef = useRef('');
  const endRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Auto first message once analysis is ready
  useEffect(() => {
    if (sessionId && headerData && !initializedRef.current && causes.length > 0) {
      initializedRef.current = true;
      const top = causes[0];
      const target = headerData.pod_name ? `pod ${headerData.pod_name}` : 'the incident';
      setMessages([{
        id: crypto.randomUUID(), role: 'assistant', timestamp: new Date(),
        content: `I've analyzed ${target}. Most likely cause: **${top.title}** (${top.confidence_percent}% confidence).\n\n${headerData.what_is_happening}\n\nWant me to run the first check to verify?`,
      }]);
    }
  }, [sessionId, headerData, causes]);

  // Chat stream
  const onChunk = useCallback((chunk: string) => {
    setMessages(prev => prev.map(m => m.id === msgIdRef.current ? { ...m, content: m.content + chunk } : m));
  }, []);
  const onEvent = useCallback((ev: Record<string, unknown>) => {
    if (ev.type === 'command_request') {
      const cmd = ev.command as string;
      setMessages(prev => prev.map(m => m.id === msgIdRef.current ? { ...m, command: cmd } : m));
    }
  }, []);
  const onDone = useCallback(() => setLoading(false), []);
  const onError = useCallback((e: string) => {
    setLoading(false);
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${e}`, timestamp: new Date() }]);
  }, []);
  const { start: startChat } = useStream('/api/diagnose/chat', { onChunk, onEvent, onDone, onError });

  // Command execution stream
  const onCmdEvent = useCallback((ev: Record<string, unknown>) => {
    if (ev.type === 'output') {
      cmdOutputRef.current += (ev.text as string) + '\n';
      setMessages(prev => prev.map(m => m.id === cmdMsgIdRef.current ? { ...m, commandOutput: cmdOutputRef.current } : m));
    }
  }, []);
  const onCmdDone = useCallback(() => {
    setCommandResults(prev => [...prev, { command: '', output: cmdOutputRef.current }]);
  }, []);
  const { start: startCmd } = useStream('/api/diagnose/run-command', { onEvent: onCmdEvent, onDone: onCmdDone });

  const history = messages
    .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.command))
    .map(m => ({ role: m.role, content: m.content }));

  const send = useCallback(async () => {
    if (!input.trim() || loading || !sessionId) return;
    const userMsg: SREChatMessage = { id: crypto.randomUUID(), role: 'user', content: input, timestamp: new Date() };
    msgIdRef.current = crypto.randomUUID();
    const assistantMsg: SREChatMessage = { id: msgIdRef.current, role: 'assistant', content: '', timestamp: new Date() };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);
    await startChat({ diagnosis_id: sessionId, message: input, chat_history: history, command_results: commandResults.slice(-5) });
  }, [input, loading, sessionId, startChat, history, commandResults]);

  const runFromChat = useCallback(async (cmd: string) => {
    if (!sessionId) return;
    const risk = cmdRisk(cmd);
    if (risk !== 'read') { setCmdToConfirm(cmd); return; }
    doRunCmd(cmd);
  }, [sessionId]);  // eslint-disable-line

  const doRunCmd = useCallback(async (cmd: string) => {
    if (!sessionId) return;
    cmdMsgIdRef.current = crypto.randomUUID();
    cmdOutputRef.current = '';
    setMessages(prev => [...prev, {
      id: cmdMsgIdRef.current, role: 'assistant', timestamp: new Date(),
      content: 'Running command on cluster…', command: cmd, commandOutput: '',
    }]);
    await startCmd({ diagnosis_id: sessionId, command: cmd, confirmed: true });
  }, [sessionId, startCmd]);

  const suggestions = causes.some(c => causeStatuses[String(c.id)] !== 'confirmed')
    ? ['Run the first check', "What if restarting doesn't fix it?", 'Check node pressure']
    : ["What's next after fixing this?", 'How do I prevent this?'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Zap size={13} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>SRE Assistant</span>
        </div>
        {headerData && (
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {headerData.pod_name || 'incident'}
            {headerData.namespace ? ` · ${headerData.namespace}` : ''}
            {headerData.cluster ? ` · ${headerData.cluster}` : ''}
          </p>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!sessionId && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--text-muted)' }}>
            <Zap size={28} style={{ opacity: 0.2 }} />
            <p style={{ fontSize: 12, textAlign: 'center' }}>Analyze an incident to start<br />the interactive investigation.</p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '92%', padding: '8px 11px',
              borderRadius: msg.role === 'user' ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
              background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-surface)',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
              fontSize: 12, color: msg.role === 'user' ? '#fff' : 'var(--text-secondary)', lineHeight: 1.6,
            }}>
              {msg.content.split('**').map((part, i) =>
                i % 2 === 1
                  ? <strong key={i} style={{ color: msg.role === 'user' ? '#fff' : 'var(--text-primary)' }}>{part}</strong>
                  : part
              )}
              {msg.command && !msg.commandOutput && (
                <CmdBlock command={msg.command} onRun={() => runFromChat(msg.command!)} />
              )}
              {msg.commandOutput && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Output:</p>
                  <pre style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 10, color: '#7ee787', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap', margin: 0, maxHeight: 180, overflow: 'auto' }}>
                    {msg.commandOutput}
                  </pre>
                </div>
              )}
            </div>
            {loading && msg.role === 'assistant' && msg.id === msgIdRef.current && msg.content === '' && (
              <div style={{ padding: '6px 11px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px 8px 8px 2px', display: 'flex', gap: 4 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Suggestions */}
      {sessionId && !loading && (
        <div style={{ padding: '0 14px 8px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {suggestions.map(s => (
            <button key={s} type="button" onClick={() => setInput(s)}
              style={{ padding: '3px 9px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 100, color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            placeholder={sessionId ? 'Ask anything about this incident…' : 'Analyze an incident first…'}
            rows={2} disabled={!sessionId || loading}
            style={{ flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '7px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, opacity: !sessionId ? 0.4 : 1 }}
            onFocus={e => (e.target.style.borderColor = 'var(--border-focus)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
          <button type="button" onClick={send} disabled={!sessionId || loading || !input.trim()}
            style={{ padding: '0 12px', background: sessionId && input.trim() && !loading ? 'var(--accent)' : 'var(--bg-hover)', border: 'none', borderRadius: 6, color: '#fff', cursor: sessionId && input.trim() && !loading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center' }}>
            <Send size={13} />
          </button>
        </div>
      </div>

      {/* Confirm modal (portal would be ideal but inline is fine here) */}
      {cmdToConfirm && (
        <CommandConfirmModal
          command={cmdToConfirm}
          onConfirm={() => { const c = cmdToConfirm; setCmdToConfirm(null); doRunCmd(c); }}
          onCancel={() => setCmdToConfirm(null)}
        />
      )}
    </div>
  );
}
