import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Clock, User, FileText, BookOpen, ChevronRight, ChevronLeft,
  List, ListChecks, FolderOpen, AlignLeft, Sun, Moon, Copy, Check,
} from 'lucide-react';
import { apiFetch } from '../lib/api/client';
import { useTheme } from '../theme/ThemeProvider';
import { slugify, markdownToHtml } from '../lib/markdown';
import { useMermaidRender } from '../lib/use-mermaid-render';
import type { Document, Project } from '@ewiki/shared';

interface DocumentDetail extends Document {
  content: string | null;
  tags: string[] | null;
  updatedBy: string | null;
  rawUrl: string | null;
}

interface SearchDocument extends Document {
  summary: string | null;
  snippet: string | null;
}

interface TocItem {
  level: number;
  text: string;
  id: string;
}

const READER_THEMES = [
  { key: 'plain', label: '经典' },
  { key: 'book', label: '书籍' },
  { key: 'journal', label: '期刊' },
  { key: 'tech', label: '科技蓝' },
  { key: 'solarized-light', label: '暖阳' },
];

function extractToc(content: string): TocItem[] {
  const toc: TocItem[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (!h) continue;
    const level = h[1].length;
    const text = h[2].trim();
    if (!text) continue;
    const id = slugify(text);
    let finalId = id;
    let n = 1;
    while (seen.has(finalId)) {
      n += 1;
      finalId = `${id}-${n}`;
    }
    seen.add(finalId);
    toc.push({ level, text, id: finalId });
  }
  return toc;
}

function formatWordCount(count: number): string {
  if (count < 1000) return `${count} 字`;
  return `${(count / 1000).toFixed(1)}k 字`;
}

function formatReadTime(wordCount: number): string {
  const mins = Math.max(1, Math.ceil(wordCount / 400));
  return `${mins} 分钟阅读`;
}

/** 按路径扩展名区分结果来源图标与配色，提升搜索列表的可扫读性 */
function typeIcon(path: string): { icon: React.ReactNode; bg: string; fg: string } {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const mk = (icon: React.ReactNode, key: string): { icon: React.ReactNode; bg: string; fg: string } => ({
    icon,
    bg: `var(--${key}-50)`,
    fg: `var(--${key}-600)`,
  });
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return mk(<FileText size={16} />, 'color-primary');
  if (ext === 'ts' || ext === 'js' || ext === 'tsx' || ext === 'jsx') return mk(<FileText size={16} />, 'color-primary');
  if (ext === 'ipynb') return mk(<BookOpen size={16} />, 'color-primary');
  if (ext === 'py' || ext === 'sql') return mk(<FolderOpen size={16} />, 'color-primary');
  return mk(<FileText size={16} />, 'color-primary');
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

export function ReadPage(): React.ReactElement {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { appearance, toggleAppearance } = useTheme();
  const isDark = appearance === 'dark';

  const searchQuery = searchParams.get('q') ?? '';
  const searchPos = parseInt(searchParams.get('pos') ?? '-1', 10);

  const [readerTheme, setReaderTheme] = useState('book');
  /** 左右独立侧栏：目录（左）/ 搜索结果（右），可同时展开。从搜索进入默认开结果，直接阅读默认开目录。 */
  const [tocOpen, setTocOpen] = useState(!searchQuery);
  const [resultsOpen, setResultsOpen] = useState(!!searchQuery);
  const [copied, setCopied] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [readProgress, setReadProgress] = useState(0);
  const [contentVisible, setContentVisible] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const { data: doc, isLoading } = useQuery({
    queryKey: ['read-document', id],
    queryFn: () => apiFetch<DocumentDetail>(`/api/v1/documents/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });

  const { data: project } = useQuery({
    queryKey: ['read-project', doc?.projectId],
    queryFn: () => apiFetch<Project>(`/api/v1/projects/${doc?.projectId}`),
    enabled: !!doc?.projectId,
    staleTime: 120_000,
  });

  // 相关文档（SEARCH-REACH-MULTIKB R2）：语义触点 —— 文档向量召回，无需输入查询词
  const { data: related } = useQuery({
    queryKey: ['related-docs', id],
    queryFn: () =>
      apiFetch<{ items: Array<{ documentId: string; projectId: string; projectName?: string | null; path: string; title: string; score: number; heading?: string | null }> }>(
        `/api/v1/documents/${doc!.id}/related?limit=5`
      ),
    enabled: !!doc?.id,
    staleTime: 120_000,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['search-docs-nav', searchQuery],
    queryFn: () => apiFetch<{ items: SearchDocument[]; total: number; page: number; pageSize: number }>(
      `/api/v1/documents?q=${encodeURIComponent(searchQuery)}&page=1&pageSize=20`
    ),
    enabled: searchQuery.length > 0,
    staleTime: 60_000,
  });

  const hasResults = (searchResults?.items?.length ?? 0) > 0;

  const navInfo = useMemo(() => {
    if (!searchQuery || !searchResults?.items || searchPos < 0) return null;
    const items = searchResults.items;
    const currentIdx = searchPos;
    const prevDoc = currentIdx > 0 ? items[currentIdx - 1] : null;
    const nextDoc = currentIdx < items.length - 1 ? items[currentIdx + 1] : null;
    return {
      prev: prevDoc,
      next: nextDoc,
      current: currentIdx + 1,
      total: items.length,
      query: searchQuery,
    };
  }, [searchResults, searchPos, searchQuery]);

  const content = doc?.content ?? '';
  const title = doc?.title || doc?.path.split('/').pop() || '未命名文档';

  const html = useMemo(() => markdownToHtml(content), [content]);
  const toc = useMemo(() => extractToc(content), [content]);

  useMermaidRender(contentRef, true, isDark, html);

  useEffect(() => {
    if (!isLoading && doc) {
      const t1 = setTimeout(() => setHeaderVisible(true), 50);
      const t2 = setTimeout(() => setContentVisible(true), 150);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [isLoading, doc]);

  useEffect(() => {
    setContentVisible(false);
    setHeaderVisible(false);
    window.scrollTo({ top: 0 });
    const t1 = setTimeout(() => setHeaderVisible(true), 50);
    const t2 = setTimeout(() => setContentVisible(true), 150);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!contentRef.current) return;
    const el = contentRef.current;

    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
      setReadProgress(progress);

      const headings = Array.from(el.querySelectorAll('h1, h2, h3'));
      let current: string | null = null;
      for (const h of headings) {
        const rect = h.getBoundingClientRect();
        if (rect.top <= 120) {
          current = h.id;
        } else {
          break;
        }
      }
      setActiveHeadingId(current);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [html]);

  /** 跳转到搜索结果中的某一条文档（pos 即其在结果列表中的序号） */
  const goToDoc = useCallback((docId: string, pos: number) => {
    navigate(`/read/${docId}?q=${encodeURIComponent(searchQuery)}&pos=${pos}`);
  }, [navigate, searchQuery]);

  const goToPrev = useCallback(() => {
    if (navInfo?.prev) {
      goToDoc(navInfo.prev.id, navInfo.current - 2);
    }
  }, [navInfo, goToDoc]);

  const goToNext = useCallback(() => {
    if (navInfo?.next) {
      goToDoc(navInfo.next.id, navInfo.current);
    }
  }, [navInfo, goToDoc]);

  const goBackToSearch = useCallback(() => {
    if (searchQuery) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
    } else {
      navigate(-1);
    }
  }, [searchQuery, navigate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        goToNext();
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        goBackToSearch();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goToNext, goToPrev, goBackToSearch]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const scrollToHeading = (headingId: string) => {
    const el = document.getElementById(headingId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="skeleton-shimmer h-5 w-32 mb-6 rounded" />
          <div className="skeleton-shimmer h-10 w-2/3 mb-4 rounded" />
          <div className="skeleton-shimmer h-4 w-1/3 mb-10 rounded" />
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-shimmer h-4 rounded"
                style={{
                  width: `${70 + Math.random() * 30}%`,
                  animation: `fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.05}s both`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
        <div className="text-center animate-scale-in">
          <FileText size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>文档不存在</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>该文档可能已被删除或你没有访问权限</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-sm px-4 py-2 rounded-lg transition-all duration-200 hover:shadow-md active:scale-95"
            style={{ background: 'var(--color-primary-500)', color: 'white' }}
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const headerStyle: React.CSSProperties = {
    opacity: headerVisible ? 1 : 0,
    transform: headerVisible ? 'translateY(0)' : 'translateY(-6px)',
    transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const articleStyle: React.CSSProperties = {
    opacity: contentVisible ? 1 : 0,
    transform: contentVisible ? 'translateY(0)' : 'translateY(12px)',
    transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const paneStyle: React.CSSProperties = {
    opacity: contentVisible ? 1 : 0,
    transform: contentVisible ? 'translateX(0)' : 'translateX(8px)',
    transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s',
  };

  const segmentActive: React.CSSProperties = {
    background: 'var(--bg-surface)',
    color: 'var(--color-primary-600)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  };
  const segmentIdle: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--text-secondary)',
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>
      {/* 阅读进度条（低饱和，不抢正文焦点） */}
      <div className="fixed top-0 left-0 right-0 h-1 z-50" style={{ background: 'transparent' }}>
        <div
          className="h-full transition-all duration-150 ease-out"
          style={{ width: `${readProgress}%`, background: 'var(--color-primary-300)' }}
        />
      </div>

      {/* 顶部导航：左 返回+面包屑 · 中 目录|结果分段切换 · 右 主题/明暗/复制 */}
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b"
        style={{
          background: 'var(--bg-page-alpha)',
          borderColor: 'var(--border-soft)',
          ...headerStyle,
        }}
      >
        <div className="max-w-6xl mx-auto px-6 h-14 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* 左：返回 + 面包屑 */}
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={goBackToSearch}
              className="flex items-center gap-1 text-sm transition-all duration-200 hover:opacity-70 active:scale-95 shrink-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">{searchQuery ? '返回搜索' : '返回'}</span>
            </button>
            <ChevronRight size={14} className="shrink-0 hidden sm:inline" style={{ color: 'var(--text-muted)' }} />
            <div className="flex items-center gap-1.5 text-sm truncate min-w-0" style={{ color: 'var(--text-muted)' }}>
              {project && (
                <>
                  <Link
                    to={`/projects/${project.id}/browse`}
                    className="hover:opacity-70 transition-opacity truncate shrink-0"
                  >
                    {project.name}
                  </Link>
                  <ChevronRight size={14} className="shrink-0" />
                </>
              )}
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{title}</span>
            </div>
          </div>

          {/* 中：目录 / 结果 两个独立开关（左右侧栏可同时展开） */}
          <div
            className="hidden lg:flex items-center rounded-xl p-0.5"
            style={{ background: 'var(--bg-subtle)' }}
            role="group"
            aria-label="阅读侧栏开关"
          >
            {toc.length > 0 && (
              <button
                type="button"
                aria-pressed={tocOpen}
                onClick={() => setTocOpen(!tocOpen)}
                title={tocOpen ? '收起目录' : '展开目录'}
                className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm transition-all duration-200 active:scale-95"
                style={{ ...(tocOpen ? segmentActive : segmentIdle), fontWeight: tocOpen ? 500 : 400 }}
              >
                <List size={15} />
                <span>目录</span>
              </button>
            )}
            {hasResults && (
              <button
                type="button"
                aria-pressed={resultsOpen}
                onClick={() => setResultsOpen(!resultsOpen)}
                title={resultsOpen ? '收起搜索结果' : '展开搜索结果'}
                className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm transition-all duration-200 active:scale-95"
                style={{ ...(resultsOpen ? segmentActive : segmentIdle), fontWeight: resultsOpen ? 500 : 400 }}
              >
                <ListChecks size={15} />
                <span>结果</span>
                <span
                  className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[11px] tabular-nums"
                  style={
                    resultsOpen
                      ? { background: 'var(--color-primary-500)', color: 'white' }
                      : { background: 'var(--bg-surface)', color: 'var(--text-muted)' }
                  }
                >
                  {searchResults?.items.length ?? 0}
                </span>
              </button>
            )}
          </div>

          {/* 右：操作组 */}
          <div className="flex items-center justify-end gap-1 shrink-0">
            <div className="relative group">
              <button
                type="button"
                aria-label="阅读主题"
                title="阅读主题"
                className="p-2 rounded-md transition-all duration-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95"
                style={{ color: 'var(--text-secondary)' }}
              >
                <AlignLeft size={18} />
              </button>
              <div
                className="absolute right-0 top-full mt-1 py-2 rounded-xl border shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 origin-top-right"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border-soft)',
                  transform: 'translateY(-4px)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; }}
              >
                <div className="px-3 pb-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>阅读主题</div>
                {READER_THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setReaderTheme(t.key)}
                    className="w-full px-3 py-1.5 text-left text-sm transition-all duration-150 hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center justify-between gap-6"
                    style={{ color: readerTheme === t.key ? 'var(--color-primary-600)' : 'var(--text-primary)' }}
                  >
                    {t.label}
                    {readerTheme === t.key && <Check size={14} className="animate-scale-in" />}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={toggleAppearance}
              aria-label="切换明暗"
              title="切换明暗"
              className="p-2 rounded-md transition-all duration-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95"
              style={{ color: 'var(--text-secondary)' }}
            >
              {isDark ? <Sun size={18} className="transition-transform duration-300 hover:rotate-12" /> : <Moon size={18} className="transition-transform duration-300 hover:-rotate-12" />}
            </button>

            <button
              type="button"
              onClick={handleCopyLink}
              aria-label="复制链接"
              title="复制链接"
              className="p-2 rounded-md transition-all duration-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95"
              style={{ color: 'var(--text-secondary)' }}
            >
              {copied ? <Check size={18} style={{ color: 'var(--color-success-500)' }} className="animate-scale-in" /> : <Copy size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区：左目录 · 中正文 · 右搜索结果（左右独立开关，可同时展开） */}
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex gap-8 items-start">
          {/* 左：目录侧边栏（tocOpen 独立控制，与右侧结果栏互不干扰） */}
          {tocOpen && toc.length > 0 && (
            <aside className="w-56 shrink-0 hidden lg:block" style={paneStyle} aria-label="目录">
              <div className="sticky top-24">
                <div className="px-1 pb-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  目录
                </div>
                <nav className="flex flex-col gap-0.5 max-h-[calc(100vh-11rem)] overflow-y-auto scrollbar-thin">
                  {toc.map((item) => {
                    const isActive = item.id === activeHeadingId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => scrollToHeading(item.id)}
                        className="text-left py-1 pr-2 rounded-md transition-all duration-150 border-l-[2px]"
                        style={{
                          paddingLeft: `${(item.level - 1) * 12 + 12}px`,
                          borderLeftColor: isActive ? 'var(--color-primary-500)' : 'transparent',
                          color: isActive ? 'var(--color-primary-600)' : 'var(--text-secondary)',
                          background: isActive ? 'var(--color-primary-50)' : 'transparent',
                          fontWeight: isActive ? 500 : 400,
                          fontSize: item.level === 1 ? '13px' : '12.5px',
                        }}
                      >
                        {item.text}
                      </button>
                    );
                  })}
                </nav>
              </div>
            </aside>
          )}

          {/* 中列正文 */}
          <article className="flex-1 min-w-0" style={articleStyle}>
            {/* 文档头部 */}
            <header className="mb-8">
              <h1
                className="text-[26px] font-semibold tracking-tight mb-3.5 leading-tight"
                style={{
                  color: 'var(--text-primary)',
                  opacity: contentVisible ? 1 : 0,
                  transform: contentVisible ? 'translateY(0)' : 'translateY(8px)',
                  transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s',
                }}
              >
                {title}
              </h1>
              <div
                className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
                style={{
                  color: 'var(--text-muted)',
                  opacity: contentVisible ? 1 : 0,
                  transform: contentVisible ? 'translateY(0)' : 'translateY(6px)',
                  transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <User size={14} className="shrink-0" />
                  <span className="max-w-[160px] truncate" title={doc.updatedBy || undefined}>{doc.updatedBy || '未知作者'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock size={14} />
                  <span>更新于 {relativeTime(doc.updatedAt)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <FileText size={14} />
                  <span>{formatWordCount(doc.wordCount)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <BookOpen size={14} />
                  <span>{formatReadTime(doc.wordCount)}</span>
                </div>
              </div>
              {doc.tags && doc.tags.length > 0 && (
                <div
                  className="flex flex-wrap gap-2 mt-4"
                  style={{
                    opacity: contentVisible ? 1 : 0,
                    transform: contentVisible ? 'translateY(0)' : 'translateY(4px)',
                    transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
                  }}
                >
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 rounded-full transition-all duration-200 hover:scale-105"
                      style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </header>

            {/* 正文内容 */}
            <div
              ref={contentRef}
              className={`prose-doc prose-${readerTheme} mx-auto`}
              style={{
                fontSize: '16px',
                lineHeight: 1.9,
                opacity: contentVisible ? 1 : 0,
                transform: contentVisible ? 'translateY(0)' : 'translateY(10px)',
                transition: 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.25s, transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.25s',
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />

            {/* 底部 */}
            <footer
              className="mt-16 pt-8 border-t"
              style={{
                borderColor: 'var(--border-soft)',
                opacity: contentVisible ? 1 : 0,
                transition: 'opacity 0.6s ease-out 0.5s',
              }}
            >
              <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-muted)' }}>
                <span>感谢阅读</span>
                <span>最后更新：{new Date(doc.updatedAt).toLocaleString('zh-CN')}</span>
              </div>

              {/* 相关文档（语义召回；空结果整模块隐藏） */}
              {(related?.items?.length ?? 0) > 0 ? (
                <div className="mt-8">
                  <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                    相关文档 · 语义推荐
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {related!.items.map((r) => (
                      <a
                        key={r.documentId}
                        href={`/read/${r.documentId}`}
                        className="block rounded-lg border p-3 transition hover:shadow-md hover:-translate-y-px"
                        style={{ borderColor: 'var(--border-soft)' }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {r.title || r.path.split('/').pop()}
                          </span>
                          {r.heading ? <span className="shrink-0 text-[10px] text-neutral-400 truncate">{r.heading}</span> : null}
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-400 truncate">
                          {r.projectName ?? ''}{r.projectName ? ' · ' : ''}{r.path}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </footer>
          </article>

          {/* 右：搜索结果侧边栏（resultsOpen 独立控制，与左侧目录并排展示，不覆盖正文） */}
          {resultsOpen && hasResults && (
            <aside
              className="w-64 xl:w-72 shrink-0 hidden lg:block"
              style={paneStyle}
              role="complementary"
              aria-label="搜索结果列表"
            >
              <div
                className="sticky top-24 flex flex-col rounded-2xl border overflow-hidden"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border-soft)',
                  maxHeight: 'calc(100vh - 8rem)',
                }}
              >
            <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                搜索结果
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goBackToSearch}
                  className="text-xs transition-all duration-200 hover:opacity-70"
                  style={{ color: 'var(--color-primary-600)' }}
                >
                  返回搜索
                </button>
                <button
                  type="button"
                  onClick={() => setResultsOpen(false)}
                  aria-label="收起搜索结果"
                  title="收起搜索结果"
                  className="p-1 rounded-md transition-all duration-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-4">
              <div className="flex flex-col gap-1">
                {(searchResults?.items ?? []).map((item, idx) => {
                  const isCurrent = idx === searchPos;
                  const { icon, bg, fg } = typeIcon(item.path);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => goToDoc(item.id, idx)}
                      className="w-full text-left rounded-lg px-2.5 py-2 transition-all duration-200 active:scale-[0.98]"
                      style={{
                        background: isCurrent ? 'var(--color-primary-50)' : 'transparent',
                        border: isCurrent ? '1px solid var(--color-primary-200)' : '1px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <span className="flex items-start gap-2">
                        <span
                          className="mt-0.5 h-6 w-6 rounded-md flex items-center justify-center shrink-0"
                          style={{ background: bg, color: fg }}
                        >
                          {icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className="block text-[13px] leading-snug line-clamp-2 transition-colors duration-200"
                            style={{
                              color: isCurrent ? 'var(--color-primary-700)' : 'var(--text-secondary)',
                              fontWeight: isCurrent ? 500 : 400,
                            }}
                          >
                            {item.title || item.path.split('/').pop() || '未命名文档'}
                          </span>
                          <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                            {relativeTime(item.updatedAt)}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 底部导航条：上一项 · N/M · 下一项（j/k 快捷键可切换） */}
            {navInfo && (
              <div className="shrink-0 px-3 py-2 border-t" style={{ borderColor: 'var(--border-soft)' }}>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={goToPrev}
                    disabled={!navInfo.prev}
                    className="flex items-center gap-1 px-2 py-1 rounded-md transition-all duration-200 disabled:opacity-40 enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800 enabled:active:scale-95"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <ChevronLeft size={14} />
                    <span>上一项</span>
                  </button>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {navInfo.current} / {navInfo.total}
                  </span>
                  <button
                    type="button"
                    onClick={goToNext}
                    disabled={!navInfo.next}
                    className="flex items-center gap-1 px-2 py-1 rounded-md transition-all duration-200 disabled:opacity-40 enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800 enabled:active:scale-95"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span>下一项</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}