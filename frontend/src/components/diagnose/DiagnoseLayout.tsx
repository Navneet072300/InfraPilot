import type { ReactNode } from 'react';

interface DiagnoseLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function DiagnoseLayout({ left, center, right }: DiagnoseLayoutProps) {
  return (
    <div style={{
      display: 'flex',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--bg-base)',
    }}>

      {/* ── Left panel — resource browser ──────────────────────────── */}
      <div style={{
        width: 260,
        minWidth: 260,
        maxWidth: 260,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {left}
      </div>

      {/* ── Center panel — issues / logs / describe / events ──────── */}
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-base)',
      }}>
        {center}
      </div>

      {/* ── Right panel — AI analysis + chat ──────────────────────── */}
      <div style={{
        width: 360,
        minWidth: 360,
        maxWidth: 360,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {right}
      </div>

    </div>
  );
}
