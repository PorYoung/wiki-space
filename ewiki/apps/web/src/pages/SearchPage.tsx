import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, FileText, FolderOpen, Globe, Clock, ChevronRight,
  Sparkles,
} from 'lucide-react';
import { apiFetch, decodeAccessToken } from '../lib/api/client';
import { useTheme } from '../theme/ThemeProvider';
import type { Document, Project } from '@ewiki/shared';

interface SearchDocument extends Document {
  summary: string | null;
  snippet: string | null;
}

function highlightText(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text;
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="px-0.5 rounded" style={{ background: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
        {text.slice(idx, idx + keyword.length)}
      </mark>
      {text.slice(idx + keyword.length)}
    </>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return '刚刚';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

type SearchTab = 'docs' | 'projects' | 'sites';

export function SearchPage(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { appearance, toggleAppearance } = useTheme();
  const query = searchParams.get('q') ?? '';
  const [inputValue, setInputValue] = useState(query);
  const [activeTab, setActiveTab] = useState<SearchTab>('docs');
  const inputRef = useRef<HTMLInputElement>(null);
  const user = decodeAccessToken();

  useEffect(() => {
    setInputValue(query);
  }, [query]);

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['search-docs', query],
    queryFn: () => apiFetch<{ items: SearchDocument[]; total: number; page: number; pageSize: number }>(
      `/api/v1/documents?q=${encodeURIComponent(query)}&page=1&pageSize=20`
    ),
    enabled: query.length > 0,
    staleTime: 30_000,
  });

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['search-projects'],
    queryFn: () => apiFetch<{ items: Project[]; total: number }>('/api/v1/projects?page=1&pageSize=100'),
    staleTime: 60_000,
  });

  const filteredProjects = useMemo(() => {
    if (!query || !projectsData?.items) return [];
    const kw = query.toLowerCase();
    return projectsData.items.filter((p) =>
      p.name.toLowerCase().includes(kw) ||
      (p as { description?: string | null }).description?.toLowerCase().includes(kw)
    ).slice(0, 20);
  }, [projectsData, query]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      setSearchParams({ q: inputValue.trim() });
    }
  };

  const goHome = () => navigate('/');

  const docCount = docsData?.total ?? 0;
  const projectCount = filteredProjects.length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)' }}>
      {/* Search header */}
      <header className="sticky top-0 z-30 backdrop-blur-md" style={{ background: 'color-mix(in srgb, var(--bg-page) 85%, transparent)' }}>
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={goHome}
              className="flex items-center gap-2 shrink-0 group"
            >
              <div className="h-9 w-9 rounded-lg flex items-center justify-center transition group-hover:scale-105" style={{ background: 'var(--color-primary-500)' }}>
                <Sparkles size={18} className="text-white" />
              </div>
              <span className="font-semibold text-lg hidden sm:block" style={{ color: 'var(--text-primary)' }}>ewiki</span>
            </button>

            <form onSubmit={handleSearch} className="flex-1 relative">
              <div className="relative">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="搜索文档、项目..."
                  autoFocus
                  className="w-full h-11 pl-11 pr-4 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                  style={{
                    background: 'var(--bg-surface)',
                    borderColor: 'var(--border-soft)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </form>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={toggleAppearance}
                aria-label="切换主题"
                className="rounded-md p-2 transition hover:bg-neutral-100"
                style={{ color: 'var(--text-secondary)' }}
              >
                {appearance === 'dark' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                )}
              </button>
              <Link
                to="/dashboard"
                className="hidden sm:flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition hover:bg-neutral-100"
                style={{ color: 'var(--text-secondary)' }}
              >
                管理
              </Link>
              <div className="h-7 w-7 rounded-full bg-primary-500 text-white flex items-center justify-center text-xs font-medium">
                {user?.name?.charAt(0) ?? 'U'}
              </div>
            </div>
          </div>

          {/* Tabs */}
          {query && (
            <div className="flex items-center gap-1 mt-4 -mb-px">
              {([
                { key: 'docs', label: '文档', icon: FileText, count: docCount },
                { key: 'projects', label: '项目', icon: FolderOpen, count: projectCount },
                { key: 'sites', label: '站点', icon: Globe, count: 0 },
              ] as const).map(({ key, label, icon: Icon, count }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition ${
                    activeTab === key
                      ? 'border-primary-500'
                      : 'border-transparent hover:bg-neutral-50'
                  }`}
                  style={{ color: activeTab === key ? 'var(--color-primary-600)' : 'var(--text-secondary)' }}
                >
                  <Icon size={15} />
                  {label}
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full"
                    style={{
                      background: activeTab === key ? 'var(--color-primary-100)' : 'var(--bg-subtle)',
                      color: activeTab === key ? 'var(--color-primary-700)' : 'var(--text-muted)',
                    }}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-b" style={{ borderColor: 'var(--border-soft)' }} />
      </header>

      {/* Results */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-6">
        {!query ? (
          <EmptySearchState />
        ) : activeTab === 'docs' ? (
          <DocResults
            loading={docsLoading}
            items={docsData?.items ?? []}
            total={docCount}
            query={query}
          />
        ) : activeTab === 'projects' ? (
          <ProjectResults
            loading={projectsLoading}
            items={filteredProjects}
            query={query}
          />
        ) : (
          <SitesTabEmpty />
        )}
      </main>

      <footer className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        ewiki · 让知识流动起来
      </footer>
    </div>
  );
}

function EmptySearchState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="h-16 w-16 rounded-2xl flex items-center justify-center mb-6" style={{ background: 'var(--color-primary-50)' }}>
        <Search size={28} style={{ color: 'var(--color-primary-500)' }} />
      </div>
      <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>开始搜索</h3>
      <p className="text-sm max-w-md" style={{ color: 'var(--text-muted)' }}>
        在上方搜索框输入关键词，查找你有权限访问的所有文档、项目和已发布站点
      </p>
    </div>
  );
}

function DocResults({ loading, items, total, query }: { loading: boolean; items: SearchDocument[]; total: number; query: string }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-5 rounded-xl">
            <div className="skeleton h-5 w-1/3 mb-3" />
            <div className="skeleton h-4 w-full mb-2" />
            <div className="skeleton h-4 w-4/5 mb-3" />
            <div className="skeleton h-3 w-1/4" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--bg-subtle)' }}>
          <FileText size={24} style={{ color: 'var(--text-muted)' }} />
        </div>
        <h3 className="text-base font-medium mb-2" style={{ color: 'var(--text-primary)' }}>未找到相关文档</h3>
        <p className="text-sm max-w-sm" style={{ color: 'var(--text-muted)' }}>
          试试换个关键词，或检查拼写是否正确
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        找到 <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{total}</span> 个相关文档
      </p>
      <div className="space-y-1">
        {items.map((doc) => (
          <Link
            key={doc.id}
            to={`/projects/${doc.projectId}/browse?path=${encodeURIComponent(doc.path)}`}
            className="block card-hover rounded-xl p-5 transition group"
          >
            <div className="flex items-start gap-4">
              <div
                className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition group-hover:scale-105"
                style={{ background: 'var(--color-primary-50)' }}
              >
                <FileText size={20} style={{ color: 'var(--color-primary-500)' }} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium mb-1.5 truncate group-hover:text-primary-600 transition" style={{ color: 'var(--text-primary)' }}>
                  {highlightText(doc.title || doc.path.split('/').pop() || '未命名', query)}
                </h3>
                <p className="text-sm leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                  {doc.snippet
                    ? highlightText(doc.snippet, query)
                    : doc.summary || doc.path}
                </p>
                <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex items-center gap-1">
                    <FolderOpen size={12} />
                    {doc.projectId.slice(0, 8)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {relativeTime(doc.updatedAt)}
                  </span>
                  {doc.wordCount ? (
                    <span>{doc.wordCount.toLocaleString()} 字</span>
                  ) : null}
                  <ChevronRight size={14} className="ml-auto opacity-0 group-hover:opacity-100 transition" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ProjectResults({ loading, items, query }: { loading: boolean; items: Project[]; query: string }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5 rounded-xl">
            <div className="skeleton h-5 w-1/2 mb-3" />
            <div className="skeleton h-4 w-full mb-2" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--bg-subtle)' }}>
          <FolderOpen size={24} style={{ color: 'var(--text-muted)' }} />
        </div>
        <h3 className="text-base font-medium mb-2" style={{ color: 'var(--text-primary)' }}>未找到相关项目</h3>
        <p className="text-sm max-w-sm" style={{ color: 'var(--text-muted)' }}>
          没有匹配的项目，试试其他关键词
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        找到 <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{items.length}</span> 个相关项目
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}/browse`}
            className="block card-hover rounded-xl p-5 transition group"
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition group-hover:scale-105"
                style={{ background: 'var(--color-primary-100)' }}
              >
                <FolderOpen size={20} style={{ color: 'var(--color-primary-600)' }} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium truncate group-hover:text-primary-600 transition" style={{ color: 'var(--text-primary)' }}>
                  {highlightText(p.name, query)}
                </h3>
              </div>
            </div>
            <p className="text-sm line-clamp-2 mb-4" style={{ color: 'var(--text-secondary)' }}>
              {(p as { description?: string | null }).description || '暂无描述'}
            </p>
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {relativeTime(p.updatedAt ?? p.createdAt)}
              </span>
              <span
                className="px-2 py-0.5 rounded-full text-[11px]"
                style={{
                  background: p.visibility === 'public' ? 'var(--color-success-50)' : 'var(--bg-subtle)',
                  color: p.visibility === 'public' ? 'var(--color-success-600)' : 'var(--text-muted)',
                }}
              >
                {p.visibility === 'public' ? '公开' : p.visibility === 'team' ? '团队' : '私有'}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SitesTabEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--bg-subtle)' }}>
        <Globe size={24} style={{ color: 'var(--text-muted)' }} />
      </div>
      <h3 className="text-base font-medium mb-2" style={{ color: 'var(--text-primary)' }}>站点搜索即将上线</h3>
      <p className="text-sm max-w-sm" style={{ color: 'var(--text-muted)' }}>
        已发布站点的全文搜索功能正在开发中，敬请期待
      </p>
    </div>
  );
}
