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
import * as awarenessProtocol from 'y-protocols/awareness';
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
  /** P4-6 CRDT awareness：远程光标/ presence 二进制协议 */
  readonly awareness: awarenessProtocol.Awareness;
  /** P4-6 B3: Yjs UndoManager —— 本地操作撤销历史（仅本地，不含远程） */
  readonly undoManager: Y.UndoManager;
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private manualClose = false;
  private synced = false;
  private peers = new Map<string, Peer>();

  /** B3: 150ms 内连续 update 合并成一次 ws.send，降低服务器压力 */
  private static readonly FLUSH_INTERVAL = 150;
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly docId: string,
    private readonly callbacks: YDocCallbacks = {},
    /** P4-6：可选本地用户信息，用于 awareness 本地 state */
    localUser?: { userId: string; name: string },
  ) {
    this.doc = new Y.Doc();
    this.ytext = this.doc.getText('content');
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // P4-6：设本地 user state（y-codemirror.next 会读取显示远程光标名 + 颜色）
    if (localUser) {
      const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
      const PALETTE = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899'];
      const color = PALETTE[hash(localUser.userId) % PALETTE.length]!;
      this.awareness.setLocalStateField('user', { name: localUser.name, id: localUser.userId, color });
    }
    this.awareness.on('update', this.handleAwarenessUpdate.bind(this));
    // B3: UndoManager 绑定 ytext —— 撤销历史仅含本地操作（undoManager 不跟踪远程更新）
    this.undoManager = new Y.UndoManager(this.ytext);

    // ⚠️ P4-6 关键：本地 doc update → 广播给服务器
    // y-codemirror.next 只负责 CM6 ↔ Y.Text 双向同步，不会自动把 Y.Doc update 发到服务器
    // 服务器侧 syncProtocol.readSyncMessage 传 origin=this（见 handleSync），
    // 所以 origin === this 的 update 是我们接收的远程更新 → 跳过，避免回显
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this.sendUpdate(update);
    });
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
    // B3: flush 剩余 batching 中的更新（断开前尽量让服务器收到最新状态）
    this.flushPending();
    this.ws?.close();
    this.ws = null;
    // P4-6：销毁 awareness（会触发本地 state 移除，其他客户端收到后知道我们下线了）
    this.awareness.destroy();
    this.callbacks.onStatus?.('disconnected');
  }

  /**
   * 完全销毁：disconnect + Y.Doc.destroy()。
   * TTL 缓存淘汰时调用（不仅断连接，还要释放 Y.Doc 的内存）。
   */
  destroy(): void {
    this.disconnect();
    this.doc.destroy();
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
    switch (msgType) {
      case 0: {
        // messageSync：合并远端增量并回发本地缺失部分
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
        break;
      }
      case 1: {
        // P4-6 CRDT awareness：服务器转发的 awareness update
        // applyAwarenessUpdate 需要完整的 awareness body Uint8Array（不包含 msgType 前缀）
        // 先重新读一遍 msgType 拿到它占用的字节数，再 slice 出 body
        const tmpDec = decoding.createDecoder(data);
        decoding.readVarUint(tmpDec); // 跳过 msgType，tmpDec.pos 就是 body 起始偏移
        const body = data.slice(tmpDec.pos);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, body, this);
        break;
      }
      default:
        break;
    }
  }

  /**
   * 本地 doc update → 广播给服务器（服务器合并进房间并转发给其他客户端）。
   * B3: 150ms debounce batching —— 连续 update 合并成一次发送，降低 ws 消息频率。
   * y-codemirror.next 在用户打字时每个按键都触发一次 update，不合并的话每秒发 20-50 条。
   */
  sendUpdate(update: Uint8Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.pendingUpdates.push(update);
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flushPending(), CollabYDoc.FLUSH_INTERVAL);
  }

  /** 立即发送所有 pending updates（batching flush） */
  private flushPending(): void {
    this.flushTimer = null;
    const updates = this.pendingUpdates;
    this.pendingUpdates = [];
    if (updates.length === 0 || this.ws?.readyState !== WebSocket.OPEN) return;
    // 单条 update 直接发；多条用 Y.mergeUpdates 合并（CRDT 语义安全，等价于一次性 transact）
    const merged = updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // messageSync
    syncProtocol.writeUpdate(enc, merged);
    this.ws.send(encoding.toUint8Array(enc));
  }

  // -------------------------------------------------------------------------
  // P4-6 CRDT awareness：远程光标二进制协议
  // -------------------------------------------------------------------------

  /**
   * Awareness update 回调
   *   - conn === this.awareness → 本地变化（y-codemirror.next setLocalStateField）→ 广播
   *   - 否则: 远端变化 → 更新 peer 的 cursor/name（不负责 add/remove — 由 JSON presence join/leave 管理）
   */
  private handleAwarenessUpdate(
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    conn: unknown,
  ): void {
    if (conn === this.awareness) {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const changed = added.concat(updated);
      if (changed.length === 0) return;
      const body = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1); // messageAwareness
      encoding.writeUint8Array(enc, body);
      this.ws.send(encoding.toUint8Array(enc));
      return;
    }

    // 远端 awareness 变化: 只更新已有 peer 的 cursor + name
    // ⚠️ 不再负责 add/delete peer — JSON presence join/leave 是单一权威源
    const states = this.awareness.getStates();
    let peersChanged = false;
    for (const clientId of added.concat(updated)) {
      if (clientId === this.awareness.clientID) continue; // 跳过自己
      const state = states.get(clientId) as { user?: { name: string; id: string; color?: string }; cursor?: unknown } | undefined;
      const userId = state?.user?.id;
      if (!userId) continue;
      // 只更新已有 peer 的 cursor + name（新 peer 必须由 JSON presence join 创建）
      const existing = this.peers.get(userId);
      if (existing) {
        if (state?.cursor !== undefined) existing.cursor = (state.cursor as Peer['cursor']) ?? null;
        if (state?.user?.name && existing.name !== state.user.name) {
          existing.name = state.user.name;
        }
        peersChanged = true;
      }
    }

    // removed 清理 —— ⚠️ 注意: peers Map key 是 userId 不是 clientId，所以这里 delete 永远不命中
    // 真正删除靠 JSON presence leave 事件。awareness removed 仅兜底（同 userId 多 tab 不会误删）
    void removed;

    if (peersChanged) {
      this.callbacks.onPeers?.(new Map(this.peers));
    }
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
