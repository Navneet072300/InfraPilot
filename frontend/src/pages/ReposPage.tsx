import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Lock, Globe, Star, GitFork, Search, RefreshCw, ExternalLink, Rocket, KeyRound, CheckCircle2, ArrowRight } from 'lucide-react';

interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  private: boolean;
  url: string;
  clone_url: string;
  default_branch: string;
  language: string;
  stars: number;
  forks: number;
  updated_at: string;
  topics: string[];
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Go: '#00ADD8', Rust: '#dea584', Java: '#b07219', Ruby: '#701516',
  'C++': '#f34b7d', C: '#555555', Shell: '#89e051', Dockerfile: '#384d54',
};

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

interface NoPATModalProps {
  repo: Repo;
  hasPat: boolean;
  onClose: () => void;
  onRetry: () => void;
  onDeploy: () => void;
}

function NoPATModal({ repo, hasPat, onClose, onRetry, onDeploy }: NoPATModalProps) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '28px 28px 24px', maxWidth: 440, width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        {/* Icon */}
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(210,153,34,0.12)', border: '1px solid rgba(210,153,34,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Lock size={20} style={{ color: 'var(--warning)' }} />
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
          GitHub PAT required
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-secondary)' }}>{repo.full_name}</strong> is a private repository. To deploy it, InfraPilot needs a GitHub Personal Access Token with <code style={{ background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>repo</code> scope so it can clone the code.
        </p>

        {hasPat ? (
          /* PAT was just saved — show success and let them deploy */
          <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 9, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
            <CheckCircle2 size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: 'var(--success)', margin: 0, fontWeight: 600 }}>PAT saved — you're all set!</p>
          </div>
        ) : (
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9, padding: '14px 16px', margin: '20px 0' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>How to fix this</p>
            {[
              'Go to Settings → Connect Platforms → GitHub',
              'Click "Generate PAT" to open GitHub token page',
              'Select repo scope, generate, and paste the token',
              'Come back here — we\'ll detect it automatically',
            ].map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: i < 3 ? 8 : 0 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{step}</p>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {hasPat ? (
            <>
              <button type="button" onClick={onClose} style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={onDeploy}
                style={{ flex: 2, padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Rocket size={13} /> Deploy now
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onRetry} style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>
                Check again
              </button>
              <a
                href="/app/settings"
                style={{ flex: 2, padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}
              >
                <KeyRound size={13} /> Go to Settings <ArrowRight size={12} />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReposPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'public' | 'private'>('all');
  const [page, setPage] = useState(1);
  const [gatedRepo, setGatedRepo] = useState<Repo | null>(null);

  // Check if a PAT is stored
  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['settings-pat-check'],
    queryFn: () => fetch('/api/settings/platform').then((r) => r.json()),
    staleTime: 15_000,
  });
  const hasPat = Boolean(settingsData?.github?.pat);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['github-repos', page],
    queryFn: async () => {
      const r = await fetch(`/api/github/repos?per_page=50&page=${page}`);
      if (!r.ok) throw new Error('Failed to load repositories');
      return r.json() as Promise<{ repos: Repo[]; has_more: boolean; error?: string; auth_required?: boolean }>;
    },
    staleTime: 60_000,
  });

  // When user returns to this tab (e.g. after saving PAT in settings), re-check automatically
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refetchSettings();
        refetch();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetchSettings, refetch]);

  // Once PAT is detected and gatedRepo is set, keep modal open so user can click Deploy now
  useEffect(() => {
    if (hasPat && gatedRepo) {
      // Force re-check so the modal transitions to "PAT saved" state immediately
      refetchSettings();
    }
  }, [hasPat, gatedRepo, refetchSettings]);

  function handleDeploy(repo: Repo) {
    if (repo.private && !hasPat) {
      setGatedRepo(repo);
      return;
    }
    navigate(`/app/pipeline?repo=${encodeURIComponent(repo.clone_url)}${repo.private ? '&private=true' : ''}`);
  }

  const repos = data?.repos ?? [];
  const filtered = repos.filter((r) => {
    if (filter === 'public' && r.private) return false;
    if (filter === 'private' && !r.private) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.language?.toLowerCase().includes(q);
    }
    return true;
  });

  const publicCount = repos.filter((r) => !r.private).length;
  const privateCount = repos.filter((r) => r.private).length;

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-base)', padding: '28px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <GitBranch size={22} style={{ color: 'var(--accent)' }} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Repositories</h1>
            {repos.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                {publicCount} public · {privateCount} private
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}
        >
          <RefreshCw size={13} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Search repositories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(['all', 'public', 'private'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{ padding: '7px 14px', background: filter === f ? 'var(--accent)' : 'transparent', border: 'none', color: filter === f ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: filter === f ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Error / not-configured state */}
      {(isError || data?.error) && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '32px 28px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          <GitBranch size={36} style={{ color: 'var(--accent)', marginBottom: 16 }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            {data?.auth_required ? 'GitHub not connected' : 'Could not load repositories'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>
            {data?.auth_required
              ? 'Generate a Personal Access Token in GitHub and save it in Settings to view your repositories here.'
              : (data?.error ?? 'Make sure your GitHub account is connected in Settings → GitHub.')}
          </p>
          <a
            href="/app/settings"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 20px', background: 'var(--accent)', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
          >
            <KeyRound size={14} /> Save GitHub PAT
          </a>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 10 }} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && !isError && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <GitBranch size={36} style={{ opacity: 0.25, marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {repos.length === 0 ? 'No repositories found' : 'No repositories match your search'}
          </p>
          <p style={{ fontSize: 13 }}>
            {repos.length === 0
              ? 'Connect your GitHub account in Settings → Connect Platforms → GitHub'
              : 'Try a different search term or filter'}
          </p>
        </div>
      )}

      {/* Repo grid */}
      {!isLoading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map((repo) => {
            const needsPat = repo.private && !hasPat;
            return (
              <div
                key={repo.id}
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = needsPat ? 'var(--warning)' : 'var(--accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                {/* Repo name row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      {repo.private
                        ? <Lock size={12} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                        : <Globe size={12} style={{ color: 'var(--success)', flexShrink: 0 }} />}
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {repo.name}
                      </span>
                    </div>
                    {repo.description && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {repo.description}
                      </p>
                    )}
                  </div>
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${repo.full_name} on GitHub`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: 'var(--text-muted)', flexShrink: 0, padding: 2 }}
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>

                {/* Topics */}
                {repo.topics.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {repo.topics.slice(0, 4).map((t) => (
                      <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 100, background: 'rgba(88,166,255,0.1)', color: 'var(--accent)', fontWeight: 600 }}>{t}</span>
                    ))}
                  </div>
                )}

                {/* Meta row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 'auto' }}>
                  {repo.language && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: LANG_COLORS[repo.language] ?? '#888', flexShrink: 0 }} />
                      {repo.language}
                    </span>
                  )}
                  {repo.stars > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                      <Star size={11} /> {repo.stars}
                    </span>
                  )}
                  {repo.forks > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                      <GitFork size={11} /> {repo.forks}
                    </span>
                  )}
                  {repo.updated_at && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                      {timeAgo(repo.updated_at)}
                    </span>
                  )}
                </div>

                {/* Deploy button */}
                <button
                  type="button"
                  onClick={() => handleDeploy(repo)}
                  style={{ width: '100%', padding: '7px', background: 'transparent', border: `1px solid ${needsPat ? 'rgba(210,153,34,0.4)' : 'var(--border)'}`, borderRadius: 7, color: needsPat ? 'var(--warning)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = needsPat ? 'rgba(210,153,34,0.12)' : 'var(--accent)';
                    if (!needsPat) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--accent)'; }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = needsPat ? 'var(--warning)' : 'var(--text-secondary)';
                    e.currentTarget.style.borderColor = needsPat ? 'rgba(210,153,34,0.4)' : 'var(--border)';
                  }}
                >
                  {needsPat ? <><KeyRound size={12} /> Connect PAT to deploy</> : <><Rocket size={12} /> Deploy this repo</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {(data?.has_more || page > 1) && !isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 28 }}>
          {page > 1 && (
            <button type="button" onClick={() => setPage((p) => p - 1)} style={{ padding: '7px 18px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
              ← Previous
            </button>
          )}
          {data?.has_more && (
            <button type="button" onClick={() => setPage((p) => p + 1)} style={{ padding: '7px 18px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Load more →
            </button>
          )}
        </div>
      )}

      {/* PAT gate modal */}
      {gatedRepo && (
        <NoPATModal
          repo={gatedRepo}
          hasPat={hasPat}
          onClose={() => setGatedRepo(null)}
          onRetry={() => refetchSettings()}
          onDeploy={() => {
            navigate(`/app/pipeline?repo=${encodeURIComponent(gatedRepo.clone_url)}`);
            setGatedRepo(null);
          }}
        />
      )}
    </div>
  );
}
