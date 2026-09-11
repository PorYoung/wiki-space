import type { WsEventName } from '@ewiki/shared';

// WS 客户端（FRONTEND.md 5.2/8.2）：房间订阅 + 事件回调 + 断线重连
type Handler = (payload: unknown) => void;

export class EwikiRealtime {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private rooms = new Set<string>();
  private retry = 0;
  private closedByUser = false;

  constructor(private readonly statusCallback?: (connected: boolean) => void) {}

  connect(): void {
    this.closedByUser = false;
    const token = localStorage.getItem('ewiki-token') ?? '';
    const ws = new WebSocket(`/ws?accessToken=${encodeURIComponent(token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.statusCallback?.(true);
      for (const room of this.rooms) this.send({ type: 'subscribe', room });
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { event?: WsEventName; payload?: unknown };
        if (!msg.event) return;
        for (const h of this.handlers.get(msg.event) ?? []) h(msg.payload);
      } catch {
        // 忽略坏消息
      }
    };
    ws.onclose = () => {
      this.statusCallback?.(false);
      if (!this.closedByUser && this.retry < 10) {
        setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 30_000));
      }
    };
  }

  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  subscribe(room: string): void {
    this.rooms.add(room);
    this.send({ type: 'subscribe', room });
  }

  on(event: WsEventName, handler: Handler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }
}
