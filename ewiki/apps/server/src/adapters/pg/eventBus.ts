import type { EventBus, EventChannel } from '@ewiki/shared';
import type postgres from 'postgres';

const CHANNEL = 'ewiki_events';

/**
 * PG LISTEN/NOTIFY 跨副本广播（SDD 4.4；ADR-8 Phase 1 淘汰 Redis 的关键）。
 * 注意 NOTIFY payload 上限 8000 字节，大 payload 应只广播事件引用。
 */
export class PgEventBus implements EventBus {
  private handlers = new Map<EventChannel, Array<(payload: unknown) => void>>();
  private listening = false;

  constructor(private readonly sql: postgres.Sql) {}

  async publish(channel: EventChannel, payload: unknown): Promise<void> {
    await this.sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ channel, payload })})`;
  }

  async subscribe(channel: EventChannel, handler: (payload: unknown) => void): Promise<void> {
    if (!this.handlers.has(channel)) this.handlers.set(channel, []);
    this.handlers.get(channel)!.push(handler);
    if (!this.listening) {
      this.listening = true;
      await this.sql.listen(CHANNEL, (raw) => {
        try {
          const msg = JSON.parse(raw) as { channel: EventChannel; payload: unknown };
          for (const h of this.handlers.get(msg.channel) ?? []) h(msg.payload);
        } catch {
          // 非 JSON 通知（如 pg-boss 内部 NOTIFY）忽略
        }
      });
    }
  }
}
