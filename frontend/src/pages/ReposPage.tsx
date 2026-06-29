import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Github, Lock, Globe, Star, GitFork, Search, RefreshCw, ExternalLink, Rocket } from 'lucide-react';

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

export function ReposPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'public' | 'private'>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['github-repos', page],
    queryFn: async () => {
      const r = await fetch(`/api/github/repos?per_page=50&page=${page}`);
      if (!r.ok) throw new Error('Failed to load repositories');
      return r.json() as Promise<{ repos: Repo[]; has_more: boolean; error?: string }>;
    },
    staleTime: 60_000,
  });

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
          <Github size={22} style={{ color: 'var(--accent)' }} />
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
        {/* Search */}
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
        {/* Type filter */}
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

      {/* Error state */}
      {(isError || data?.error) && (
        <div style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--error)', marginBottom: 6 }}>Could not load repositories</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            {data?.error ?? 'Make sure your GitHub account is connected in Settings → Connect Platforms → GitHub.'}
          </p>
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

      {/* Repo grid */}
      {!isLoading && filtered.length === 0 && !isError && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <Github size={36} style={{ opacity: 0.25, marginBottom: 12 }} />
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

      {!isLoading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map((repo) => (
            <div
              key={repo.id}
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color 0.15s' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
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
                onClick={() => navigate(`/app/pipeline?repo=${encodeURIComponent(repo.clone_url)}`)}
                style={{ width: '100%', padding: '7px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <Rocket size={12} /> Deploy this repo
              </button>
            </div>
          ))}
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
    </div>
  );
}
