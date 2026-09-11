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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const token = tokenStore.access;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(path, { ...init, headers });
  };

  let res = await doFetch();
  if (res.status === 401 && (await refreshTokens())) {
    res = await doFetch(); // 重放一次（SDD 4.1）
  }
  if (!res.ok) {
    // refresh 失败后的最终 401 = 会话已失效，主动提醒用户（而非各页面静默报错）
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 任务型接口幂等键（SDD 4.1）：同语义重试复用 */
export function idempotencyKey(): Record<string, string> {
  return { 'Idempotency-Key': crypto.randomUUID() };
}
