// API 客户端（FRONTEND.md 第 6 章）：信封错误、401→refresh→重放一次、幂等键助手

export class EwikiApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'ewiki-token';
const REFRESH_KEY = 'ewiki-refresh';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** 从 JWT access token 解出 { sub, name? } — 仅取 payload 部分，不验签 */
export function decodeAccessToken(token?: string | null): { sub: string; name?: string } | null {
  const t = token ?? tokenStore.access;
  if (!t) return null;
  try {
    const parts = t.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 → atob → JSON
    const padded = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const name = typeof payload.name === 'string' ? payload.name : undefined;
    if (!sub) return null;
    return { sub, name };
  } catch {
    return null;
  }
}

async function refreshTokens(): Promise<boolean> {
  const refresh = tokenStore.refresh;
  if (!refresh) return false;
  const res = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  if (!res.ok) {
    tokenStore.clear();
    return false;
  }
  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  tokenStore.set(data.accessToken, data.refreshToken);
  return true;
}

// ---------------------------------------------------------------------------
// 登录失效提醒：refresh 也失败（token 过期/被吊销/服务端重启换密）时，
// 弹窗询问是否跳转登录页。不跳转则停留在当前页（后续请求仍会失败）。
//
// 防弹窗轰炸：
//   - 并发去重：confirm 是同步阻塞的，标志位兜住同一 tick 内的并发 401
//   - 用户取消后 30s 内静默（页面上的请求可能批量失败，不能每个都弹一次）
//   - 已在 /login 时不弹（登录接口本身的 401 是凭据错误，不是会话失效）
// ---------------------------------------------------------------------------
const SESSION_EXPIRED_SNOOZE_MS = 30_000;
let sessionExpiredPrompting = false;
let sessionExpiredDismissedAt = 0;

function promptSessionExpired(): void {
  if (sessionExpiredPrompting) return;
  if (window.location.pathname === '/login') return;
  if (Date.now() - sessionExpiredDismissedAt < SESSION_EXPIRED_SNOOZE_MS) return;
  sessionExpiredPrompting = true;
  try {
    const go = window.confirm('登录已失效，是否跳转登录页面？');
    if (go) {
      tokenStore.clear();
      // 整页跳转：清掉所有 React Query 缓存与组件状态，登录后从干净状态重建
      window.location.assign('/login');
    } else {
      sessionExpiredDismissedAt = Date.now();
    }
  } finally {
    sessionExpiredPrompting = false;
  }
}

// ---------------------------------------------------------------------------
// 私有：带 token + 401 刷新重放的 fetch 执行器（SDD 4.1 / §6.3）
//   autoJsonContentType = true  → body 存在且未指定 Content-Type 时自动 application/json
//   autoJsonContentType = false → 完全不碰 Content-Type（FormData 让浏览器补 multipart boundary）
// ---------------------------------------------------------------------------
async function executeFetch(
  path: string,
  body: BodyInit | undefined,
  init: RequestInit | undefined,
  autoJsonContentType: boolean,
): Promise<Response> {
  const doFetch = (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const token = tokenStore.access;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (autoJsonContentType && body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(path, { ...init, body, headers });
  };
  let res = await doFetch();
  if (res.status === 401 && (await refreshTokens())) {
    res = await doFetch(); // 重放一次（SDD 4.1）
  }
  return res;
}

/** 解析非 2xx 响应体，抛出 EwikiApiError（SDD 4.1 错误信封） */
async function parseErrorAndThrow(res: Response): Promise<never> {
  if (res.status === 401) promptSessionExpired();
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
  throw new EwikiApiError(
    body.code ?? 'HTTP_ERROR',
    body.message ?? `HTTP ${res.status}`,
    res.status,
    body.details,
    body.requestId,
  );
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await executeFetch(path, init?.body ?? undefined, init, true);
  if (!res.ok) await parseErrorAndThrow(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * FormData / 原生 fetch 上传 helper（§4.3 / §6.3）：
 *  - 不强制设 Content-Type，浏览器自动补 multipart/form-data boundary
 *  - 带 token + 401 刷新重放 + 错误信封，与 apiFetch 能力对称
 *  - 返回值与 apiFetch 一致：204 → undefined，其余解析 JSON
 *
 * 注意：XHR 场景（需要 upload.onprogress 进度事件）仍应直接用 XMLHttpRequest，
 * 见 upload-api.ts 的 uploadFileXhr；此 helper 仅覆盖 fetch + FormData 的便利调用。
 */
export async function apiFetchForm<T = unknown>(
  path: string,
  body: BodyInit,
  init?: Omit<RequestInit, 'body'>,
): Promise<T> {
  const res = await executeFetch(path, body, init, false);
  if (!res.ok) await parseErrorAndThrow(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 任务型接口幂等键（SDD 4.1）：同语义重试复用 */
export function idempotencyKey(): Record<string, string> {
  return { 'Idempotency-Key': crypto.randomUUID() };
}

/** 文档全局列表分页响应（GET /api/v1/documents，服务端真分页） */
interface DocumentsPageResp<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * 循环拉取全量文档（对齐「拉全量→前端过滤」架构）：
 * 服务端分页上限 pageSize=500，超过时按 total 逐页取齐；单页失败即抛错。
 */
export async function fetchAllDocuments<T>(pageSize = 500): Promise<T[]> {
  const first = await apiFetch<DocumentsPageResp<T>>(`/api/v1/documents?page=1&pageSize=${pageSize}`);
  const total = Number(first.total ?? first.items.length);
  const items: T[] = [...first.items];
  const pages = Math.ceil(total / pageSize);
  for (let p = 2; p <= pages; p++) {
    const next = await apiFetch<DocumentsPageResp<T>>(`/api/v1/documents?page=${p}&pageSize=${pageSize}`);
    items.push(...next.items);
  }
  return items;
}

/**
 * 轻量下载触发（§6.3）：
 *  - 有 filename 时用 a[href, download=filename]，浏览器弹出另存为并带建议名
 *  - 无 filename 时直接 location.href，交由浏览器按响应头决定（如 Content-Disposition）
 *  - 签名 URL（rawUrl）、普通 /raw 直链均可，不附加鉴权
 *
 * 注：需要带 Bearer token 拉 blob 再触发下载的场景（如历史版本无签名地址），
 * 见 fileview/api.ts 的 downloadFile；本函数只负责"手头已有 URL 字符串"的快速触发。
 */
export function downloadUrl(url: string, filename?: string): void {
  if (filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.location.href = url;
  }
}
