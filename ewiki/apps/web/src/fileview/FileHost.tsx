// ---------------------------------------------------------------------------
// 文件宿主（§4.4 / §6.1）：按 viewerId 分发到插件查看器。
// 本期为最小宿主：只负责解析插件并渲染；公共头部（面包屑/评论/历史/信息面板）
// 未来由宿主按 capabilities 统一编排，查看器只管内容区。
// ---------------------------------------------------------------------------

import type { FileViewerProps } from './types';
import { resolveViewer } from './registry';

export default function FileHost(props: FileViewerProps): React.ReactElement {
  const plugin = resolveViewer(props.file);
  const Viewer = plugin.component;
  return <Viewer {...props} />;
}

export { VIEWER_PLUGINS, resolveViewer, capabilitiesOf } from './registry';
export type {
  FileMeta,
  FileViewerProps,
  FileViewerPlugin,
  FileViewerCapabilities,
  FileViewerHost,
} from './types';
export { downloadFile, fetchRawBlob, useObjectUrl } from './api';
export { humanSize, fileBaseName, formatTime } from './util';
