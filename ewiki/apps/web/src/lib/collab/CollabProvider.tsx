// ---------------------------------------------------------------------------
// P4-6 CRDT 协同 CollabProvider：React Context 层
//   - 管理每个 docId 一个 CollabYDoc 实例（同一 docId 跨组件重建不丢连接）
//   - 暴露 { ytext, doc, connected, peers, synced, sendCursor } 给消费者
//   - CodeViewer 消费 ytext（y-codemirror.next 绑定）做实时协同编辑
//   - MarkdownViewer 消费 peers + sendCursor（presence 光标广播）
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { CollabYDoc, type ConnectionState, type Peer } from './YDoc';

export interface CollabContextValue {
  /** Yjs 文档 —— 供 y-codemirror.next 绑定 */
  doc: Y.Doc | null;
  /** 主文本 Y.Text subdoc —— CodeMirror 绑定目标 */
  ytext: Y.Text | null;
  /** WebSocket 是否已连到 realtime 服务器 */
  connected: boolean;
  /** 远端协作者 Map（userId → Peer），浅引用每次 peers 变更都会换 */
  peers: Map<string, Peer>;
  /** 是否已收到过服务器 SyncStep2 全量（ytext 有权威内容） */
  synced: boolean;
  /** MarkdownViewer 专用：广播本地光标位置 */
  sendCursor: (cursor: { line: number; ch: number } | null) => void;
}

const CollabContext = createContext<CollabContextValue | null>(null);

interface ProviderProps {
  docId: string;
  children: ReactNode;
}

/**
 * 同一 docId 只保留一个 CollabYDoc：避免用户快速切换文件时，
 * 旧 ws 还在收消息却已无组件消费，新组件又重连一次造成连接风暴。
 * React 18 StrictMode 下组件会 mount→unmount→mount，缓存同样能兜底。
 */
const instanceCache = new Map<string, CollabYDoc>();

export function CollabProvider({ docId, children }: ProviderProps): React.ReactElement {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [synced, setSynced] = useState(false);
  const instanceRef = useRef<CollabYDoc | null>(null);

  useEffect(() => {
    const prev = instanceRef.current;
    if (prev) {
      prev.disconnect();
      instanceCache.delete(prev.docId);
    }

    let instance = instanceCache.get(docId);
    if (!instance) {
      instance = new CollabYDoc(docId, {
        onStatus: (s: ConnectionState) => setConnected(s === 'connected'),
        onPeers: (p) => setPeers(p),
        onSynced: () => setSynced(true),
      });
      instanceCache.set(docId, instance);
    }
    instanceRef.current = instance;
    setConnected(false);
    setPeers(instance.getPeers());
    setSynced(instance.isSynced());

    instance.connect();

    return () => {
      instance.disconnect();
      instanceRef.current = null;
      instanceCache.delete(docId);
    };
  }, [docId]);

  const sendCursor = useCallback(
    (cursor: { line: number; ch: number } | null) => {
      instanceRef.current?.sendCursor(cursor);
    },
    [],
  );

  const value = useMemo<CollabContextValue>(
    () => ({
      doc: instanceRef.current?.doc ?? null,
      ytext: instanceRef.current?.ytext ?? null,
      connected,
      peers,
      synced,
      sendCursor,
    }),
    [connected, peers, synced, sendCursor],
  );

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}

/** 消费协同上下文：必须在 CollabProvider 内 */
export function useCollab(): CollabContextValue {
  const ctx = useContext(CollabContext);
  if (!ctx) {
    throw new Error('useCollab must be used within a <CollabProvider>');
  }
  return ctx;
}
