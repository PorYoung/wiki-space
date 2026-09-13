// ---------------------------------------------------------------------------
// P4-6 CRDT 协同：基于 y-websocket 官方 WebsocketProvider
//   - 自动处理连接/重连/sync/awareness 广播（生产级，避免手写 provider bug）
//   - 用户列表从 awareness states 提取（每个客户端在 local state 设 user 字段）
//   - 保留 onStatus / onPeers / onSynced 回调接口
// ---------------------------------------------------------------------------

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import { tokenStore } from '../api/client';

/** 远端协作者元数据（从 awareness states 提取） */
export interface Peer {
  userId: string;
  name: string;
  color?: string;
  cursor?: { line: number; ch: number } | null;
  joinedAt: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface YDocCallbacks {
  onStatus?(state: ConnectionState): void;
  onPeers?(peers: Map<string, Peer>): void;
  onSynced?(): void;
}

const PEER_PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899'];

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PEER_PALETTE[Math.abs(h) % PEER_PALETTE.length]!;
}

export class CollabYDoc {
  readonly doc: Y.Doc;
  readonly ytext: Y.Text;
  readonly awareness: awarenessProtocol.Awareness;
  readonly undoManager: Y.UndoManager;

  private provider: WebsocketProvider | null = null;
  private synced = false;
  private peers = new Map<string, Peer>();
  private readonly myUserId: string | null;
  private readonly myName: string;

  constructor(
    public readonly docId: string,
    private readonly callbacks: YDocCallbacks = {},
    localUser?: { userId: string; name: string },
  ) {
    this.myUserId = localUser?.userId ?? null;
    this.myName = localUser?.name ?? '匿名';
    this.doc = new Y.Doc();
    this.ytext = this.doc.getText('content');
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.undoManager = new Y.UndoManager(this.ytext);

    // 设本地 user state（y-codemirror.next 读这个显示远程光标名 + 颜色）
    if (localUser) {
      this.awareness.setLocalStateField('user', {
        name: localUser.name,
        id: localUser.userId,
        color: hashColor(localUser.userId),
      });
    }

    // awareness 变化 → 重建 peer 列表
    this.awareness.on('update', () => this.updatePeersFromAwareness());
  }

  // -------------------------------------------------------------------------
  // 连接生命周期
  // -------------------------------------------------------------------------

  connect(): void {
    if (this.provider) return;
    const token = tokenStore.access ?? '';
    // y-websocket URL 格式: serverUrl/roomname?params
    // → /collab/<docId>?accessToken=<token>
    this.provider = new WebsocketProvider('/collab', this.docId, this.doc, {
      awareness: this.awareness,
      params: { accessToken: token },
      connect: true,
      disableBc: false, // 同浏览器多 tab 走 BroadcastChannel（离线也能跨 tab 同步）
    });

    this.provider.on('status', ({ status }: { status: ConnectionState }) => {
      this.callbacks.onStatus?.(status);
    });

    this.provider.on('sync', (isSynced: boolean) => {
      if (isSynced && !this.synced) {
        this.synced = true;
        this.callbacks.onSynced?.();
      }
    });
  }

  disconnect(): void {
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this.callbacks.onStatus?.('disconnected');
  }

  destroy(): void {
    this.disconnect();
    this.awareness.destroy();
    this.doc.destroy();
  }

  // -------------------------------------------------------------------------
  // Peers：从 awareness states 提取（权威源）
  // -------------------------------------------------------------------------

  private updatePeersFromAwareness(): void {
    const states = this.awareness.getStates();
    const next = new Map<string, Peer>();

    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) continue; // 跳过自己
      const user = state.user as { name?: string; id?: string; color?: string } | undefined;
      const userId = user?.id;
      if (!userId) continue;
      // 同 userId 多 tab → 取第一个（颜色按 userId 稳定）
      if (!next.has(userId)) {
        next.set(userId, {
          userId,
          name: user.name ?? userId,
          color: user.color ?? hashColor(userId),
          cursor: (state.cursor as Peer['cursor']) ?? null,
          joinedAt: Date.now(),
        });
      }
    }

    this.peers = next;
    this.callbacks.onPeers?.(new Map(this.peers));
  }

  sendCursor(cursor: Peer['cursor']): void {
    this.awareness.setLocalStateField('cursor', cursor);
  }

  getPeers(): Map<string, Peer> {
    return new Map(this.peers);
  }

  isSynced(): boolean {
    return this.synced;
  }

  /** 本地用户名（底部状态栏显示"我"用） */
  get localName(): string {
    return this.myName;
  }

  /** 本地用户 ID */
  get localUserId(): string | null {
    return this.myUserId;
  }
}
