// ---------------------------------------------------------------------------
// 查看器插件注册（§6.1）：宿主按 resolveFileType(path, mime).viewerId 选插件，
// 找不到对应插件时由 fallback 兜底。新增类型只需：shared 注册类型 → 写插件 → 登记本数组。
// ---------------------------------------------------------------------------

import { resolveFileType } from '@ewiki/shared';
import type { FileMeta, FileViewerPlugin } from './types';
import { MarkdownViewer } from './plugins/MarkdownViewer';
import { CodeViewer } from './plugins/CodeViewer';
import { ImageViewer } from './plugins/ImageViewer';
import { PdfViewer } from './plugins/PdfViewer';
import { FallbackViewer } from './plugins/FallbackViewer';

export const VIEWER_PLUGINS: readonly FileViewerPlugin[] = [
  {
    id: 'md',
    displayName: 'Markdown 文档',
    accepts: (file) => resolveFileType(file.path, file.mime).viewerId === 'md',
    capabilities: {
      editable: true,
      downloadable: true,
      replaceable: true,
      showToc: true,
      showComments: true,
      showVersions: true,
    },
    component: MarkdownViewer,
  },
  {
    id: 'code',
    displayName: '代码 / 文本',
    accepts: (file) => resolveFileType(file.path, file.mime).viewerId === 'code',
    capabilities: {
      editable: true,
      downloadable: true,
      replaceable: true,
      showToc: false,
      showComments: false,
      showVersions: true,
    },
    component: CodeViewer,
  },
  {
    id: 'image',
    displayName: '图片预览',
    accepts: (file) => resolveFileType(file.path, file.mime).viewerId === 'image',
    capabilities: {
      editable: false,
      downloadable: true,
      replaceable: true,
      showToc: false,
      showComments: false,
      showVersions: true,
    },
    component: ImageViewer,
  },
  {
    id: 'pdf',
    displayName: 'PDF 预览',
    accepts: (file) => resolveFileType(file.path, file.mime).viewerId === 'pdf',
    capabilities: {
      editable: false,
      downloadable: true,
      replaceable: true,
      showToc: false,
      showComments: false,
      showVersions: true,
    },
    component: PdfViewer,
  },
  {
    id: 'fallback',
    displayName: '文件信息卡',
    accepts: () => true,
    capabilities: {
      editable: false,
      downloadable: true,
      replaceable: true,
      showToc: false,
      showComments: false,
      showVersions: true,
    },
    component: FallbackViewer,
  },
];

/** 取文件能力声明（宿主按此隐藏/禁用头部入口，不允许页面自行判断扩展名） */
export function capabilitiesOf(file: FileMeta): FileViewerPlugin['capabilities'] {
  return resolveViewer(file).capabilities;
}

/**
 * 按注册表 viewerId 解析插件；任何异常/未注册 id 一律回落到 fallback，
 * 保证新文件类型不会把宿主打白屏。
 */
export function resolveViewer(file: FileMeta): FileViewerPlugin {
  const { viewerId } = resolveFileType(file.path, file.mime);
  const matched = VIEWER_PLUGINS.find((p) => p.id === viewerId && p.accepts(file));
  if (matched) return matched;
  return VIEWER_PLUGINS.find((p) => p.id === 'fallback')!;
}
