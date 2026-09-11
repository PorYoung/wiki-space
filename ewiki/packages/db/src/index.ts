import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export * from './secretbox.js';
export { schema };

export const DEFAULT_DB_URL = 'postgres://ewiki:ewiki@localhost:5432/ewiki';

/** 每进程调用一次，创建 postgres 连接池与 Drizzle 实例 */
export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_DB_URL): {
  sql: postgres.Sql;
  db: ReturnType<typeof drizzle<typeof schema>>;
} {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
