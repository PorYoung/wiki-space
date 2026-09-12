// ---------------------------------------------------------------------------
// P4-6 CRDT 协同 CollabProvider：React Context 层
//   - 管理每个 docId 一个 CollabYDoc 实例（同一 docId 跨组件重建不丢连接）
//   - 暴露 { ytext, doc, connected, peers, synced, sendCursor } 给消费者
//   - CodeViewer 消费 ytext（y-codemirror.next 绑定）做实时协同编辑
//   - MarkdownViewer 消费 peers + sendCursor（presence 光标广播）
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import type * as awarenessProtocol from 'y-protocols/awareness';
import { CollabYDoc, type ConnectionState, type Peer } from './YDoc';

export interface CollabContextValue {
  /** Yjs 文档 —— 供 y-codemirror.next 绑定 */
  doc: Y.Doc | null;
  /** 主文本 Y.Text subdoc —— CodeMirror 绑定目标 */
  ytext: Y.Text | null;
  /** P4-6 CRDT awareness：供 y-codemirror.next 渲染远程光标 */
  awareness: awarenessProtocol.Awareness | null;
  /** B3: Yjs UndoManager —— 本地操作撤销（仅本地历史） */
  undoManager: Y.UndoManager | null;
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
  /** P4-6：文件类型，binary 不建 ws 连接（懒创建）。缺省 'text' 保持向后兼容 */
  kind?: 'text' | 'binary';
  children: ReactNode;
}

/**
 * 同一 docId 只保留一个 CollabYDoc：避免用户快速切换文件时，
 * 旧 ws 还在收消息却已无组件消费，新组件又重连一次造成连接风暴。
 * React 18 StrictMode 下组件会 mount→unmount→mount，缓存同样能兜底。
 *
 * B4: TTL 淘汰机制 —— 缓存 entry 存 lastAccess，模块级 setInterval 每分钟检查，
 * 10 分钟未被访问的实例 destroy + delete，防止长期运行累积大量 YDoc。
 * cleanup 只 disconnect 不 delete：让同 docId 的 StrictMode remount / 用户切回
 * 同一文件时能复用已有的 Y.Doc 状态，无需从服务器重新 SyncStep2。
 */
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟空闲后淘汰
const CACHE_SWEEP_INTERVAL = 60 * 1000; // 每分钟扫一次

interface CacheEntry {
  instance: CollabYDoc;
  lastAccess: number;
}

const instanceCache = new Map<string, CacheEntry>();

// 模块级 TTL 清理（仅浏览器端执行，SSR 安全）
if (typeof window !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of instanceCache) {
      if (now - entry.lastAccess > CACHE_TTL) {
        entry.instance.destroy();
        instanceCache.delete(id);
      }
    }
  }, CACHE_SWEEP_INTERVAL);
}

export function CollabProvider({ docId, kind = 'text', children }: ProviderProps): React.ReactElement {
  // P4-6：binary 文件（image/pdf/其他二进制）不建 ws 连接——懒创建，零开销
  // Provider 仍然 render（给子组件一个 valid context），但所有 ydoc/ws 操作都跳过
  const shouldCollab = kind === 'text';

  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [synced, setSynced] = useState(false);
  const instanceRef = useRef<CollabYDoc | null>(null);

  useEffect(() => {
    // P4-6 guard：binary 文件不创建 YDoc + ws，直接 return
    if (!shouldCollab) return;

    const prev = instanceRef.current;
    if (prev) {
      prev.disconnect(); // 只断连，保留缓存供 StrictMode remount / 用户切回复用
    }

    // 从缓存取或新建 —— 缓存命中时刷新 lastAccess（延长 TTL）
    let entry = instanceCache.get(docId);
    if (!entry) {
      const instance = new CollabYDoc(docId, {
        onStatus: (s: ConnectionState) => setConnected(s === 'connected'),
        onPeers: (p) => setPeers(p),
        onSynced: () => setSynced(true),
      });
      entry = { instance, lastAccess: Date.now() };
      instanceCache.set(docId, entry);
    } else {
      entry.lastAccess = Date.now();
    }
    const instance = entry.instance;
    instanceRef.current = instance;
    setConnected(false);
    setPeers(instance.getPeers());
    setSynced(instance.isSynced());

    instance.connect();

    return () => {
      instance.disconnect(); // 只断连，不删缓存（TTL 负责销毁）
      instanceRef.current = null;
    };
  }, [docId, shouldCollab]);

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
      awareness: instanceRef.current?.awareness ?? null,
      undoManager: instanceRef.current?.undoManager ?? null,
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
