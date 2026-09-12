// ---------------------------------------------------------------------------
// P4-6 CRDT 协同：单文档 Yjs 连接管理
//   - WebSocket + y-protocols/sync 二进制协议（messageSync=0）
//   - JSON presence 消息：join/leave/cursor
//   - 自动重连（服务器进程重启后客户端恢复）
//   - 提供 Y.Doc + Y.Text subdoc + connected/peers 状态回调
//
// 协议（与 apps/realtime/src/index.ts 严格对齐）：
//   ws URL : /collab?accessToken=<JWT>&doc=<docId>
//   二进制 : lib0-encoded { messageSync(0) | sync message }
//   JSON   : { type: 'presence', event?: 'join'|'leave', userId, name, docId, cursor? }
// 服务器会在客户端连接后先发 SyncStep1；客户端收到任何 update 都会触发
// syncProtocol.readSyncMessage 自动合并到本地 Y.Doc 并广播（服务器侧已做广播）。
// ---------------------------------------------------------------------------

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { tokenStore } from '../api/client';

/** 远端协作者元数据（来自 realtime 服务器的 JSON presence） */
export interface Peer {
  userId: string;
  name: string;
  cursor?: { line: number; ch: number } | null;
  joinedAt: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface YDocCallbacks {
  /** 连接状态变化 */
  onStatus?(state: ConnectionState): void;
  /** peers map 增删改（浅引用替换，消费者直接重建组件） */
  onPeers?(peers: Map<string, Peer>): void;
  /** 收到服务器下发 SyncStep2 全量后触发（仅首次或重连后） */
  onSynced?(): void;
}

export class CollabYDoc {
  readonly doc: Y.Doc;
  readonly ytext: Y.Text;
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private manualClose = false;
  private synced = false;
  private peers = new Map<string, Peer>();

  constructor(
    public readonly docId: string,
    private readonly callbacks: YDocCallbacks = {},
  ) {
    this.doc = new Y.Doc();
    this.ytext = this.doc.getText('content');
  }

  // -------------------------------------------------------------------------
  // 连接生命周期
  // -------------------------------------------------------------------------

  connect(): void {
    this.manualClose = false;
    this.callbacks.onStatus?.('connecting');
    this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearRetry();
    this.ws?.close();
    this.ws = null;
    this.callbacks.onStatus?.('disconnected');
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private openSocket(): void {
    const token = tokenStore.access ?? '';
    // P4-6：dev vite proxy /collab → ws://localhost:3001，prod Caddy /collab → realtime
    const url = `/collab?accessToken=${encodeURIComponent(token)}&doc=${encodeURIComponent(this.docId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.retryCount = 0;
      this.synced = false;
      this.callbacks.onStatus?.('connected');
    };

    ws.onmessage = (ev: MessageEvent) => {
      // P4-6：二进制 = y-protocols/sync；字符串 = JSON presence
      if (typeof ev.data === 'string') {
        this.handlePresence(ev.data);
      } else if (ev.data instanceof ArrayBuffer || ArrayBuffer.isView(ev.data)) {
        const buf = ev.data instanceof ArrayBuffer ? ev.data : (ev.data as ArrayBufferView).buffer;
        this.handleSync(new Uint8Array(buf));
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.callbacks.onStatus?.('disconnected');
      if (!this.manualClose) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose 紧随其后，重连逻辑在 onclose 里统一处理
    };
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    this.clearRetry();
    // 指数退避：1s → 2s → 4s → 8s，上限 30s
    const delay = Math.min(1000 * 2 ** this.retryCount, 30_000);
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openSocket();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // 二进制 sync 处理（y-protocols/sync messageSync=0）
  // -------------------------------------------------------------------------

  private handleSync(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);
    if (msgType !== 0) return; // 只处理 messageSync，awareness(1) 被 realtime 忽略
    // syncProtocol.readSyncMessage 会把远端 update 合并进 this.doc
    // 并把本地缺失的 update 写进 encoder（如果服务器是新节点）
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.readSyncMessage(decoder, enc, this.doc, this);
    // 有数据才回发（SyncStep1 请求时服务器会回 SyncStep2 全量）
    if (encoding.length(enc) > 1 && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encoding.toUint8Array(enc));
    }
    // P4-6：首次收到 SyncStep2（全量）时 synced 变 true，通知消费者
    if (!this.synced) {
      this.synced = true;
      this.callbacks.onSynced?.();
    }
  }

  /**
   * 本地 doc update → 广播给服务器（服务器合并进房间并转发给其他客户端）
   * y-codemirror.next 或手动 observe 时调用。
   */
  sendUpdate(update: Uint8Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // messageSync
    syncProtocol.writeUpdate(enc, update);
    this.ws.send(encoding.toUint8Array(enc));
  }

  // -------------------------------------------------------------------------
  // JSON presence 处理
  // -------------------------------------------------------------------------

  private handlePresence(raw: string): void {
    let msg: { type?: string; event?: string; userId?: string; name?: string; docId?: string; cursor?: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.type !== 'presence' || !msg.userId) return;

    if (msg.event === 'join') {
      this.peers.set(msg.userId, {
        userId: msg.userId,
        name: msg.name ?? msg.userId,
        cursor: null,
        joinedAt: Date.now(),
      });
    } else if (msg.event === 'leave') {
      this.peers.delete(msg.userId);
    } else if (msg.cursor !== undefined) {
      // 仅 cursor 更新
      const existing = this.peers.get(msg.userId);
      if (existing) {
        existing.cursor = (msg.cursor as Peer['cursor']) ?? null;
      }
    }
    // 浅复制，触发 React 重渲染
    this.callbacks.onPeers?.(new Map(this.peers));
  }

  /** MarkdownViewer 用：主动广播本地光标位置 */
  sendCursor(cursor: Peer['cursor']): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({ type: 'presence', cursor }),
    );
  }

  /** 当前 peers 快照（供 CollabProvider 初始化） */
  getPeers(): Map<string, Peer> {
    return new Map(this.peers);
  }

  /** 是否已收到过服务器全量（ytext 可安全消费） */
  isSynced(): boolean {
    return this.synced;
  }
}
