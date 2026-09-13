// ---------------------------------------------------------------------------
// Markdown 查看器（§4.4 / §6.2 / P4-6 CRDT 协同）：
//   - 双编辑模式并行：
//     · wysiwyg（默认）：@latentic/live-markdown — CM6 原生 WYSIWYG，
//       Markdown 字符串 byte-for-byte 往返。完整 GFM 覆盖：表格/数学/
//       Mermaid/TaskList/脚注/wiki-links。
//     · source：CodeMirror 6 + @codemirror/lang-markdown（lezer 语法树）
//       + typoraDecorations 手写隐藏。保留作为 fallback。
//   - y-codemirror.next 绑定 Y.Text — 两种模式都复用同一协同通道
//   - 预览态：markdownToHtml 渲染
//   - 7 套渲染主题 + 快捷键：Ctrl+S 保存、Ctrl+E 切换预览/编辑
//   - 双击进入编辑、协同状态条、插入图片弹层、未保存离开拦截
// ---------------------------------------------------------------------------

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yCollab } from 'y-codemirror.next';
// live-markdown — WYSIWYG 模式（默认）
import {
  CodeMirrorMarkdownEditor,
  tableExtension,
  mathExtension,
  mermaidExtension,
  footnoteExtension,
  wikilinkExtension,
  type MarkdownExtension,
} from '@latentic/live-markdown';
import {
  BookOpen,
  Bold,
  CheckCircle2,
  ChevronDown,
  Code,
  Eye,
  FileText,
  Heading1,
  Image as ImageIcon,
  Italic,
  Layers,
  Link,
  List,
  ListOrdered,
  Moon,
  Palette,
  PenTool,
  Quote,
  Save,
  Strikethrough,
  Sun,
  Minus,
  type LucideIcon,
} from 'lucide-react';
import { slugify, markdownToHtml } from '../../lib/markdown';
import { useMermaidRender } from '../../lib/use-mermaid-render';
import type { FileViewerProps } from '../types';
import { ImagePickerModal } from './ImagePickerModal';
import { useCollab } from '../../lib/collab';
import {
  wrapSelection,
  toggleLinePrefix,
  toggleHeading,
  insertInlineCode,
  insertLink,
  insertHorizontalRule,
} from '../formatting';
import { typoraDecorations } from '../wysiwyg-decorations';

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
  pos: number;
}

/**
 * 从 CM6 文档的 lezer-markdown 语法树遍历 heading 节点（ATXHeading1~6 + SetextHeading1~2）。
 * 全部 heading 类型共享 `Heading` 标签（lezer-markdown 的 Type 定义），用 node.type.is('Heading') 统一匹配。
 */
function extractTocFromView(view: EditorView): TocItem[] {
  const toc: TocItem[] = [];
  const tree = syntaxTree(view.state);
  tree.iterate({
    enter(node) {
      if (!node.type.is('Heading')) return;
      const doc = view.state.doc;
      const raw = doc.sliceString(node.from, node.to);
      // ATXHeading：去掉 "# " 前缀；SetextHeading：去掉末尾 "=== / ---" underline
      let text = raw
        .replace(/^#{1,6}\s+/, '')
        .replace(/\s*[=-]+\s*$/, '')
        .trim();
      // 取 heading 级别（ATXHeading1~6 直接读数字，SetextHeading1=1 / SetextHeading2=2）
      let level = 1;
      const n = node.type.name.match(/(\d+)$/);
      if (n) level = Number(n[1]);
      if (!text) return;
      toc.push({ level, text, id: slugify(text), pos: node.from });
    },
  });
  return toc;
}

export function MarkdownViewer({ file, canWrite, isDark, onSave, projectId }: FileViewerProps): React.ReactElement {
  const collab = useCollab();
  // P4-6：协同模式必须 ytext 存在 + 已连 + 已收全量 synced 才启用 y-codemirror.next
  const collabEnabled = collab?.ytext !== null && collab.connected && collab.synced;

  const initial = file.content ?? '';
  const [view, setView] = useState<'preview' | 'edit'>('preview');
  // 编辑器模式：wysiwyg（live-markdown，默认） / source（原生 CM6 + decorations，fallback）
  const [editorMode, setEditorMode] = useState<'wysiwyg' | 'source'>('wysiwyg');
  const [buffer, setBuffer] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renderTheme, setRenderTheme] = useState('plain');
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showCollabPopover, setShowCollabPopover] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const prevFileIdRef = useRef<string | null>(null);
  const savedRef = useRef(saved);
  const bufferRef = useRef(buffer);
  savedRef.current = saved;
  bufferRef.current = buffer;

  // ---------------------------------------------------------------------------
  // P4-6：协同初始化——在 synced 后把 file.content transact 写入空 ytext（新房间）
  // ---------------------------------------------------------------------------
  const initializedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!collab?.ytext || !collab.synced) return;
    if (initializedRef.current === file.id) return;
    initializedRef.current = file.id;

    const ytext = collab.ytext;
    if (ytext.toString().length === 0 && ytext.doc) {
      const initContent = typeof file.content === 'string' ? file.content : '';
      ytext.doc.transact(() => {
        ytext.insert(0, initContent);
      });
    }
    const remote = ytext.toString();
    setSaved(remote);
    setBuffer(remote);
  }, [collab?.ytext, collab?.synced, file.id, file.content]);

  // §6.2 跨宿主文件切换逻辑（非协同模式下的服务器 content 更新）
  useEffect(() => {
    const next = file.content ?? '';
    if (file.id !== prevFileIdRef.current) {
      prevFileIdRef.current = file.id;
      // P4-6：协同模式下等 synced，不从 API content 填充（权威源在 ytext）
      if (collabEnabled) return;
      setBuffer(next);
      setSaved(next);
      setSaveError(null);
      setView('preview');
      setActiveHeadingId(null);
    } else if (!collabEnabled && next !== savedRef.current) {
      if (bufferRef.current === savedRef.current) {
        setBuffer(next);
      }
      setSaveError(null);
    }
  }, [file.id, file.content, collabEnabled]);

  // ---------------------------------------------------------------------------
  // P4-6：协同模式下 value 始终取 ytext.toString() —— y-codemirror.next 是权威源
  // ---------------------------------------------------------------------------
  const displayValue = collabEnabled && collab.ytext ? collab.ytext.toString() : buffer;

  // dirty 判定：协同模式用 ytext vs saved；非协同用本地 state
  const dirty = collabEnabled
    ? collab.ytext?.toString() !== saved
    : buffer !== saved;

  const doSave = async () => {
    if (!onSave || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const content = collabEnabled && collab.ytext ? collab.ytext.toString() : buffer;
      await onSave(content);
      setSaved(content);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // ---------------------------------------------------------------------------
  // 全局快捷键兜底：Ctrl/⌘+S 保存、Ctrl/⌘+E 切换、Esc 回预览
  // （即使编辑器未 mount / 焦点不在编辑器上也生效）
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!canWrite || !onSave) return undefined;
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void doSaveRef.current();
      } else if (mod && key === 'e') {
        e.preventDefault();
        setView((v) => (v === 'edit' ? 'preview' : 'edit'));
      } else if (e.key === 'Escape' && view === 'edit') {
        e.preventDefault();
        setView('preview');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canWrite, onSave, view]);

  // ---------------------------------------------------------------------------
  // TOC：协同模式从 CM6 view 的 lezer 语法树提取；非协同模式退化为原 regex 提取
  // （协同模式下 buffer 可能还没同步到最新——以 CM6 内部 doc 为准更稳）
  // ---------------------------------------------------------------------------
  const [tocFromEditor, setTocFromEditor] = useState<TocItem[] | null>(null);
  const tocItems = useMemo<TocItem[]>(() => {
    if (view === 'edit' && cmRef.current?.view) {
      const live = extractTocFromView(cmRef.current.view);
      if (live.length > 0) return live;
    }
    // 非编辑态 / 编辑器尚未 mount / 语法树遍历为空 → 退化为 regex
    const fallback: TocItem[] = [];
    for (const line of (view === 'edit' ? buffer : saved).split('\n')) {
      const h3 = line.match(/^###\s+(.+)$/);
      const h2 = line.match(/^##\s+(.+)$/);
      const h1 = line.match(/^#\s+(.+)$/);
      if (h3) fallback.push({ level: 3, text: h3[1]!.trim(), id: slugify(h3[1]!), pos: 0 });
      else if (h2) fallback.push({ level: 2, text: h2[1]!.trim(), id: slugify(h2[1]!), pos: 0 });
      else if (h1) fallback.push({ level: 1, text: h1[1]!.trim(), id: slugify(h1[1]!), pos: 0 });
    }
    return fallback;
  }, [view, buffer, saved, tocFromEditor]);

  const deferredSaved = useDeferredValue(saved);
  const previewHtml = useMemo(() => markdownToHtml(deferredSaved), [deferredSaved]);
  useMermaidRender(previewScrollRef, view === 'preview', isDark, previewHtml);

  // ---------------------------------------------------------------------------
  // P4-6：CM6 扩展配置
  // ---------------------------------------------------------------------------
  const extensions = useMemo<Extension[]>(() => {
    const base: Extension[] = [
      markdown(),
      lineNumbers(),
      highlightActiveLine(),
      history(),
      ...typoraDecorations, // Typora 式 WYSIWYG: 隐藏语法标记 + 富样式 decorations
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        // P4-6：Ctrl/⌘+S 保存、Ctrl/⌘+E 切换预览/编辑、Esc 回预览
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            void doSaveRef.current();
            return true;
          },
        },
        {
          key: 'Mod-e',
          preventDefault: true,
          run: () => {
            setView((v) => (v === 'edit' ? 'preview' : 'edit'));
            return true;
          },
        },
        {
          key: 'Escape',
          preventDefault: true,
          run: () => {
            setView('preview');
            return true;
          },
        },
      ]),
    ];
    // P4-6：协同模式挂 y-codemirror.next —— 实时远程光标 + CRDT 自动合并
    if (collabEnabled && collab.ytext) {
      base.push(yCollab(collab.ytext, collab.awareness ?? null, { undoManager: collab.undoManager ?? false }));
    }
    // P4-6：selection 变化 → 防抖广播 presence cursor
    base.push(
      EditorView.updateListener.of((update: ViewUpdate) => {
        // 光标位置追踪（底部状态栏）—— 每次 view update 都更新，不受 selectionSet 限制
        const sel = update.state.selection.main;
        const line = update.state.doc.lineAt(sel.head);
        setCursorPos({ line: line.number, col: sel.head - line.from + 1 });

        if (update.selectionSet) {
          const lc = { line: line.number - 1, ch: sel.head - line.from };
          // 防抖 150ms + 同位置不重发（避免打字时每条按键都发）
          debounceSendCursor(lc);
          // 顺便更新编辑态 TOC（光标位置可能刚加了/删了 heading）
          setTocFromEditor(extractTocFromView(update.view));
        }
      }),
    );
    return base;
  }, [collabEnabled, collab?.ytext, collab?.awareness, collab?.undoManager]);

  // ---------------------------------------------------------------------------
  // live-markdown extensions — wysiwyg 模式（默认）
  //   y-codemirror.next 通过 MarkdownExtension.extensions 注入到内部 CM6
  // ---------------------------------------------------------------------------
  const wysiwygExtensions = useMemo<MarkdownExtension[]>(() => {
    const exts: MarkdownExtension[] = [
      tableExtension(),
      mathExtension,
      mermaidExtension,
      footnoteExtension,
      wikilinkExtension,
    ];
    if (collabEnabled && collab?.ytext) {
      exts.push({
        name: '@ewiki/y-collab',
        version: '1.0.0',
        extensions: [yCollab(collab.ytext, collab.awareness ?? null, { undoManager: collab.undoManager ?? false })],
      });
    }
    return exts;
  }, [collabEnabled, collab?.ytext, collab?.awareness, collab?.undoManager]);

  // ---------------------------------------------------------------------------
  // P4-6：presence 光标防抖广播
  // ---------------------------------------------------------------------------
  const lastSentCursorRef = useRef<{ line: number; ch: number } | null>(null);
  const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceSendCursor = useCallback(
    (lc: { line: number; ch: number }) => {
      const last = lastSentCursorRef.current;
      if (last && last.line === lc.line && last.ch === lc.ch) return;
      lastSentCursorRef.current = lc;
      if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);
      cursorDebounceRef.current = setTimeout(() => {
        collab.sendCursor(lc);
      }, 150);
    },
    [collab],
  );

  // 文件切换时重置协同光标状态
  useEffect(() => {
    lastSentCursorRef.current = null;
    setTocFromEditor(null);
    if (cursorDebounceRef.current) {
      clearTimeout(cursorDebounceRef.current);
      cursorDebounceRef.current = null;
    }
  }, [file.id]);

  // ---------------------------------------------------------------------------
  // 预览态滚动 scroll-spy
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 离开未保存拦截
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ---------------------------------------------------------------------------
  // 跳转 heading（TOC 点击）
  // ---------------------------------------------------------------------------
  const jumpToHeading = (id: string) => {
    // 编辑态 → 用 CM6 view 把光标跳过去（如果 tocFromEditor 里存了 pos）
    if (view === 'edit' && cmRef.current?.view) {
      const tocItem = tocItems.find((t) => t.id === id);
      if (tocItem && tocItem.pos > 0) {
        cmRef.current.view.dispatch({
          selection: { anchor: tocItem.pos, head: tocItem.pos },
          scrollIntoView: true,
        });
        return;
      }
    }
    // 预览态 → DOM scrollIntoView
    if (!previewScrollRef.current) return;
    const el = previewScrollRef.current.querySelector(`#${CSS.escape(id)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------------------------------------------------------------------------
  // 插入图片弹层 —— 适配 CM6 的 EditorView
  // ---------------------------------------------------------------------------
  const recordEditorSelection = () => {
    const view = cmRef.current?.view;
    if (!view) return;
    const sel = view.state.selection.main;
    imageInsertRangeRef.current = { start: sel.from, end: sel.to };
  };
  const imageInsertRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const handlePickImage = (markdown: string) => {
    const view = cmRef.current?.view;
    const range = imageInsertRangeRef.current;
    if (view) {
      view.dispatch({
        changes: { from: range.start, to: range.end, insert: markdown },
        selection: { anchor: range.start + markdown.length, head: range.start + markdown.length },
      });
      view.focus();
    }
    // 非协同模式下 setBuffer 同步 state（CM6 onChange 也会触发，但这里立刻更新避免 UI 空窗）
    setShowImageModal(false);
    requestAnimationFrame(() => view?.focus());
  };

  // P4-6：协作者数量（底部状态栏 + 工具栏 banner 用）
  // P4-6：根据 userId 稳定哈希颜色 — 协作者头像 + awareness cursor 共用
const PEER_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#ec4899',
];
function getPeerColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length]!;
}
const peersList = Array.from(collab.peers.values());
  const totalPeers = peersList.length + (collab.connected ? 1 : 0); // 含自己

  return (
    <section
      className="h-full min-h-0 flex flex-col min-w-0 overflow-hidden"
      style={{ background: 'var(--bg-surface)' }}
    >
      {/* ── 工具栏（紧凑原型风格：左=文件名，右=按钮） ── */}
      <div
        className="shrink-0 flex items-center justify-between gap-4 px-4 h-10"
        style={{ borderBottom: '1px solid var(--border-soft)' }}
      >
        {/* 左：空或显示文件操作占位（原型此处也是空的） */}
        <div className="flex items-center gap-2 text-[12px] text-neutral-500">
          {saveError && (
            <span className="text-red-500 text-[11px]">保存失败：{saveError}</span>
          )}
        </div>

        {/* 右：紧凑按钮组 — 对齐原型 */}
        <div className="flex items-center gap-1">
          {canWrite && onSave && view === 'edit' && (
            <button
              type="button"
              onClick={() => {
                recordEditorSelection();
                setShowImageModal(true);
              }}
              title="插入图片 / 附件（Markdown 图片语法）"
              className="inline-flex items-center gap-1 h-7 px-2 rounded text-[12px] text-neutral-600 hover:bg-neutral-100 transition"
            >
              <ImageIcon size={13} /> 插入图片
            </button>
          )}

          {view === 'preview' && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowThemeMenu((s) => !s)}
                className="inline-flex items-center gap-0.5 h-7 px-2 rounded text-[12px] text-neutral-600 hover:bg-neutral-100 transition"
              >
                <Palette size={11} />
                {RENDER_THEMES.find((t) => t.key === renderTheme)?.label ?? '经典'}
                <ChevronDown size={10} />
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
                              <div className={`text-xs font-medium ${active ? 'text-primary-700' : 'text-neutral-700'}`}>
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

          {/* 预览/编辑 segmented control */}
          <div className="bg-neutral-100 rounded-md p-0.5 inline-flex">
            <button
              type="button"
              onClick={() => setView('preview')}
              className={`inline-flex items-center gap-1 px-2 h-7 rounded text-[12px] font-medium transition ${
                view === 'preview' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <Eye size={12} /> 预览
            </button>
            {canWrite && onSave && (
              <button
                type="button"
                onClick={() => setView('edit')}
                title="双击内容可快速进入编辑"
                className={`inline-flex items-center gap-1 px-2 h-7 rounded text-[12px] font-medium transition ${
                  view === 'edit' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <PenTool size={12} /> 编辑
              </button>
            )}
          </div>

          {/* 编辑器模式：WYSWYG / Source — 仅编辑态显示 */}
          {view === 'edit' && (
            <div className="bg-neutral-100 rounded-md p-0.5 inline-flex" title="编辑器模式">
              <button
                type="button"
                onClick={() => setEditorMode('wysiwyg')}
                className={`inline-flex items-center gap-1 px-2 h-7 rounded text-[12px] font-medium transition ${
                  editorMode === 'wysiwyg' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <PenTool size={12} /> WYSIWYG
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('source')}
                className={`inline-flex items-center gap-1 px-2 h-7 rounded text-[12px] font-medium transition ${
                  editorMode === 'source' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <Code size={12} /> 源码
              </button>
            </div>
          )}

          {/* 保存 / 已保存 — 紧凑按钮，对齐原型绿色 pill */}
          {canWrite && onSave && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 h-7 px-2 rounded text-[12px] font-medium transition ${
                saving
                  ? 'text-primary-600 bg-primary-50'
                  : dirty
                    ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                    : 'text-emerald-600 bg-emerald-50'
              }`}
              onClick={() => void doSave()}
              disabled={saving || !dirty}
            >
              <Save size={12} /> {saving ? '保存中…' : dirty ? '保存' : '已保存'}
            </button>
          )}
        </div>
      </div>

      {/* ── 格式化工具栏（source 模式显示；wysiwyg 由 live-markdown 内置） ── */}
      {view === 'edit' && editorMode === 'source' && canWrite && onSave && (
        <div
          className="shrink-0 flex items-center gap-0.5 px-4 h-8 text-neutral-600"
          style={{ borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-page)' }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {[
            { icon: Heading1, tip: '标题（循环 H1-H6）', act: () => toggleHeading(cmRef.current!.view!) },
            { divider: true },
            { icon: Bold, tip: '加粗 (Ctrl+B)', act: () => wrapSelection(cmRef.current!.view!, '**') },
            { icon: Italic, tip: '斜体 (Ctrl+I)', act: () => wrapSelection(cmRef.current!.view!, '*') },
            { icon: Strikethrough, tip: '删除线', act: () => wrapSelection(cmRef.current!.view!, '~~') },
            { icon: Quote, tip: '引用', act: () => toggleLinePrefix(cmRef.current!.view!, '> ') },
            { icon: Code, tip: '行内代码', act: () => insertInlineCode(cmRef.current!.view!) },
            { divider: true },
            { icon: List, tip: '无序列表 (-)', act: () => toggleLinePrefix(cmRef.current!.view!, '- ') },
            { icon: ListOrdered, tip: '有序列表 (1.)', act: () => toggleLinePrefix(cmRef.current!.view!, '1. ') },
            { divider: true },
            { icon: Link, tip: '链接', act: () => insertLink(cmRef.current!.view!) },
            { icon: ImageIcon, tip: '图片', act: () => { recordEditorSelection(); setShowImageModal(true); } },
            { icon: Minus, tip: '分割线 (---)', act: () => insertHorizontalRule(cmRef.current!.view!) },
          ].map((b, i) =>
            'divider' in b ? (
              <div key={'div' + i} className="w-px h-4 bg-neutral-200 mx-1.5" />
            ) : (
              <button
                key={b.tip}
                type="button"
                title={b.tip}
                onClick={() => {
                  const v = cmRef.current?.view;
                  if (!v) return;
                  (b as { act: (view: unknown) => void }).act(v);
                  v.focus();
                }}
                className="inline-flex items-center justify-center w-7 h-6 rounded hover:bg-neutral-200 transition"
              >
                {(() => {
                  const Ic = (b as { icon: LucideIcon }).icon;
                  return <Ic size={14} />;
                })()}
              </button>
            ),
          )}
        </div>
      )}

      {/* ── 内容区：主内容 + TOC 侧栏（常驻） ── */}
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
            {/* live-markdown WYSIWYG（默认）— 完整 GFM + 协同复用 */}
            {editorMode === 'wysiwyg' ? (
              <CodeMirrorMarkdownEditor
                mode="wysiwyg"
                value={displayValue}
                onChange={setBuffer}
                extensions={wysiwygExtensions}
              />
            ) : (
              /* source 模式：原生 CM6 + typoraDecorations（fallback） */
              <CodeMirror
                ref={cmRef}
                value={displayValue}
                height="100%"
                style={{ height: '100%' }}
                theme={isDark ? githubDark : githubLight}
                extensions={extensions}
                readOnly={!canWrite || !onSave}
                editable={canWrite && !!onSave}
                basicSetup={false}
                placeholder="开始编写 Markdown 文档…"
                indentWithTab={true}
                onUpdate={(update) => {
                  setBuffer(update.state.doc.toString());
                  if (update.docChanged || update.selectionSet) {
                    setTocFromEditor(extractTocFromView(update.view));
                  }
                }}
                onCreateEditor={(view) => {
                  setTocFromEditor(extractTocFromView(view));
                }}
              />
            )}
          </div>
        )}

        {/* TOC 侧栏 — 常驻显示，对齐原型 */}
        {tocItems.length > 0 && (
          <nav
            className="hidden md:flex w-48 shrink-0 flex-col pt-3 pl-3 pr-2 overflow-y-auto scrollbar-thin border-l"
            style={{ borderColor: 'var(--border-soft)' }}
          >
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-2 px-2">
              目录
            </div>
            <ul className="space-y-0.5">
              {tocItems.map((item, idx) => (
                <li
                  key={`${item.id}-${idx}`}
                  style={{ paddingLeft: item.level === 3 ? '12px' : item.level === 2 ? '4px' : '0' }}
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

      {/* ── 底部状态栏：行号/列号 + 协同状态 + 保存状态 + 协作者头像 ── */}
      <div
        className="shrink-0 flex items-center justify-between px-4 h-7 text-[11px]"
        style={{ borderTop: '1px solid var(--border-soft)' }}
      >
        <div className="flex items-center gap-3 text-neutral-500">
          <span className="font-mono">L{cursorPos.line}, C{cursorPos.col}</span>
          <span className="text-neutral-400">· {displayValue?.split('\n').length ?? 1} 行</span>
          <span className="w-px h-3 bg-neutral-200" />
          {/* 协同状态 + 下拉列表（点击展开） */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCollabPopover((s) => !s)}
              className="inline-flex items-center gap-1 hover:bg-neutral-100 px-1.5 h-5 rounded transition"
              title="点击查看协作者列表"
            >
              {collab.connected ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  协同在线·{totalPeers}人
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  协同离线
                </span>
              )}
              {peersList.length > 0 && (
                <span className="inline-flex items-center -space-x-0.5 ml-1">
                  {peersList.slice(0, 3).map((p) => (
                    <span
                      key={p.userId}
                      title={p.name}
                      className="w-3.5 h-3.5 rounded-full border border-white text-[7px] font-bold text-white flex items-center justify-center shrink-0"
                      style={{ background: getPeerColor(p.userId) }}
                    >
                      {(p.name || p.userId).charAt(0).toUpperCase()}
                    </span>
                  ))}
                </span>
              )}
            </button>
            {showCollabPopover && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowCollabPopover(false)} />
                <div className="absolute left-0 bottom-full mb-1 w-56 rounded-lg bg-white border border-neutral-200 shadow-xl z-30 text-neutral-800 text-xs max-h-72 overflow-y-auto">
                  <div className="px-3 py-2 border-b border-neutral-100 text-[10px] uppercase tracking-wide text-neutral-500 font-semibold">
                    协作者（{totalPeers}）
                  </div>
                  <ul className="py-1">
                    {/* 自己 */}
                    {collab.localUser && (
                      <li className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50">
                        <span
                          className="w-5 h-5 rounded-full border border-white text-[9px] font-bold text-white flex items-center justify-center shrink-0"
                          style={{ background: getPeerColor(collab.localUser.userId) }}
                        >
                          {collab.localUser.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="flex-1 truncate">
                          {collab.localUser.name}
                          <span className="ml-1 text-[10px] text-neutral-400">(我)</span>
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      </li>
                    )}
                    {/* 远端 peers */}
                    {peersList.map((p) => (
                      <li key={p.userId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50">
                        <span
                          className="w-5 h-5 rounded-full border border-white text-[9px] font-bold text-white flex items-center justify-center shrink-0"
                          style={{ background: getPeerColor(p.userId) }}
                        >
                          {(p.name || p.userId).charAt(0).toUpperCase()}
                        </span>
                        <span className="flex-1 truncate">{p.name || p.userId}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      </li>
                    ))}
                    {!collab.localUser && peersList.length === 0 && (
                      <li className="px-3 py-2 text-neutral-400 text-center">
                        暂无协作者
                      </li>
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-primary-600">保存中…</span>}
          {!saving && dirty && <span className="text-amber-600">● 有未保存修改</span>}
          {!saving && !dirty && <span className="text-emerald-600">✓ 已保存</span>}
        </div>
      </div>

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
