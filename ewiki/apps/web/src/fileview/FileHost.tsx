// ---------------------------------------------------------------------------
// 文件宿主（§4.4 / §6.1）：按 viewerId 分发到插件查看器。
// 公共头部（面包屑/评论/历史/信息面板）由宿主按 capabilities 统一编排，
// 查看器只管内容区。
//
// P4-6 CRDT 协同：文件宿主统一挂 <CollabProvider docId={file.id}>，
//   文本类插件（CodeViewer/MarkdownViewer）通过 useCollab() 消费；
//   二进制类插件（Image/PDF/Fallback）不 useCollab → Provider 空跑，零成本。
// ---------------------------------------------------------------------------

import { CollabProvider } from '../lib/collab';
import type { FileViewerProps } from './types';
import { resolveViewer } from './registry';

export default function FileHost(props: FileViewerProps): React.ReactElement {
  const plugin = resolveViewer(props.file);
  const Viewer = plugin.component;
  // P4-6：file.id 作为协同房间名 doc:<docId>（realtime 端约定）
  return (
    <CollabProvider docId={props.file.id} kind={props.file.kind}>
      <Viewer {...props} />
    </CollabProvider>
  );
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
