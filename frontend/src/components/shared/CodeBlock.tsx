import { useRef, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/atom-one-dark.css';

hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('python', python);

const HLJS_LANG: Record<string, string> = {
  hcl: 'bash', yaml: 'yaml', json: 'json',
  markdown: 'markdown', bash: 'bash', python: 'python',
  dockerfile: 'bash',
};

const LANG_BADGE: Record<string, string> = {
  hcl: 'HCL', yaml: 'YAML', json: 'JSON',
  markdown: 'MD', bash: 'BASH', python: 'PY',
  dockerfile: 'DOCKER',
};

interface Props {
  content: string;
  language?: string;
  streaming?: boolean;
  filename?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
}

export function CodeBlock({
  content,
  language = 'yaml',
  streaming = false,
  filename,
  showLineNumbers = true,
  maxHeight,
}: Props) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const highlighted = (() => {
    try {
      return hljs.highlight(content || ' ', {
        language: HLJS_LANG[language] ?? 'bash',
      }).value;
    } catch {
      return (content || ' ')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  })();

  const lines = highlighted.split('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: maxHeight ? undefined : '100%',
        maxHeight,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          {filename ?? ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {streaming && (
            <span style={{ fontSize: '10px', color: 'var(--accent)', animation: 'blink 1s step-end infinite' }}>
              ● live
            </span>
          )}
          <span
            style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
              color: 'var(--accent)', background: 'var(--accent-glow)',
              padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace',
            }}
          >
            {LANG_BADGE[language] ?? language.toUpperCase()}
          </span>
          <button
            onClick={handleCopy}
            style={{
              background: copied ? 'rgba(34,197,94,0.12)' : 'var(--bg-hover)',
              border: `1px solid ${copied ? 'var(--success)' : 'var(--border)'}`,
              color: copied ? 'var(--success)' : 'var(--text-muted)',
              fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Code */}
      <div ref={scrollRef} style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                {showLineNumbers && (
                  <td
                    style={{
                      width: '44px', minWidth: '44px', textAlign: 'right',
                      paddingRight: '12px', paddingLeft: '6px',
                      fontSize: '11px', color: 'var(--text-muted)',
                      fontFamily: 'JetBrains Mono, monospace',
                      userSelect: 'none', borderRight: '1px solid var(--border)',
                      verticalAlign: 'top', lineHeight: '1.6',
                    }}
                  >
                    {i + 1}
                  </td>
                )}
                <td
                  style={{
                    paddingLeft: '14px', paddingRight: '14px',
                    fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace',
                    whiteSpace: 'pre', verticalAlign: 'top',
                    color: '#abb2bf', lineHeight: '1.6',
                  }}
                >
                  <code
                    dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }}
                    style={{ background: 'transparent' }}
                  />
                  {streaming && i === lines.length - 1 && (
                    <span
                      style={{
                        display: 'inline-block', width: '7px', height: '13px',
                        background: 'var(--accent)', marginLeft: '2px',
                        verticalAlign: 'middle',
                        animation: 'blink 1s step-end infinite',
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
