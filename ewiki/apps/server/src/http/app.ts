import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readFileSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import type PgBoss from 'pg-boss';
import { createDb } from '@ewiki/db';
import type { Config } from '../config.js';
import { registerRoutes } from './routes.js';
import { registerRawRoute } from './routes-files.js';

/** Hono 上下文变量类型扩充（SDD 4.1/4.2） */
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    userId: string;
    globalRole: string;
  }
}

export interface AppDeps {
  config: Config;
  db: ReturnType<typeof createDb>['db'];
  boss: PgBoss;
}

/** Hono 应用工厂：requestId → 错误信封（SDD 4.1）→ 路由挂载 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    await next();
    c.header('X-Request-Id', c.get('requestId'));
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId');
    if (err instanceof HTTPException) {
      if (err.status >= 500) {
        console.error(JSON.stringify({ level: 'error', msg: 'http_5xx', requestId, err: String(err?.stack ?? err) }));
      }
      return c.json(
        { code: 'HTTP_ERROR', message: err.message, requestId },
        err.status,
      );
    }
    console.error(JSON.stringify({
      level: 'error',
      msg: 'unhandled',
      requestId,
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    }));
    return c.json({ code: 'INTERNAL', message: '服务端错误', requestId }, 500);
  });

  app.notFound((c) =>
    c.json({ code: 'NOT_FOUND', message: '资源不存在', requestId: c.get('requestId') }, 404),
  );

  registerRawRoute(app, deps);
  registerRoutes(app, deps);

  // ---- 生产模式静态托管：WEB_DIST 指向前端构建产物（apps/web/dist），SPA 回退 index.html ----
  // 注意：/api/*、/sites/*、/ws、/collab 均在上方路由先行匹配，此处只兜底前端资源。
  if (process.env.WEB_DIST) {
    const webRoot = process.env.WEB_DIST.replace(/\\/g, '/');
    app.use('*', serveStatic({ root: webRoot }));
    let indexCache: Buffer | null = null;
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) return c.notFound();
      if (!indexCache) {
        try {
          indexCache = readFileSync(`${process.cwd()}/${webRoot}/index.html`);
        } catch {
          indexCache = Buffer.from('<!doctype html><meta charset="utf-8">前端构建产物缺失：请先执行 pnpm --filter @ewiki/web build', 'utf8');
        }
      }
      return new Response(new Uint8Array(indexCache), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });
  }

  return app;
}
