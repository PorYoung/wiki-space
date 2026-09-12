// ---------------------------------------------------------------------------
// 文件查看器插件契约（file-management-redesign §6.1）
// 本模块自包含：不依赖 src/pages/BrowsePage.tsx，宿主接入时把后端
// DocumentDetail 适配成 FileMeta 即可。
// ---------------------------------------------------------------------------

import type { ComponentType } from 'react';

/** 文件元数据（宿主从后端文档详情适配而来；字段对齐 §5.2 详情接口） */
export interface FileMeta {
  id: string;
  /** 库内真实路径，含扩展名（如 design/登录流程-v2.png） */
  path: string;
  /** 显示标题（二进制缺省取无扩展名 basename） */
  title: string;
  kind: 'text' | 'binary';
  /** 小写扩展名，不含点；无扩展名为空串 */
  ext: string;
  mime: string;
  /** 字节数 */
  size: number;
  /** 二进制当前版本的内容寻址引用（文本类为 null/undefined） */
  storageRef?: string | null;
  /** 文本类内联正文；二进制不内联 */
  content?: string | null;
  versionNo?: number | null;
  /** raw 短期签名地址（img/iframe 直接使用；§5.4） */
  rawUrl?: string | null;
  updatedAt?: string | null;
  ownerName?: string | null;
}

/** 宿主向查看器开放的公共操作入口（公共头部/面板由宿主编排） */
export interface FileViewerHost {
  openOpenInfo(): void;
  openHistory(): void;
}

export interface FileViewerProps {
  file: FileMeta;
  canWrite: boolean;
  isDark: boolean;
  /** 文本类保存（PUT 乐观并发由宿主实现）；二进制无此能力 */
  onSave?(content: string): Promise<void>;
  /** 替换上传完成后回调，宿主应重新拉取文件详情 */
  onReplaced(): void;
  /** 替换上传实现由宿主提供（multipart POST）；未提供则隐藏替换入口 */
  onReplaceUpload?(file: File): Promise<void>;
  host: FileViewerHost;
}

export interface FileViewerCapabilities {
  /** 是否支持在线编辑内容（md/code 文本类） */
  editable: boolean;
  downloadable: boolean;
  /** 是否支持替换上传 */
  replaceable: boolean;
  /** 是否展示 TOC（仅 Markdown） */
  showToc: boolean;
  /** 是否展示评论入口（仅 Markdown） */
  showComments: boolean;
  /** 是否展示版本历史入口 */
  showVersions: boolean;
}

export interface FileViewerPlugin {
  id: 'md' | 'code' | 'image' | 'pdf' | 'fallback';
  displayName: string;
  accepts(file: FileMeta): boolean;
  capabilities: FileViewerCapabilities;
  component: ComponentType<FileViewerProps>;
}
