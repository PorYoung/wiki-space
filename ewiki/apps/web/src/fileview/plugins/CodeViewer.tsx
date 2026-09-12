// ---------------------------------------------------------------------------
// 代码/文本查看器（§4.4 F5）：CodeMirror 高亮 + 本地缓冲 + Ctrl+S 保存。
// 规则：
//   - 仅支持 UTF-8：content 未内联时拉 raw blob 并用 fatal TextDecoder 校验
//   - file.size > 2MB 强制只读并提示下载
//   - 未保存离开拦截（beforeunload），保存成功后清 dirty
//
// P4-6 CRDT 协同接入：
//   - 当 CollabProvider 提供 ytext + connected + synced 时：
//     extensions 加 yCollab(ytext, null, { undoManager: false })
//     value 始终取 ytext.toString()（ytext 为权威源）
//     首次 sync 时若 ytext 为空（新房间），用 file.content transact 初始化
//     onSave 取 ytext.toString() 而非本地 state
//   - 否则退回纯本地模式（与原来完全一致）
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import CodeMirror from '@uiw/react-codemirror';
import { loadLanguage, type LanguageName } from '@uiw/codemirror-extensions-langs';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { yCollab } from 'y-codemirror.next';
import type { FileViewerProps } from '../types';
import { downloadFile, fetchRawBlob } from '../api';
import { decodeUtf8Strict, humanSize } from '../util';
import { useCollab } from '../../lib/collab';

const READONLY_LIMIT = 2 * 1024 * 1024;

// 共享注册表白名单扩展名 → CodeMirror 语言（无匹配项按纯文本渲染）
const EXT_LANG: Record<string, LanguageName> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'mjs', cjs: 'cjs',
  json: 'json', jsonld: 'jsonld', map: 'json',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml', html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte', svg: 'svg',
  css: 'css', scss: 'scss', less: 'less',
  py: 'python', python: 'python', pyw: 'python',
  java: 'java', kt: 'kt', go: 'go', rs: 'rs', rb: 'rb', php: 'php',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'cs', swift: 'swift', scala: 'scala', groovy: 'groovy', gradle: 'groovy',
  sh: 'sh', bash: 'bash', zsh: 'sh', ksh: 'sh', ps1: 'ps1',
  sql: 'sql', toml: 'toml', ini: 'ini', conf: 'ini', properties: 'ini',
  proto: 'proto', markdown: 'markdown', md: 'md',
  txt: 'text', log: 'text', csv: 'text', tsv: 'text',
  env: 'text', gitignore: 'text', editorconfig: 'text', keep: 'text',
};

export function CodeViewer({ file, canWrite, isDark, onSave, host }: FileViewerProps): React.ReactElement {
  const collab = useCollab();
  // P4-6：协同模式必须 ytext 存在 + 已连 + 已收全量 synced 才启用
  const collabEnabled = collab?.ytext !== null && collab.connected && collab.synced;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // value 在协同模式下被重置为 ytext.toString() 覆盖，onChange 仅用于 dirty 检测
  const [value, setValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveRef = useRef<() => void>(() => {});

  const tooLarge = file.size > READONLY_LIMIT;

  // §6.2 ref 存最新值：避免 useEffect 闭包陷阱
  const prevFileIdRef = useRef<string | null>(null);
  const savedRef = useRef(savedValue);
  const valueRef = useRef(value);
  savedRef.current = savedValue;
  valueRef.current = value;

  // P4-6：协同初始化——在 synced 后把 file.content transact 写入空 ytext（新房间）
  const initializedRef = useRef<string | null>(null); // 已初始化过的 docId，防重入
  useEffect(() => {
    if (!collab?.ytext || !collab.synced) return;
    if (initializedRef.current === file.id) return;
    initializedRef.current = file.id;

    const ytext = collab.ytext;
    if (ytext.toString().length === 0 && ytext.doc) {
      // 新房间（服务器无历史）→ 用 file.content 初始化 ytext
      const initContent = typeof file.content === 'string' ? file.content : '';
      ytext.doc.transact(() => {
        ytext.insert(0, initContent);
      });
    }
    // 否则服务器已有状态，ySync 插件会自动从 ytext 推送到 CM6
    // 把 saved/value 对齐到 ytext
    const remote = ytext.toString();
    setSavedValue(remote);
    setValue(remote);
  }, [collab?.ytext, collab?.synced, file.id, file.content]);

  // §6.2 跨宿主文件切换逻辑（非协同模式下的服务器 content 更新）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);

    const switched = file.id !== prevFileIdRef.current;
    if (switched) prevFileIdRef.current = file.id;

    // P4-6：协同模式下等 synced，不从 API content 填充（权威源在 ytext）
    if (collabEnabled) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const finish = (text: string) => {
      if (cancelled) return;
      if (switched) {
        setValue(text);
        setSavedValue(text);
      } else if (text !== savedRef.current) {
        if (valueRef.current === savedRef.current) {
          setValue(text);
          setSavedValue(text);
        } else {
          setSavedValue(text);
        }
      }
      setLoading(false);
    };

    if (typeof file.content === 'string') {
      finish(file.content);
      return () => {
        cancelled = true;
      };
    }

    fetchRawBlob(file)
      .then(decodeUtf8Strict)
      .then((text) => {
        if (cancelled) return;
        finish(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof TypeError || (err instanceof Error && /decoder|encoding/i.test(err.message))
            ? '文件不是合法的 UTF-8 文本，无法在线查看，请下载后使用本地编辑器打开'
            : err instanceof Error
              ? err.message
              : '文件加载失败',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file.id, file.content, file.rawUrl, file.versionNo, collabEnabled]);

  // P4-6：协同模式下 value 始终取 ytext.toString() —— CM6 由 ySync 插件驱动，
  // react-codemirror 只负责把 value 作为初始 doc（它内部对 setValue 有 diff 保护）
  const displayValue = collabEnabled && collab.ytext ? collab.ytext.toString() : value;

  // dirty 判定：协同模式用 ytext vs savedValue；非协同用本地 state
  const dirty = collabEnabled
    ? collab.ytext?.toString() !== savedValue
    : value !== savedValue;
  const editable = canWrite && !!onSave && !tooLarge && !loadError;

  const extensions = useMemo<Extension[]>(() => {
    const langName = EXT_LANG[file.ext];
    const lang = langName ? loadLanguage(langName) : null;
    const base: Extension[] = [];
    if (lang) base.push(lang);
    // P4-6：协同模式加 yCollab 扩展（关闭 undoManager，保留宿主可能的 Ctrl+S 保存）
    if (collabEnabled && collab.ytext) {
      base.push(yCollab(collab.ytext, null, { undoManager: false }));
    }
    return base;
  }, [file.ext, collabEnabled, collab?.ytext]);

  const doSave = async () => {
    if (!onSave || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      // P4-6：协同模式取 ytext 权威源，非协同取本地 state
      const content = collabEnabled && collab.ytext ? collab.ytext.toString() : value;
      await onSave(content);
      setSavedValue(content);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => {
    void doSave();
  };

  // Ctrl/⌘+S 保存
  useEffect(() => {
    if (!editable) return undefined;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editable]);

  // 离开未保存提示
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-neutral-400">
        正在加载文件…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-sm text-neutral-700 mb-3">{loadError}</p>
          <button
            type="button"
            className="btn-secondary !h-8 !px-3 !text-xs"
            onClick={() => void downloadFile(file)}
          >
            下载文件
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col" style={{ background: 'var(--bg-surface)' }}>
      <div
        className="shrink-0 h-10 px-4 flex items-center gap-3 border-b text-xs"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-page)' }}
      >
        <span className="font-mono text-neutral-400">{file.ext ? `.${file.ext}` : '纯文本'}</span>
        <span className="text-neutral-300">·</span>
        <span className="text-neutral-400">{humanSize(file.size)}</span>
        {dirty && (
          <span className="inline-flex items-center gap-1 text-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            未保存
          </span>
        )}
        {saveError && <span className="text-red-500 truncate">{saveError}</span>}
        {/* P4-6 CRDT 协同状态提示 */}
        {collabEnabled && collab.peers.size > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {collab.peers.size + 1} 人协同中
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="btn-secondary !h-7 !w-7 !p-0"
          onClick={() => host?.openOpenInfo()}
          title="文件信息"
        >
          信息
        </button>
        {editable && (
          <button
            type="button"
            className="btn-primary !h-7 !px-2.5 !text-xs disabled:opacity-60"
            disabled={!dirty || saving}
            onClick={() => void doSave()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </div>

      {tooLarge && (
        <div
          className="shrink-0 px-4 py-2.5 flex items-center gap-3 border-b text-xs bg-amber-50 text-amber-800"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          <span>文件超过 2MB，已降级只读，请下载后编辑</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <CodeMirror
          value={displayValue}
          height="100%"
          style={{ height: '100%' }}
          theme={isDark ? githubDark : githubLight}
          extensions={extensions}
          readOnly={!editable}
          editable={editable}
          basicSetup={{ lineNumbers: true, highlightActiveLine: editable, foldGutter: true }}
          onChange={(next) => {
            // P4-6：协同模式下 ytext 是权威源，但 onChange 仍保留——
            // 它会触发 dirty 状态更新，保存按钮得以启用。
            setValue(next);
          }}
        />
      </div>
    </div>
  );
}
