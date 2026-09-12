// ---------------------------------------------------------------------------
// 代码/文本查看器（§4.4 F5）：CodeMirror 高亮 + 本地缓冲 + Ctrl+S 保存。
// 规则：
//   - 仅支持 UTF-8：content 未内联时拉 raw blob 并用 fatal TextDecoder 校验
//   - file.size > 2MB 强制只读并提示下载
//   - 未保存离开拦截（beforeunload），保存成功后清 dirty
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { loadLanguage, type LanguageName } from '@uiw/codemirror-extensions-langs';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { AlertTriangle, Download, FileCog, History, Save } from 'lucide-react';
import type { FileViewerProps } from '../types';
import { downloadFile, fetchRawBlob } from '../api';
import { decodeUtf8Strict, humanSize } from '../util';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveRef = useRef<() => void>(() => {});

  const tooLarge = file.size > READONLY_LIMIT;

  // §6.2 ref 存最新值：避免 useEffect 闭包陷阱（§6.2 跨宿主文件切换逻辑）
  const prevFileIdRef = useRef<string | null>(null);
  const savedRef = useRef(savedValue);
  const valueRef = useRef(value);
  savedRef.current = savedValue;
  valueRef.current = value;

  // §6.2 跨宿主文件切换逻辑：
  //   - file.id 变 → 切换了文件：全重置 + 载入新内容（从 content 内联或拉 raw blob）
  //   - file.id 不变但 file.content 变 → WS 通知服务器有新版本：
  //     - value === savedValue（clean）→ 自动更新为新 content
  //     - value !== savedValue（dirty）→ 保留用户输入，保存时触发 409
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);

    // file.id 变 = 切换文件，需全重置；否则只是服务器版本变更
    const switched = file.id !== prevFileIdRef.current;
    if (switched) prevFileIdRef.current = file.id;

    const finish = (text: string) => {
      if (cancelled) return;
      if (switched) {
        // 切换文件：全重置
        setValue(text);
        setSavedValue(text);
      } else if (text !== savedRef.current) {
        // 同文件，服务器 content 变了
        if (valueRef.current === savedRef.current) {
          // clean：安全更新
          setValue(text);
          setSavedValue(text);
        } else {
          // dirty：用户有未保存输入，只更新 saved 让状态与服务器对齐
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
    // 仅按稳定字段重载：宿主重渲染产生新对象（但内容未变）不能冲掉本地未保存缓冲
  }, [file.id, file.content, file.rawUrl, file.versionNo]);

  const dirty = value !== savedValue;
  const editable = canWrite && !!onSave && !tooLarge && !loadError;

  const extensions = useMemo(() => {
    const langName = EXT_LANG[file.ext];
    const lang = langName ? loadLanguage(langName) : null;
    return lang ? [lang] : [];
  }, [file.ext]);

  const doSave = async () => {
    if (!onSave || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(value);
      setSavedValue(value);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => {
    void doSave();
  };

  // Ctrl/⌘+S 保存（焦点在编辑器内同样拦截浏览器默认）
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
          <AlertTriangle size={36} className="mx-auto mb-3 text-amber-500" />
          <p className="text-sm text-neutral-700 mb-3">{loadError}</p>
          <button
            type="button"
            className="btn-secondary !h-8 !px-3 !text-xs"
            onClick={() => void downloadFile(file)}
          >
            <Download size={13} /> 下载文件
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
        <span className="flex-1" />
        <button
          type="button"
          className="btn-secondary !h-7 !w-7 !p-0"
          onClick={() => host?.openOpenInfo()}
          title="文件信息"
        >
          <FileCog size={13} />
        </button>
        <button
          type="button"
          className="btn-secondary !h-7 !w-7 !p-0"
          onClick={() => host?.openHistory()}
          title="历史记录"
        >
          <History size={13} />
        </button>
        {editable && (
          <button
            type="button"
            className="btn-primary !h-7 !px-2.5 !text-xs disabled:opacity-60"
            disabled={!dirty || saving}
            onClick={() => void doSave()}
          >
            <Save size={13} /> {saving ? '保存中…' : '保存'}
          </button>
        )}
      </div>

      {tooLarge && (
        <div
          className="shrink-0 px-4 py-2.5 flex items-center gap-3 border-b text-xs bg-amber-50 text-amber-800"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          <AlertTriangle size={14} className="shrink-0" />
          <span>文件超过 2MB，已降级只读，请下载后编辑</span>
          <span className="flex-1" />
          <button
            type="button"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium border border-amber-300 text-amber-800 hover:bg-amber-100 transition"
            onClick={() => void downloadFile(file)}
          >
            <Download size={13} /> 下载
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <CodeMirror
          value={value}
          height="100%"
          style={{ height: '100%' }}
          theme={isDark ? githubDark : githubLight}
          extensions={extensions}
          readOnly={!editable}
          editable={editable}
          basicSetup={{ lineNumbers: true, highlightActiveLine: editable, foldGutter: true }}
          onChange={(next) => setValue(next)}
        />
      </div>
    </div>
  );
}
