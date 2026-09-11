import type { LockService } from '@ewiki/shared';
import type postgres from 'postgres';

/** PG advisory lock 适配器：源级互斥（同一源不并发同步，SDD 5.1） */
export class PgLockService implements LockService {
  constructor(private readonly sql: postgres.Sql) {}

  /** djb2 → 31 位整数，适配 pg_advisory_lock(int) */
  private hashKey(key: string): number {
    let h = 5381;
    for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.sql.reserve();
    const lockId = this.hashKey(key);
    try {
      await client`select pg_advisory_lock(${lockId})`;
      return await fn();
    } finally {
      await client`select pg_advisory_unlock(${lockId})`;
      client.release();
    }
  }
}
