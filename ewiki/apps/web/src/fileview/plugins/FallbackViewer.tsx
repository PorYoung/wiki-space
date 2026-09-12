// 兜底文件信息卡（§4.4 F8）：不支持在线预览的类型。
// 大图标 + basename + mime + 大小 + 更新时间；主操作下载，次操作替换上传。

import { useRef, useState } from 'react';
import { Download, File, FileCog, History, RefreshCw, Upload } from 'lucide-react';
import type { FileViewerProps } from '../types';
import { downloadFile } from '../api';
import { fileBaseName, formatTime, humanSize } from '../util';

export function FallbackViewer({
  file,
  canWrite,
  onReplaced,
  onReplaceUpload,
  host,
}: FileViewerProps): React.ReactElement {
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canReplace = canWrite && !!onReplaceUpload;

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

  const rows: Array<[string, string]> = [
    ['类型', file.mime || '未知类型'],
    ['大小', humanSize(file.size)],
    ['更新时间', formatTime(file.updatedAt)],
  ];
  if (file.ownerName) rows.push(['上传者', file.ownerName]);

  return (
    <div className="h-full min-h-0 flex items-center justify-center p-6" style={{ background: 'var(--bg-surface)' }}>
      <div
        className="w-full max-w-sm rounded-xl border p-8 text-center"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-page)' }}
      >
        <div
          className="mx-auto mb-4 h-16 w-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--bg-surface)' }}
        >
          <File size={34} className="text-neutral-400" />
        </div>
        <h2 className="text-base font-semibold text-neutral-800 break-all mb-1">
          {fileBaseName(file.path)}
        </h2>
        <p className="text-xs text-neutral-400 mb-5">暂不支持在线预览此类型文件</p>

        <dl className="text-left text-xs mb-6 divide-y" style={{ borderColor: 'var(--border-soft)' }}>
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-neutral-400 shrink-0">{label}</dt>
              <dd className="text-neutral-700 truncate font-mono">{value}</dd>
            </div>
          ))}
        </dl>

        {replaceError && <p className="text-xs text-red-500 mb-3">{replaceError}</p>}

        <div className="mb-4 flex items-center justify-center gap-1">
          <button
            type="button"
            className="btn-ghost !h-7 !px-2.5 !text-xs"
            onClick={() => host?.openOpenInfo()}
            title="文件信息"
          >
            <FileCog size={13} /> 信息
          </button>
          <button
            type="button"
            className="btn-ghost !h-7 !px-2.5 !text-xs"
            onClick={() => host?.openHistory()}
            title="历史记录"
          >
            <History size={13} /> 历史
          </button>
        </div>

        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            className="btn-primary !h-8 !px-4 !text-xs"
            onClick={() => void downloadFile(file)}
          >
            <Download size={13} /> 下载
          </button>
          {canReplace && (
            <button
              type="button"
              className="btn-secondary !h-8 !px-3 !text-xs disabled:opacity-60"
              onClick={() => fileInputRef.current?.click()}
              disabled={replacing}
            >
              {replacing ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
              替换上传
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => void handleReplace(e.target.files?.[0])}
          />
        </div>
      </div>
    </div>
  );
}
