// ---------------------------------------------------------------------------
// PDF 查看器（§4.4 F7）：
//   sandbox iframe 指向签名 rawUrl（免 Authorization；§5.4），
//   浏览器内置 PDF 渲染。rawUrl 缺失时不回退带 token 的 blob
//   （无签名地址说明服务端未下发，直接给出无访问地址提示与下载入口）。
// ---------------------------------------------------------------------------

import { Download, FileCog, FileWarning, History } from 'lucide-react';
import type { FileViewerProps } from '../types';
import { downloadFile } from '../api';

export function PdfViewer({ file, host }: FileViewerProps): React.ReactElement {
  return (
    <div className="h-full min-h-0 flex flex-col" style={{ background: 'var(--bg-surface)' }}>
      <div
        className="shrink-0 h-11 px-4 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-page)' }}
      >
        <span className="text-xs font-mono text-neutral-400 truncate">{file.path}</span>
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
        <button
          type="button"
          className="btn-secondary !h-7 !px-2.5 !text-xs"
          onClick={() => void downloadFile(file)}
        >
          <Download size={13} /> 下载
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {file.rawUrl ? (
          <iframe
            title={file.path}
            src={file.rawUrl}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-neutral-100"
            style={{ minHeight: '70vh', height: 'calc(100vh - 160px)' }}
          />
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <div className="text-center">
              <FileWarning size={36} className="mx-auto mb-3 text-amber-500" />
              <p className="text-sm text-neutral-700 mb-1">无访问地址</p>
              <p className="text-xs text-neutral-400 mb-4">
                该文件未下发可用于内嵌预览的签名地址，请下载后查看
              </p>
              <button
                type="button"
                className="btn-primary !h-8 !px-3 !text-xs"
                onClick={() => void downloadFile(file)}
              >
                <Download size={13} /> 下载文件
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
