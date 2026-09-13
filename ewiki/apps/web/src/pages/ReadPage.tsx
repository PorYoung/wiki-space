import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Clock, User, FileText, BookOpen, ChevronRight,
  List, AlignLeft, Sun, Moon, Copy, Check, Share2,
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
  const { appearance, toggleAppearance } = useTheme();
  const isDark = appearance === 'dark';

  const [readerTheme, setReaderTheme] = useState('book');
  const [tocOpen, setTocOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [readProgress, setReadProgress] = useState(0);
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

  const content = doc?.content ?? '';
  const title = doc?.title || doc?.path.split('/').pop() || '未命名文档';

  const html = useMemo(() => markdownToHtml(content), [content]);
  const toc = useMemo(() => extractToc(content), [content]);

  useMermaidRender(contentRef, true, isDark, html);

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
          <div className="skeleton h-5 w-32 mb-6" />
          <div className="skeleton h-10 w-2/3 mb-4" />
          <div className="skeleton h-4 w-1/3 mb-10" />
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="skeleton h-4" style={{ width: `${70 + Math.random() * 30}%` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>文档不存在</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>该文档可能已被删除或你没有访问权限</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-sm px-4 py-2 rounded-lg"
            style={{ background: 'var(--color-primary-500)', color: 'white' }}
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>
      {/* 阅读进度条 */}
      <div className="fixed top-0 left-0 right-0 h-1 z-50" style={{ background: 'transparent' }}>
        <div
          className="h-full transition-all duration-150"
          style={{ width: `${readProgress}%`, background: 'var(--color-primary-500)' }}
        />
      </div>

      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 backdrop-blur-md border-b" style={{ background: 'var(--bg-page-alpha)', borderColor: 'var(--border-soft)' }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm transition hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">返回</span>
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm truncate" style={{ color: 'var(--text-muted)' }}>
              {project && (
                <>
                  <Link
                    to={`/projects/${project.id}/browse`}
                    className="hover:opacity-70 transition truncate"
                  >
                    {project.name}
                  </Link>
                  <ChevronRight size={14} className="shrink-0" />
                </>
              )}
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{title}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* 目录切换 */}
            {toc.length > 0 && (
              <button
                type="button"
                onClick={() => setTocOpen(!tocOpen)}
                aria-label="目录"
                className="p-2 rounded-md transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                style={{ color: tocOpen ? 'var(--color-primary-500)' : 'var(--text-secondary)' }}
              >
                <List size={18} />
              </button>
            )}

            {/* 主题切换 */}
            <div className="relative group">
              <button
                type="button"
                aria-label="阅读主题"
                className="p-2 rounded-md transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                style={{ color: 'var(--text-secondary)' }}
              >
                <AlignLeft size={18} />
              </button>
              <div className="absolute right-0 top-full mt-1 py-2 rounded-xl border shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
                <div className="px-3 pb-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>阅读主题</div>
                {READER_THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setReaderTheme(t.key)}
                    className="w-full px-3 py-1.5 text-left text-sm transition hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center justify-between gap-6"
                    style={{ color: readerTheme === t.key ? 'var(--color-primary-600)' : 'var(--text-primary)' }}
                  >
                    {t.label}
                    {readerTheme === t.key && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            {/* 明暗切换 */}
            <button
              type="button"
              onClick={toggleAppearance}
              aria-label="切换明暗"
              className="p-2 rounded-md transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
              style={{ color: 'var(--text-secondary)' }}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* 复制链接 */}
            <button
              type="button"
              onClick={handleCopyLink}
              aria-label="复制链接"
              className="p-2 rounded-md transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
              style={{ color: 'var(--text-secondary)' }}
            >
              {copied ? <Check size={18} style={{ color: 'var(--color-success-500)' }} /> : <Copy size={18} />}
            </button>

            {/* 分享 */}
            <button
              type="button"
              aria-label="分享"
              className="p-2 rounded-md transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Share2 size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex gap-10">
          {/* 左侧正文 */}
          <article className="flex-1 min-w-0">
            {/* 文档头部 */}
            <header className="mb-10">
              <h1 className="text-3xl font-bold mb-4 leading-tight" style={{ color: 'var(--text-primary)' }}>
                {title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <div className="flex items-center gap-1.5">
                  <User size={14} />
                  <span>{doc.updatedBy || '未知作者'}</span>
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
                <div className="flex flex-wrap gap-2 mt-4">
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 rounded-full"
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
              style={{ fontSize: '16px', lineHeight: 1.9 }}
              dangerouslySetInnerHTML={{ __html: html }}
            />

            {/* 底部 */}
            <footer className="mt-16 pt-8 border-t" style={{ borderColor: 'var(--border-soft)' }}>
              <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-muted)' }}>
                <span>感谢阅读</span>
                <span>最后更新：{new Date(doc.updatedAt).toLocaleString('zh-CN')}</span>
              </div>
            </footer>
          </article>

          {/* 右侧目录 */}
          {toc.length > 0 && tocOpen && (
            <aside className="hidden md:block w-56 shrink-0">
              <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                  目录
                </div>
                <nav className="space-y-1">
                  {toc.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => scrollToHeading(item.id)}
                      className="block w-full text-left text-sm py-1 pr-2 transition hover:opacity-80 border-l-2"
                      style={{
                        paddingLeft: `${(item.level - 1) * 12 + 8}px`,
                        borderColor: activeHeadingId === item.id ? 'var(--color-primary-500)' : 'transparent',
                        color: activeHeadingId === item.id ? 'var(--color-primary-600)' : 'var(--text-secondary)',
                        fontWeight: activeHeadingId === item.id ? 500 : 400,
                      }}
                    >
                      {item.text}
                    </button>
                  ))}
                </nav>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
