// ---------------------------------------------------------------------------
// Markdown 查看器（§4.4 / §6.2）：从 BrowsePage DocumentEditor 平移的最小完整版。
//   - @uiw/react-md-editor 编辑/预览双态，Ctrl+E 切换、Esc 回预览、双击进入编辑
//   - Ctrl+S 保存（onSave 由宿主实现 PUT 乐观并发），保存成功清 dirty
//   - 预览用 @ewiki/render 的 markdownToHtml（经 web 侧 lib/markdown，含 KaTeX 样式）
//   - TOC 提取 + scroll-spy、mermaid 占位异步渲染、7 套渲染主题
//   - 未保存离开拦截（beforeunload）
// 本期不被 BrowsePage 集成，但类型完整、可独立渲染。
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import MDEditor, { type RefMDEditor } from '@uiw/react-md-editor';
import {
  BookOpen,
  Code,
  Eye,
  FileText,
  Image as ImageIcon,
  Layers,
  Moon,
  Palette,
  PenTool,
  Save,
  Sun,
  ChevronDown,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { slugify, markdownToHtml } from '../../lib/markdown';
import { useMermaidRender } from '../../lib/use-mermaid-render';
import type { FileViewerProps } from '../types';
import { ImagePickerModal } from './ImagePickerModal';

const RENDER_THEMES: Array<{ key: string; label: string; desc: string; Icon: LucideIcon }> = [
  { key: 'plain', label: '经典', desc: '默认无衬线 · 紧凑', Icon: FileText },
  { key: 'book', label: '书籍', desc: '衬线体 · 宽松行距', Icon: BookOpen },
  { key: 'journal', label: '期刊', desc: '窄栏双端对齐', Icon: FileText },
  { key: 'compact', label: '工程风', desc: '等宽字体 · 大密度', Icon: Code },
  { key: 'tech', label: '科技蓝', desc: '冷色调高亮', Icon: Layers },
  { key: 'solarized-light', label: 'Solarized Light', desc: '经典米黄', Icon: Sun },
  { key: 'solarized-dark', label: 'Solarized Dark', desc: '经典深蓝', Icon: Moon },
];

interface TocItem {
  level: number;
  text: string;
  id: string;
}

function extractToc(md: string): TocItem[] {
  const toc: TocItem[] = [];
  for (const line of md.split('\n')) {
    const h3 = line.match(/^###\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    if (h3) toc.push({ level: 3, text: h3[1]!.trim(), id: slugify(h3[1]!) });
    else if (h2) toc.push({ level: 2, text: h2[1]!.trim(), id: slugify(h2[1]!) });
    else if (h1) toc.push({ level: 1, text: h1[1]!.trim(), id: slugify(h1[1]!) });
  }
  return toc;
}

export function MarkdownViewer({ file, canWrite, isDark, onSave, projectId }: FileViewerProps): React.ReactElement {
  const initial = file.content ?? '';
  const [view, setView] = useState<'preview' | 'edit'>('preview');
  const [buffer, setBuffer] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renderTheme, setRenderTheme] = useState('plain');
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  // §4.1-F16 Markdown 引用图片：插入图片弹层开关
  const [showImageModal, setShowImageModal] = useState(false);
  // §4.1-F16 MDEditor ref —— 拿 textarea 做光标插入
  const editorRef = useRef<RefMDEditor | null>(null);
  // §4.1-F16 记录 textarea 光标/选区位置（弹层打开期间 textarea 失焦，需要预先保存）
  const cursorPosRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  // §6.2 ref 存最新值：避免 useEffect 闭包陷阱（saved/buffer 变化频率高，不能放 deps）
  const prevFileIdRef = useRef<string | null>(null);
  const savedRef = useRef(saved);
  const bufferRef = useRef(buffer);
  savedRef.current = saved;
  bufferRef.current = buffer;

  // §6.2 跨宿主文件切换逻辑：
  //   - file.id 变 → 切换了文件：全重置 buffer/saved/view/toc
  //   - file.id 不变但 file.content 变 → WS 通知服务器有新版本：
  //     - buffer === saved（clean）→ 自动更新 buffer 为新 content
  //     - buffer !== saved（dirty）→ 保留 buffer 等待用户保存（保存时触发 409）
  useEffect(() => {
    const next = file.content ?? '';
    if (file.id !== prevFileIdRef.current) {
      // 切换到新文件
      prevFileIdRef.current = file.id;
      setBuffer(next);
      setSaved(next);
      setSaveError(null);
      setView('preview');
      setActiveHeadingId(null);
    } else if (next !== savedRef.current) {
      // 同文件，服务器 content 变了
      if (bufferRef.current === savedRef.current) {
        // clean：安全更新 buffer（saved 将在下轮 render 同步到 ref）
        setBuffer(next);
      }
      // dirty：保留 buffer，等用户手动处理（保存时触发 PUT 409）
      setSaveError(null);
    }
  }, [file.id, file.content]);

  const tocItems = useMemo(() => extractToc(buffer), [buffer]);
  // 预览始终渲染已保存内容（与 BrowsePage 旧行为一致：编辑缓冲不污染预览）
  const previewHtml = useMemo(() => markdownToHtml(saved), [saved]);
  useMermaidRender(previewScrollRef, view === 'preview', isDark, previewHtml);

  const dirty = buffer !== saved;

  const doSave = async () => {
    if (!onSave || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(buffer);
      setSaved(buffer);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;
  const setViewRef = useRef(setView);
  setViewRef.current = setView;

  // Ctrl/⌘+S 保存、Ctrl/⌘+E 切换编辑/预览（与 BrowsePage 旧行为一致）
  useEffect(() => {
    if (!canWrite || !onSave) return undefined;
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void doSaveRef.current();
      } else if (key === 'e') {
        e.preventDefault();
        setViewRef.current((v) => (v === 'edit' ? 'preview' : 'edit'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canWrite, onSave]);

  // scroll-spy（从 BrowsePage 平移）
  useEffect(() => {
    if (view !== 'preview' || !previewScrollRef.current) return;
    const container = previewScrollRef.current;
    const handleScroll = () => {
      const headings = container.querySelectorAll('h1[id], h2[id], h3[id]');
      let current: string | null = null;
      for (const h of headings) {
        const rect = h.getBoundingClientRect();
        const containerTop = container.getBoundingClientRect().top;
        if (rect.top - containerTop <= 80) current = h.id;
      }
      setActiveHeadingId(current);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [view, file.id, previewHtml]);

  // 未保存离开提示
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const jumpToHeading = (id: string) => {
    if (!previewScrollRef.current) return;
    const el = previewScrollRef.current.querySelector(`#${CSS.escape(id)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // §4.1-F16 Markdown 引用图片：ImagePickerModal 回调 —— 把 Markdown 语法插入光标位置
  const handlePickImage = (markdown: string) => {
    const { start, end } = cursorPosRef.current;
    // 边界兜底：如果 cursor 没被正确追踪（首次进入编辑态没点过 textarea），
    // 就追加到 buffer 末尾。
    const safeStart = Number.isFinite(start) && start >= 0 && start <= buffer.length ? start : buffer.length;
    const safeEnd = Number.isFinite(end) && end >= safeStart && end <= buffer.length ? end : safeStart;
    const next = buffer.slice(0, safeStart) + markdown + buffer.slice(safeEnd);
    setBuffer(next);
    setShowImageModal(false);
    // 插入后恢复 textarea 焦点 + 光标放到插入内容之后（下次继续编辑更顺手）
    requestAnimationFrame(() => {
      const ta = editorRef.current?.textarea;
      if (ta) {
        ta.focus();
        const newPos = safeStart + markdown.length;
        ta.setSelectionRange(newPos, newPos);
        cursorPosRef.current = { start: newPos, end: newPos };
      }
    });
  };

  return (
    <section
      className="h-full min-h-0 flex flex-col min-w-0 overflow-hidden"
      style={{ background: 'var(--bg-surface)' }}
    >
      {/* 头部：文件名 + 渲染主题 / 预览编辑切换 / 保存 */}
      <div className="shrink-0 border-b px-6 pt-4 pb-3" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-neutral-900 truncate">{file.title || file.path.split('/').pop()}</h1>
          <div className="flex items-center gap-2 shrink-0">
            {view === 'preview' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowThemeMenu((s) => !s)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded text-xs font-medium border border-neutral-200 hover:bg-neutral-50 transition"
                >
                  <Palette size={12} />
                  <span>{RENDER_THEMES.find((t) => t.key === renderTheme)?.label ?? '经典'}</span>
                  <ChevronDown size={12} />
                </button>
                {showThemeMenu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowThemeMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 w-64 rounded-lg bg-white border border-neutral-200 shadow-xl z-30">
                      <div className="px-3 py-2 border-b border-neutral-100 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                        渲染主题
                      </div>
                      <div className="py-1 max-h-72 overflow-y-auto">
                        {RENDER_THEMES.map((t) => {
                          const Icon = t.Icon;
                          const active = renderTheme === t.key;
                          return (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => {
                                setRenderTheme(t.key);
                                setShowThemeMenu(false);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition ${
                                active ? 'bg-primary-50' : 'hover:bg-neutral-50'
                              }`}
                            >
                              <Icon size={14} className={active ? 'text-primary-600' : 'text-neutral-400'} />
                              <div className="min-w-0 flex-1">
                                <div
                                  className={`text-xs font-medium ${
                                    active ? 'text-primary-700' : 'text-neutral-700'
                                  }`}
                                >
                                  {t.label}
                                </div>
                                <div className="text-[10px] text-neutral-400 truncate">{t.desc}</div>
                              </div>
                              {active && <CheckCircle2 size={14} className="text-primary-600 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* §4.1-F16 Markdown 引用图片：插入图片按钮（编辑态 + 可写权限时显示） */}
            {canWrite && onSave && view === 'edit' && (
              <button
                type="button"
                onClick={() => {
                  // §4.1-F16 打开弹层前，从 editorRef 同步一次最新光标位置（按钮点击会让 textarea blur）
                  const ta = editorRef.current?.textarea;
                  if (ta) {
                    cursorPosRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
                  }
                  setShowImageModal(true);
                }}
                title="插入图片 / 附件（Markdown 图片语法）"
                className="inline-flex items-center gap-1 h-7 px-2 rounded text-xs font-medium border border-neutral-200 hover:bg-neutral-50 transition"
              >
                <ImageIcon size={13} /> 插入图片
              </button>
            )}

            <div className="bg-neutral-100 rounded-md p-0.5 inline-flex">
              <button
                type="button"
                onClick={() => setView('preview')}
                className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs font-medium transition ${
                  view === 'preview'
                    ? 'bg-white text-neutral-800 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <Eye size={13} /> 预览
              </button>
              {canWrite && onSave && (
                <button
                  type="button"
                  onClick={() => setView('edit')}
                  title="双击内容可快速进入编辑"
                  className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs font-medium transition ${
                    view === 'edit'
                      ? 'bg-white text-neutral-800 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  <PenTool size={13} /> 编辑
                </button>
              )}
            </div>

            {canWrite && onSave && (
              <button
                type="button"
                className="btn-primary !h-7 !px-2.5 !text-xs disabled:opacity-60"
                onClick={() => void doSave()}
                disabled={saving || !dirty}
              >
                <Save size={13} /> {saving ? '保存中…' : dirty ? '保存' : '已保存'}
              </button>
            )}
          </div>
        </div>
        {dirty && (
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            有未保存的修改（Ctrl/⌘+S 保存）
            {saveError && <span className="text-red-500">· {saveError}</span>}
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {view === 'preview' ? (
          <div className="group flex-1 relative min-h-0">
            <div
              ref={previewScrollRef}
              className="h-full overflow-y-auto scrollbar-thin"
              onDoubleClick={() => {
                if (canWrite && onSave) setView('edit');
              }}
              title={canWrite && onSave ? '双击内容可快速进入编辑' : undefined}
            >
              <div
                className={`max-w-3xl mx-auto px-10 py-10 prose-doc prose-${renderTheme || 'plain'}`}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">
            <MDEditor
              ref={editorRef}
              value={buffer}
              onChange={(v) => setBuffer(v ?? '')}
              preview="edit"
              hideToolbar={false}
              height="100%"
              className="h-full"
              style={{ height: '100%' }}
              defaultTabEnable
              tabSize={2}
              data-color-mode={isDark ? 'dark' : 'light'}
              textareaProps={{
                placeholder: '开始编写 Markdown 文档…',
                spellCheck: false,
                onDoubleClick: () => setView('preview'),
                onSelect: (e) => {
                  // §4.1-F16 实时记录光标/选区位置，供弹层关闭后精确插入
                  const t = e.currentTarget;
                  cursorPosRef.current = { start: t.selectionStart, end: t.selectionEnd };
                },
                onKeyUp: (e) => {
                  const t = e.currentTarget;
                  cursorPosRef.current = { start: t.selectionStart, end: t.selectionEnd };
                },
                onClick: (e) => {
                  const t = e.currentTarget;
                  cursorPosRef.current = { start: t.selectionStart, end: t.selectionEnd };
                },
                onKeyDown: (e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setView('preview');
                  }
                },
              }}
            />
          </div>
        )}

        {/* TOC（预览态） */}
        {view === 'preview' && tocItems.length > 0 && (
          <nav
            className="hidden xl:flex w-56 shrink-0 flex-col pt-2 pl-4 pr-3 overflow-y-auto scrollbar-thin border-l"
            style={{ borderColor: 'var(--border-soft)' }}
          >
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-2 px-2">
              目录
            </div>
            <ul className="space-y-0.5">
              {tocItems.map((item, idx) => (
                <li
                  key={`${item.id}-${idx}`}
                  style={{
                    paddingLeft: item.level === 3 ? '12px' : item.level === 2 ? '4px' : '0',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => jumpToHeading(item.id)}
                    className={`block w-full text-left text-xs leading-5 px-2 py-0.5 rounded truncate transition-colors ${
                      activeHeadingId === item.id
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'
                    }`}
                    title={item.text}
                  >
                    {item.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      {/* §4.1-F16 Markdown 引用图片：插入图片弹层 */}
      <ImagePickerModal
        open={showImageModal}
        projectId={projectId}
        currentDocPath={file.path}
        onPick={handlePickImage}
        onClose={() => setShowImageModal(false)}
      />
    </section>
  );
}
