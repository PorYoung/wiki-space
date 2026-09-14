import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, FileText, FolderOpen, Globe, Clock, ChevronRight, BookOpen,
  Sparkles,
} from 'lucide-react';
import { apiFetch, decodeAccessToken } from '../lib/api/client';
import { isPublicScope, visibilityLabel } from '../lib/visibility';
import { useTheme } from '../theme/ThemeProvider';
import type { Project } from '@ewiki/shared';

type SearchMode = 'auto' | 'keyword' | 'semantic';

/** GET /api/v1/search 结果项（SEARCH-VECTOR-DESIGN §7.1）：snippet 已服务端转义，仅 <em> 为安全标签 */
interface SearchHitItem {
  documentId: string;
  projectId: string;
  projectName?: string | null;
  path: string;
  title: string;
  snippet: string;
  score: number;
  reason: 'keyword' | 'semantic' | 'hybrid';
  heading?: string | null;
}

interface SearchResponse {
  items: SearchHitItem[];
  hasMore: boolean;
  tookMs: number;
  degraded?: 'vector-disabled' | 'provider-not-configured';
  coverage?: { semanticProjects: number; readableProjects: number; buildingProjects: number };
}

interface ScopeProject {
  id: string;
  name: string;
  vectorEnabled: boolean;
  building: boolean;
}

function highlightText(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text;
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="px-0.5 rounded search-mark" style={{ background: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
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

/** 按路径扩展名区分结果图标底色与前景，提升可扫读性（对齐设计稿三色图标） */
function typeIcon(path: string): { icon: React.ReactNode; bg: string; fg: string } {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') {
    return { icon: <FileText size={20} />, bg: 'var(--color-primary-50)', fg: 'var(--color-primary-500)' };
  }
  if (ext === 'ts' || ext === 'js' || ext === 'tsx' || ext === 'jsx') {
    return { icon: <FileText size={20} />, bg: 'var(--bg-subtle)', fg: 'var(--text-secondary)' };
  }
  if (ext === 'ipynb') {
    return { icon: <BookOpen size={20} />, bg: 'var(--color-primary-50)', fg: 'var(--color-primary-500)' };
  }
  return { icon: <FileText size={20} />, bg: 'var(--bg-subtle)', fg: 'var(--text-secondary)' };
}

export function SearchPage(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { appearance, toggleAppearance } = useTheme();
  const query = searchParams.get('q') ?? '';
  const modeParam = searchParams.get('mode');
  const mode: SearchMode = modeParam === 'keyword' || modeParam === 'semantic' ? modeParam : 'auto';
  const [inputValue, setInputValue] = useState(query);
  const [activeTab, setActiveTab] = useState<SearchTab>('docs');
  const [focused, setFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const user = decodeAccessToken();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setInputValue(query);
  }, [query]);

  // 语义覆盖明细（R3 可发现性）：空态引导 + 范围选择器标注
  const coverageQuery = useQuery({
    queryKey: ['search-coverage'],
    queryFn: () =>
      apiFetch<{ globalEnabled: boolean; provider: string; projects: Array<{ id: string; name: string; vectorEnabled: boolean; building: boolean }> }>(
        '/api/v1/search/coverage'
      ),
    staleTime: 60_000,
  });

  // 文档页签走统一检索端点（keyword/semantic/hybrid；/documents?q= 保留给首页联想）
  const selectedProjectIds = (searchParams.get('projects') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['search-docs', query, mode, selectedProjectIds.join(',')],
    queryFn: () =>
      apiFetch<SearchResponse>(
        `/api/v1/search?q=${encodeURIComponent(query)}&mode=${mode}&limit=20${selectedProjectIds.length ? `&projectIds=${encodeURIComponent(selectedProjectIds.join(','))}` : ''}`
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
      setSearchParams({ q: inputValue.trim(), ...(mode !== 'auto' ? { mode } : {}) });
    }
  };

  const changeMode = (m: SearchMode) => {
    setActiveMode(m);
    setSearchParams({ q: query, ...(m !== 'auto' ? { mode: m } : {}), ...(selectedProjectIds.length ? { projects: selectedProjectIds.join(',') } : {}) });
  };

  const toggleProjectScope = (pid: string) => {
    const next = selectedProjectIds.includes(pid)
      ? selectedProjectIds.filter((x) => x !== pid)
      : [...selectedProjectIds, pid];
    setSearchParams({
      q: query,
      ...(activeMode !== 'auto' ? { mode: activeMode } : {}),
      ...(next.length ? { projects: next.join(',') } : {}),
    });
  };
  // activeMode 跟随 URL（浏览器后退同步）
  const [activeMode, setActiveMode] = useState<SearchMode>(mode);
  useEffect(() => setActiveMode(mode), [mode]);

  const goHome = () => navigate('/');

  const docCount = docsData ? docsData.items.length + (docsData.hasMore ? 20 : 0) : 0;
  const projectCount = filteredProjects.length;

  const headerStyle: React.CSSProperties = {
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(-6px)',
    transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const contentStyle: React.CSSProperties = {
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(10px)',
    transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s',
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)' }}>
      {/* Search header */}
      <header
        className="sticky top-0 z-30 backdrop-blur-md"
        style={{
          background: 'color-mix(in srgb, var(--bg-page) 85%, transparent)',
          ...headerStyle,
        }}
      >
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={goHome}
              className="flex items-center gap-2 shrink-0 group"
            >
              <div
                className="h-9 w-9 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:scale-105 group-hover:shadow-md"
                style={{ background: 'var(--color-primary-500)' }}
              >
                <Sparkles size={18} className="text-white" />
              </div>
              <span className="font-semibold text-lg hidden sm:block transition group-hover:text-primary-600" style={{ color: 'var(--text-primary)' }}>
                ewiki
              </span>
            </button>

            <form onSubmit={handleSearch} className="flex-1 relative">
              <div className="relative">
                <Search
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300"
                  style={{ color: focused ? 'var(--color-primary-500)' : 'var(--text-muted)' }}
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="搜索文档、项目..."
                  autoFocus
                  className="w-full h-11 pl-11 pr-4 text-sm rounded-xl border focus:outline-none transition-all duration-300"
                  style={{
                    background: 'var(--bg-surface)',
                    borderColor: focused ? 'var(--color-primary-500)' : 'var(--border-soft)',
                    color: 'var(--text-primary)',
                    boxShadow: focused ? '0 0 0 4px var(--color-primary-100)' : 'none',
                  }}
                />
              </div>
            </form>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={toggleAppearance}
                aria-label="切换主题"
                className="rounded-md p-2 transition-all duration-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95"
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
                className="hidden sm:flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-all duration-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95"
                style={{ color: 'var(--text-secondary)' }}
              >
                管理
              </Link>
              <div className="h-7 w-7 rounded-full bg-primary-500 text-white flex items-center justify-center text-xs font-medium transition-transform duration-300 hover:scale-105">
                {user?.name?.charAt(0) ?? 'U'}
              </div>
            </div>
          </div>

          {/* Tabs */}
          {query && (
            <div
              className="flex items-center gap-1 mt-4 -mb-px"
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(-4px)',
                transition: 'opacity 0.4s ease-out 0.15s, transform 0.4s ease-out 0.15s',
              }}
            >
              {([
                { key: 'docs', label: '文档', icon: FileText, count: docCount },
                { key: 'projects', label: '项目', icon: FolderOpen, count: projectCount },
                { key: 'sites', label: '站点', icon: Globe, count: 0 },
              ] as const).map(({ key, label, icon: Icon, count }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg transition-all duration-200 active:scale-[0.97]"
                  style={{
                    background: activeTab === key ? 'var(--color-primary-100)' : 'transparent',
                    color: activeTab === key ? 'var(--color-primary-700)' : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={15} style={{ transition: 'transform 0.2s', transform: activeTab === key ? 'scale(1.1)' : 'scale(1)' }} />
                  {label}
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full transition-all duration-200"
                    style={{
                      background: activeTab === key ? 'var(--color-primary-500)' : 'var(--bg-subtle)',
                      color: activeTab === key ? '#fff' : 'var(--text-muted)',
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
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-6" style={contentStyle}>
        {!query ? (
          <EmptySearchState />
        ) : activeTab === 'docs' ? (
          <DocResults
            loading={docsLoading}
            items={docsData?.items ?? []}
            hasMore={docsData?.hasMore ?? false}
            tookMs={docsData?.tookMs ?? 0}
            degraded={docsData?.degraded}
            coverage={docsData?.coverage}
            mode={activeMode}
            onModeChange={changeMode}
            query={query}
            scopeProjects={coverageQuery.data?.projects ?? []}
            selectedProjectIds={selectedProjectIds}
            onToggleProjectScope={toggleProjectScope}
            projectName={(pid: string, fallback?: string | null) =>
              projectsData?.items.find((p) => p.id === pid)?.name ?? fallback ?? pid.slice(0, 8)
            }
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

      <footer
        className="py-6 text-center text-xs"
        style={{
          color: 'var(--text-muted)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.5s ease-out 0.3s',
        }}
      >
        ewiki · 让知识流动起来
      </footer>
    </div>
  );
}

function EmptySearchState() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center text-center animate-fade-in">
      {/* 品牌区 */}
      <div
        className="h-14 w-14 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-500 hover:scale-110"
        style={{ background: 'var(--color-primary-500)' }}
      >
        <Sparkles size={24} className="text-white" />
      </div>
      <h2 className="text-2xl font-semibold mb-1.5 tracking-tight" style={{ color: 'var(--text-primary)' }}>
        ewiki 知识检索
      </h2>
      <p className="text-sm mb-8 max-w-md" style={{ color: 'var(--text-muted)' }}>
        跨项目检索文档、项目与已发布站点 · 支持全文与标签定位
        <br />
        开启知识库的向量检索后，可按含义语义召回段落内容
      </p>

      {/* 快捷检索入口 */}
      <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
        <button
          type="button"
          onClick={() => navigate('/library')}
          className="group text-left p-4 rounded-xl card-hover transition-all duration-200 active:scale-[0.98]"
        >
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
          >
            <Clock size={18} />
          </div>
          <div className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>最近更新</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>按时间浏览全部文档</div>
        </button>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="group text-left p-4 rounded-xl card-hover transition-all duration-200 active:scale-[0.98]"
        >
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
          >
            <FolderOpen size={18} />
          </div>
          <div className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>我的项目</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>进入我的知识库</div>
        </button>
        <button
          type="button"
          onClick={() => navigate('/library')}
          className="group text-left p-4 rounded-xl card-hover transition-all duration-200 active:scale-[0.98]"
        >
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
          >
            <Search size={18} />
          </div>
          <div className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>标签浏览</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>按标签聚合文档</div>
        </button>
      </div>

      {/* 近期搜索 */}
      <div className="w-full max-w-2xl">
        <div className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>近期搜索</div>
        <div className="flex flex-wrap justify-center gap-2">
          {['mermaid 流程图', '部署文档', 'MySQL 方言', '主题 token'].map((kw) => (
            <button
              key={kw}
              type="button"
              onClick={() => navigate(`/search?q=${encodeURIComponent(kw)}`)}
              className="text-xs px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-105 hover:shadow-sm"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
            >
              {kw}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const MODE_TABS: Array<{ key: SearchMode; label: string; hint: string }> = [
  { key: 'auto', label: '自动', hint: '关键词 + 语义融合' },
  { key: 'keyword', label: '关键词', hint: '全文精确匹配' },
  { key: 'semantic', label: '语义', hint: '按含义召回（需知识库开启向量检索）' },
];

function SnippetHtml({ html }: { html: string }) {
  // 服务端已 HTML 转义正文、仅 <em> 为高亮标签（PgSearchService.decodeHeadline / highlightTerms）
  return (
    <p
      className="text-sm leading-relaxed line-clamp-2"
      style={{ color: 'var(--text-secondary)' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DocResults({ loading, items, hasMore, tookMs, degraded, coverage, mode, onModeChange, query, scopeProjects, selectedProjectIds, onToggleProjectScope, projectName }: {
  loading: boolean;
  items: SearchHitItem[];
  hasMore: boolean;
  tookMs: number;
  degraded?: 'vector-disabled' | 'provider-not-configured';
  coverage?: SearchResponse['coverage'];
  mode: SearchMode;
  onModeChange: (m: SearchMode) => void;
  query: string;
  scopeProjects: ScopeProject[];
  selectedProjectIds: string[];
  onToggleProjectScope: (pid: string) => void;
  projectName: (pid: string, fallback?: string | null) => string;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scopeOpen) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (scopeRef.current && !scopeRef.current.contains(e.target as Node)) setScopeOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [scopeOpen]);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="card p-5 rounded-xl"
            style={{
              animation: `fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.06}s both`,
            }}
          >
            <div className="skeleton-shimmer h-5 w-1/3 mb-3 rounded" />
            <div className="skeleton-shimmer h-4 w-full mb-2 rounded" />
            <div className="skeleton-shimmer h-4 w-4/5 mb-3 rounded" />
            <div className="skeleton-shimmer h-3 w-1/4 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <p className="text-sm" style={{ color: 'var(--text-muted)', animation: 'fade-in 0.3s ease-out both' }}>
          找到 <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{items.length}{hasMore ? '+' : ''}</span> 个相关文档
          {tookMs > 0 ? <span> · {tookMs} ms</span> : null}
          {coverage && coverage.readableProjects > 0 ? (
            <span
              className="ml-2 text-[11px]"
              title={coverage.semanticProjects < coverage.readableProjects ? '未覆盖库以关键词参与检索；开启其向量检索可纳入语义召回' : undefined}
            >
              · 语义召回覆盖{' '}
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {coverage.semanticProjects}/{coverage.readableProjects}
              </span>{' '}
              库
            </span>
          ) : null}
        </p>
        {/* 范围选择器（SEARCH-REACH-MULTIKB §5.1）+ 检索模式切换（§8） */}
        <div className="flex items-center gap-2">
          <div ref={scopeRef} className="relative">
            <button
              type="button"
              onClick={() => setScopeOpen((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition"
              style={{
                borderColor: selectedProjectIds.length ? 'var(--color-primary-500)' : 'var(--border-soft)',
                color: selectedProjectIds.length ? 'var(--color-primary-700)' : 'var(--text-muted)',
              }}
            >
              {selectedProjectIds.length
                ? `范围 · ${selectedProjectIds.length} 库`
                : '全部知识库'}
            </button>
            {scopeOpen ? (
              <div
                className="absolute right-0 top-8 z-40 w-64 max-h-72 overflow-y-auto rounded-lg border bg-white shadow-lg dark:bg-neutral-900 p-1"
                style={{ borderColor: 'var(--border-soft)' }}
              >
                {(scopeProjects.length ? scopeProjects : []).map((p) => {
                  const checked = selectedProjectIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md hover:bg-neutral-100 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary-500"
                        checked={checked}
                        onChange={() => onToggleProjectScope(p.id)}
                      />
                      <span className="truncate flex-1" title={p.name}>{p.name}</span>
                      {p.vectorEnabled ? <span title="已开启语义检索" className="text-primary-600">✦</span> : null}
                      {p.building ? <span className="text-[10px] text-amber-600">构建中</span> : null}
                    </label>
                  );
                })}
                {scopeProjects.length === 0 ? <div className="px-2.5 py-2 text-neutral-400">暂无可读知识库</div> : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-subtle)' }}>
          {MODE_TABS.map(({ key, label, hint }) => (
            <button
              key={key}
              type="button"
              title={hint}
              onClick={() => onModeChange(key)}
              className="px-3 py-1 text-xs font-medium rounded-md transition-all duration-200 active:scale-95"
              style={{
                background: mode === key ? 'var(--bg-surface)' : 'transparent',
                color: mode === key ? 'var(--color-primary-700)' : 'var(--text-muted)',
                boxShadow: mode === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
          </div>
        </div>
      </div>

      {degraded ? (
        <div
          className="text-xs px-3 py-2 rounded-lg mb-4"
          style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
        >
          {degraded === 'provider-not-configured'
            ? '语义检索不可用：平台未配置嵌入服务（EMBEDDING_PROVIDER），已自动切换为关键词检索'
            : '检索范围内暂无开启向量检索的知识库，已自动切换为关键词检索'}
        </div>
      ) : null}

      <div className="space-y-2 animate-stagger">
        {items.map((doc, idx) => (
          <Link
            key={doc.documentId}
            to={`/read/${doc.documentId}?q=${encodeURIComponent(query)}&pos=${idx}`}
            className="block card-hover rounded-xl p-4 transition-all duration-200 group hover:shadow-md hover:-translate-y-px"
          >
            <div className="flex items-start gap-4">
              <div
                className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105 group-hover:shadow-sm"
                style={(() => { const t = typeIcon(doc.path); return { background: t.bg, color: t.fg }; })()}
              >
                {(() => { const t = typeIcon(doc.path); return t.icon; })()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-base font-medium truncate transition-colors duration-200 group-hover:text-primary-600" style={{ color: 'var(--text-primary)' }}>
                    {highlightText(doc.title || doc.path.split('/').pop() || '未命名', query)}
                  </h3>
                  {doc.reason === 'semantic' ? (
                    <span
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}
                      title="语义相似召回"
                    >
                      语义
                    </span>
                  ) : doc.reason === 'hybrid' ? (
                    <span
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}
                      title="关键词与语义双路命中"
                    >
                      混合
                    </span>
                  ) : null}
                </div>
                {doc.snippet ? (
                  <SnippetHtml html={doc.snippet} />
                ) : (
                  <p className="text-sm line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{doc.path}</p>
                )}
                <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex items-center gap-1">
                    <FolderOpen size={12} />
                    {projectName(doc.projectId, doc.projectName)}
                  </span>
                  {doc.heading ? (
                    <span className="flex items-center gap-1" title={doc.heading}>
                      <BookOpen size={12} />
                      {doc.heading}
                    </span>
                  ) : null}
                  {mode !== 'keyword' ? (
                    <span title="检索器打分（关键词相关度 / 语义相似度 / RRF 融合分）">
                      score {doc.score.toFixed(3)}
                    </span>
                  ) : null}
                  <ChevronRight
                    size={14}
                    className="ml-auto opacity-0 group-hover:opacity-100 transition-all duration-200"
                    style={{ transform: 'translateX(-4px)' }}
                  />
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
          <div
            key={i}
            className="card p-5 rounded-xl"
            style={{
              animation: `fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.08}s both`,
            }}
          >
            <div className="skeleton-shimmer h-5 w-1/2 mb-3 rounded" />
            <div className="skeleton-shimmer h-4 w-full mb-2 rounded" />
            <div className="skeleton-shimmer h-4 w-2/3 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
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
      <p
        className="text-sm mb-5"
        style={{
          color: 'var(--text-muted)',
          animation: 'fade-in 0.3s ease-out both',
        }}
      >
        找到 <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{items.length}</span> 个相关项目
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-stagger">
        {items.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}/browse`}
            className="block card-hover rounded-xl p-5 transition-all duration-200 group hover:shadow-md hover:-translate-y-px"
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105 group-hover:shadow-sm"
                style={{ background: 'var(--color-primary-100)' }}
              >
                <FolderOpen size={20} style={{ color: 'var(--color-primary-600)' }} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium truncate transition-colors duration-200 group-hover:text-primary-600" style={{ color: 'var(--text-primary)' }}>
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
                className="px-2 py-0.5 rounded-full text-[11px] transition-all duration-200"
                style={{
                  background: isPublicScope(p.visibility) ? 'var(--color-success-50)' : p.visibility.startsWith('team-') ? 'var(--color-primary-50)' : 'var(--bg-subtle)',
                  color: isPublicScope(p.visibility) ? 'var(--color-success-600)' : p.visibility.startsWith('team-') ? 'var(--color-primary-600)' : 'var(--text-muted)',
                }}
              >
                {visibilityLabel(p.visibility)}
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
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
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
