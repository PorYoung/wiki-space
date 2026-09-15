// ---------------------------------------------------------------------------
// 开放 REST 客户端：工具执行 → /api/open/v1/*（OPEN-API-MCP-DESIGN ADR-O5）
//   stdio 桥（EWIKI_BASE_URL 跨网络）与托管形态（127.0.0.1 自端口回环）共用。
//   非 2xx 统一抛 McpToolError（解析开放面错误信封 {code,message}）。
// ---------------------------------------------------------------------------

import { McpToolError, type McpClient } from './protocol.js';

const OPEN_API_PREFIX = '/api/open/v1';

export interface HttpFetchClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export function createHttpFetchClient(opts: HttpFetchClientOptions): McpClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  return {
    async call(method, path, request) {
      const url = new URL(base + OPEN_API_PREFIX + path);
      if (request?.query) {
        for (const [k, v] of Object.entries(request.query)) {
          if (v !== undefined && v !== '') url.searchParams.set(k, v);
        }
      }
      const init: RequestInit = { method, headers: { Authorization: `Bearer ${opts.token}` } };
      if (request?.body !== undefined) {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' };
        init.body = JSON.stringify(request.body);
      }
      let res: Response;
      try {
        res = await doFetch(url.toString(), init);
      } catch (err) {
        throw new McpToolError(0, 'NETWORK_ERROR', `无法连接知识库服务（${base}）：${err instanceof Error ? err.message : String(err)}`);
      }
      let json: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      if (!res.ok) {
        const body = (json ?? {}) as Record<string, unknown>;
        const code = typeof body.code === 'string' ? body.code : `HTTP_${res.status}`;
        const message = typeof body.message === 'string' ? body.message : res.statusText;
        throw new McpToolError(res.status, code, message);
      }
      return { status: res.status, json };
    },
  };
}
