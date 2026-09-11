import 'dotenv/config';
import { serve } from '@hono/node-server';
import PgBoss from 'pg-boss';
import { loadConfig } from './config.js';
import { sql, db } from './db/client.js';
import { createApp } from './http/app.js';
import { PgJobQueue } from './adapters/pg/jobQueue.js';

const config = loadConfig();
const log = {
  info: (msg: string, extra?: object) => console.log(JSON.stringify({ level: 'info', msg, ...extra })),
  error: (msg: string, extra?: object) => console.error(JSON.stringify({ level: 'error', msg, ...extra })),
};

async function main(): Promise<void> {
  const boss = new PgBoss({ connectionString: config.DATABASE_URL });
  boss.on('error', (e) => log.error('pg-boss error', { err: String(e) }));
  await boss.start();

  const app = createApp({ config, db, boss });
  void new PgJobQueue(boss); // Worker 进程消费；server 侧仅入队（ADR-1）

  serve({ fetch: app.fetch, port: config.PORT_SERVER }, (info) => {
    log.info('server started', { port: info.port, requestId: 'boot' });
  });

  const shutdown = async (): Promise<void> => {
    await boss.stop();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  log.error('fatal', { err: String(err) });
  process.exit(1);
});
