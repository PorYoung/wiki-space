// ---------------------------------------------------------------------------
// 图片查看器（§4.4 F6）：
//   - 位图：objectURL 居中、等比适配视口；点击新窗口打开原图；展示宽×高 + humanSize
//   - SVG：存储型 XSS 风险，必须用 <iframe sandbox=""> 渲染，禁止 <img>
//   - 工具栏：下载 / 复制 Markdown 引用 / 替换上传（canWrite 且宿主提供回调）
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  FileCog,
  History,
  Link2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { FileViewerProps } from '../types';
import { downloadFile, useObjectUrl } from '../api';
import { fileBaseName, humanSize } from '../util';

function isSvg(file: FileViewerProps['file']): boolean {
  return file.ext === 'svg' || file.mime === 'image/svg+xml';
}

/** Markdown 相对路径引用（path 本身即库内相对路径，直接使用） */
function markdownRef(file: FileViewerProps['file']): string {
  return `![${file.title || fileBaseName(file.path)}](${file.path})`;
}

export function ImageViewer({
  file,
  canWrite,
  onReplaced,
  onReplaceUpload,
  host,
}: FileViewerProps): React.ReactElement {
  const { url, loading, error } = useObjectUrl(file);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyRef = async () => {
    const text = markdownRef(file);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 非安全上下文 / 权限拒绝：降级临时 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
    setCopied(true);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const pickReplace = () => fileInputRef.current?.click();

  const handleReplace = async (picked: File | undefined) => {
    if (!picked || !onReplaceUpload) return;
    setReplacing(true);
    setReplaceError(null);
    try {
      await onReplaceUpload(picked);
      onReplaced();
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : '替换上传失败');
    } finally {
      setReplacing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const canReplace = canWrite && !!onReplaceUpload;
  const svg = isSvg(file);

  return (
    <div className="h-full min-h-0 flex flex-col" style={{ background: 'var(--bg-surface)' }}>
      {/* 工具栏 */}
      <div
        className="shrink-0 h-11 px-4 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-page)' }}
      >
        <span className="text-xs font-mono text-neutral-400 truncate">{fileBaseName(file.path)}</span>
        <span className="flex-1" />
        {replaceError && <span className="text-xs text-red-500 truncate">{replaceError}</span>}
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
        <button
          type="button"
          className="btn-secondary !h-7 !px-2.5 !text-xs"
          onClick={() => void downloadFile(file)}
        >
          <Download size={13} /> 下载
        </button>
        <button
          type="button"
          className="btn-secondary !h-7 !px-2.5 !text-xs"
          onClick={() => void copyRef()}
          title={markdownRef(file)}
        >
          {copied ? <Check size={13} className="text-emerald-500" /> : <Link2 size={13} />}
          {copied ? '已复制' : '复制引用'}
        </button>
        {canReplace && (
          <button
            type="button"
            className="btn-secondary !h-7 !px-2.5 !text-xs disabled:opacity-60"
            onClick={pickReplace}
            disabled={replacing}
          >
            {replacing ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
            替换上传
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleReplace(e.target.files?.[0])}
        />
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center p-6 gap-3">
        {loading && <div className="text-sm text-neutral-400">正在加载图片…</div>}
        {error && (
          <div className="text-center">
            <AlertTriangle size={32} className="mx-auto mb-2 text-amber-500" />
            <p className="text-sm text-neutral-600">{error}</p>
          </div>
        )}
        {!loading && !error && url && svg && (
          <>
            <iframe
              title={file.path}
              src={url}
              sandbox=""
              className="w-full flex-1 min-h-[60vh] max-w-5xl rounded-lg border"
              style={{ borderColor: 'var(--border-soft)', background: '#fff' }}
            />
            <p className="text-[11px] text-neutral-400">SVG 以沙箱模式渲染，其中的脚本被禁止执行</p>
          </>
        )}
        {!loading && !error && url && !svg && (
          <>
            <a
              href={file.rawUrl ?? url}
              target="_blank"
              rel="noreferrer"
              title="在新窗口打开原图"
              className="flex-1 min-h-0 w-full flex items-center justify-center"
            >
              <img
                src={url}
                alt={file.title || fileBaseName(file.path)}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
                className="max-w-full object-contain rounded-lg shadow-sm"
                style={{ maxHeight: 'calc(100vh - 220px)' }}
              />
            </a>
            <div className="shrink-0 flex items-center gap-3 text-xs text-neutral-400">
              {dims && (
                <span className="inline-flex items-center gap-1">
                  {dims.w} × {dims.h}
                  <ExternalLink size={11} />
                </span>
              )}
              <span>{humanSize(file.size)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
