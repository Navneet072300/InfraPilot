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
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: maxHeight ? undefined : '100%',
        maxHeight,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-base)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {filename ?? ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {streaming && (
            <span style={{ fontSize: '10px', color: 'var(--accent)', animation: 'blink 1s step-end infinite', fontWeight: 600 }}>
              ● live
            </span>
          )}
          <span
            style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
              color: 'var(--accent-text)', background: 'var(--badge-bg)',
              border: '1px solid var(--border)',
              padding: '2px 7px', borderRadius: '4px', fontFamily: 'var(--font-mono)',
            }}
          >
            {LANG_BADGE[language] ?? language.toUpperCase()}
          </span>
          <button
            onClick={handleCopy}
            style={{
              background: copied ? 'var(--success-bg)' : 'var(--bg-hover)',
              border: `1px solid ${copied ? 'var(--success)' : 'var(--border)'}`,
              color: copied ? 'var(--success)' : 'var(--text-secondary)',
              fontSize: '11px', fontWeight: 600, padding: '3px 9px', borderRadius: '6px',
              cursor: 'pointer', transition: 'all 0.15s ease',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Code */}
      <div ref={scrollRef} style={{ overflow: 'auto', flex: 1, background: 'var(--bg-base)', padding: '4px 0' }}>
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
                      fontFamily: 'var(--font-mono)',
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
                    fontSize: '12.5px', fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre', verticalAlign: 'top',
                    color: 'var(--text-primary)', lineHeight: '1.6',
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
