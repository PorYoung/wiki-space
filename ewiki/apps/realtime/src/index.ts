import 'dotenv/config';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import postgres from 'postgres';
import { jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import type { IncomingMessage } from 'node:http';
import type { WebSocket as WsSocket } from 'ws';

// ---- 配置（精简：realtime 仅需 DB/鉴权/端口） ----
const PORT = Number(process.env.PORT_REALTIME ?? 3001);
const JWT_SECRET = process.env.JWT_SECRET ?? '';
if (JWT_SECRET.length < 16) {
  console.error('JWT_SECRET missing'); // eslint-disable-line no-console
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL ?? 'postgres://ewiki:ewiki@localhost:5432/ewiki', {
  max: 5,
});

// ---- 事件通道（/ws）：房间订阅 + PG LISTEN/NOTIFY 跨副本广播（SDD 4.4） ----
const rooms = new Map<string, Set<WsSocket>>();

function joinRoom(room: string, ws: WsSocket): void {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room)!.add(ws);
}

function leaveAll(ws: WsSocket): void {
  for (const set of rooms.values()) set.delete(ws);
}

function sendTo(ws: WsSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

void sql.listen('ewiki_events', (raw) => {
  try {
    const msg = JSON.parse(raw) as { payload: { room?: string; event: string } };
    const room = msg.payload.room ?? '';
    const subscribers = rooms.get(room);
    if (!subscribers) return;
    for (const ws of subscribers) sendTo(ws, msg.payload);
  } catch {
    // 忽略非 JSON 通知
  }
});

// ---- 协同通道（/collab）：Yjs 房间（SDD 5.3；持久化快照 TODO → ydoc_snapshots） ----
const ydocs = new Map<string, Y.Doc>();

function getYDoc(room: string): Y.Doc {
  let doc = ydocs.get(room);
  if (!doc) {
    doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0); // messageSync
      syncProtocol.writeUpdate(enc, update);
      const buf = encoding.toUint8Array(enc);
      for (const ws of collabRooms.get(room) ?? []) {
        if (ws !== origin && ws.readyState === WebSocket.OPEN) ws.send(buf);
      }
    });
    ydocs.set(room, doc);
  }
  return doc;
}

const collabRooms = new Map<string, Set<WsSocket>>();

// ---- presence 广播 + ydoc_snapshots 定时持久化（30s，仅房间活跃时） ----
const snapshotTimers = new Map<string, ReturnType<typeof setInterval>>();
// SDD 5.3 协同通道：客户端全离线后 Y.Doc 保留 15min，避免短期频繁进出反复重建
const docIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---- 启动时从 ydoc_snapshots 恢复内存 Y.Doc（SDD 5.3 P4-6 CRDT 改造：冷启动恢复） ----
async function restoreFromSnapshots(): Promise<void> {
  try {
    const rows = await sql<{ document_id: string; state: Buffer }[]>`
      SELECT document_id, state FROM ydoc_snapshots
      WHERE updated_at > now() - interval '7 days'
    `;
    for (const row of rows) {
      const room = `doc:${row.document_id}`;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(row.state));
      ydocs.set(room, doc);
      collabRooms.set(room, new Set()); // 预创建空 Set，首次 join 时直接 add
      // 不启动 snapshot timer，等第一个客户端 join 再启动（避免空闲文档占资源）
    }
    // eslint-disable-next-line no-console
    console.log(`[realtime] restored ${rows.length} docs from ydoc_snapshots`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[realtime] restore failed: ${String(err)}`);
  }
}

function broadcastToOthers(room: string, except: WsSocket, data: object): void {
  for (const ws of collabRooms.get(room) ?? []) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }
}

async function persistSnapshot(room: string, doc: Y.Doc): Promise<void> {
  const docId = room.slice('doc:'.length);
  try {
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const stateVector = Buffer.from(Y.encodeStateVector(doc));
    await sql`
      INSERT INTO ydoc_snapshots (document_id, state, state_vector, updated_at)
      VALUES (${docId}, ${state}, ${stateVector}, now())
      ON CONFLICT (document_id)
      DO UPDATE SET state = EXCLUDED.state, state_vector = EXCLUDED.state_vector, updated_at = now()
    `;
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'snapshot failed', room, err: String(err) }));
  }
}

function startSnapshotTimer(room: string): void {
  if (snapshotTimers.has(room)) return;
  const timer = setInterval(() => {
    const doc = ydocs.get(room);
    if (doc) void persistSnapshot(room, doc);
  }, 30_000);
  snapshotTimers.set(room, timer);
}

// ---- HTTP + WS 升级 ----
const server = createServer((_req: IncomingMessage, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'ewiki-realtime' }));
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const token = url.searchParams.get('accessToken') ?? '';
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET), { algorithms: ['HS256'] }));
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === '/collab' || url.pathname.startsWith('/collab/')) setupCollab(ws, url, payload);
    else setupEvents(ws);
  });
});

function setupEvents(ws: WsSocket): void {
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(String(data)) as { type: string; room?: string };
      if (msg.type === 'subscribe' && msg.room) {
        joinRoom(msg.room, ws);
        sendTo(ws, { event: 'subscribed', room: msg.room });
      }
    } catch {
      // 忽略坏消息
    }
  });
  ws.on('close', () => leaveAll(ws));
}

function setupCollab(ws: WsSocket, url: URL, payload: JWTPayload): void {
  // 支持两种格式：/collab?doc=<id> 或 /collab/<id>（y-websocket 默认格式）
  const pathDocId = url.pathname.split('/').filter(Boolean)[1];
  const docId = pathDocId ?? url.searchParams.get('doc') ?? '';
  if (!docId) {
    ws.close();
    return;
  }
  const room = `doc:${docId}`;
  const userId = payload.sub ?? '';
  const name = typeof payload.name === 'string' ? payload.name : userId;

  const doc = getYDoc(room);
  if (!collabRooms.has(room)) collabRooms.set(room, new Set());
  collabRooms.get(room)!.add(ws);
  // 取消空闲 TTL（SDD 5.3：有人加入就重置 15min 计时）
  const idleTimer = docIdleTimers.get(room);
  if (idleTimer) { clearTimeout(idleTimer); docIdleTimers.delete(room); }
  startSnapshotTimer(room);
  broadcastToOthers(room, ws, { type: 'presence', event: 'join', userId, name, docId });

  // y-websocket 客户端在 onopen 时主动发 SyncStep1，
  // 后端收到后 readSyncMessage 自动回 SyncStep2（全量），无需主动推送。
  // 主动推送合并消息会导致客户端解码 "Unexpected end of array"。
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; cursor?: unknown };
        if (msg.type === 'presence') {
          broadcastToOthers(room, ws, { type: 'presence', userId, cursor: msg.cursor });
        }
      } catch {
        // 忽略坏消息
      }
      return;
    }
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const msgType = decoding.readVarUint(decoder);
    switch (msgType) {
      case 0: {
        // messageSync：合并增量并广播给房间其他客户端（CRDT 保证收敛）
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, 0);
        syncProtocol.readSyncMessage(decoder, reply, doc, ws);
        const replyBytes = encoding.toUint8Array(reply);
        // 原样转发给房间其他客户端（二进制 payload 已包含 msgType=0）
        const syncData = Buffer.from(data);
        for (const peer of collabRooms.get(room) ?? []) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(syncData);
        }
        if (encoding.length(reply) > 1) ws.send(replyBytes);
        break;
      }
      case 1: {
        // messageAwareness：二进制 awareness update 转发到房间其他客户端
        for (const peer of collabRooms.get(room) ?? []) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(Buffer.from(data));
        }
        break;
      }
      default:
        break;
    }
  });
  ws.on('close', () => {
    const set = collabRooms.get(room);
    set?.delete(ws);
    broadcastToOthers(room, ws, { type: 'presence', event: 'leave', userId, docId });
    if (set && set.size === 0) {
      collabRooms.delete(room);
      const timer = snapshotTimers.get(room);
      if (timer) clearInterval(timer);
      snapshotTimers.delete(room);
      // SDD 5.3：客户端全离线后 Y.Doc 保留 15min，避免短期频繁进出反复重建
      if (docIdleTimers.has(room)) clearTimeout(docIdleTimers.get(room)!);
      docIdleTimers.set(room, setTimeout(() => {
        ydocs.delete(room);
        docIdleTimers.delete(room);
      }, 15 * 60 * 1000));
    }
  });
}

// ---- 启动：先从 ydoc_snapshots 恢复，再监听端口（SDD 5.3 P4-6 CRDT 冷启动恢复） ----
void restoreFromSnapshots().then(() => {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`ewiki realtime listening on ${PORT}`);
  });
});

// 优雅退出
const shutdown = async (): Promise<void> => {
  for (const timer of snapshotTimers.values()) clearInterval(timer);
  snapshotTimers.clear();
  for (const timer of docIdleTimers.values()) clearTimeout(timer);
  docIdleTimers.clear();
  await sql.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

void joinRoom;
void sendTo;
