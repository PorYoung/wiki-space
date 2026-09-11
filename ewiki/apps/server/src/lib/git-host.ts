// ---------------------------------------------------------------------------
// Git 托管服务连接器（需求 6/7）：GitLab 为第一方言（接口按 GitLab REST v4 实现），
// Gitea 为兼容演示方言（本地测试环境提供）。两类实例共用同一条
// 「连接验证 → 查找仓库 → 缺失自动初始化 → token 内嵌克隆/推送」管线。
// ---------------------------------------------------------------------------

import { decryptJson } from '@ewiki/db';

export interface ConnLike {
  kind: string; // gitlab | gitea
  baseUrl: string;
  tokenEncrypted: string;
  defaultNamespace?: string | null;
}

export interface HostRepo {
  fullPath: string; // namespace/repo 或 owner/repo
  cloneUrl: string; // 不含凭据的 http(s) 地址
  defaultBranch: string;
  webUrl: string;
}

export class GitHostError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function connToken(conn: ConnLike): string {
  try {
    return decryptJson<{ token?: string }>(conn.tokenEncrypted).token ?? '';
  } catch {
    throw new GitHostError(500, 'SECRET_DECRYPT_FAILED', '连接凭据解密失败（ENCRYPTION_KEY 不一致）');
  }
}

function apiBase(conn: ConnLike): string {
  const base = conn.baseUrl.replace(/\/+$/, '');
  return conn.kind === 'gitea' ? `${base}/api/v1` : `${base}/api/v4`;
}

async function hostReq(
  conn: ConnLike,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const token = connToken(conn);
  let res: Response;
  try {
    res = await fetch(`${apiBase(conn)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new GitHostError(502, 'HOST_UNREACHABLE', `无法连接到 Git 服务（${apiBase(conn)}），请检查地址与网络`);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function mapHttpError(status: number, kind: string): GitHostError {
  if (status === 401 || status === 403) {
    return new GitHostError(400, 'BAD_CREDENTIAL', '访问令牌无效或权限不足（401/403），请检查 Token');
  }
  if (status === 404) return new GitHostError(404, 'HOST_NOT_FOUND', 'Git 服务或接口不存在（404），请检查服务地址');
  if (status === 429) return new GitHostError(429, 'RATE_LIMIT', 'Git 服务限流，请稍后重试');
  return new GitHostError(502, 'HOST_ERROR', `Git 服务返回 ${status}，请检查服务状态`);
}

function normBaseUrl(u: string): string {
  return u.replace(/\/+$/, '');
}

/** 连接验证：GET /user */
export async function validateConnection(conn: ConnLike): Promise<{
  ok: boolean;
  login?: string;
  name?: string;
  message?: string;
}> {
  try {
    const { status, json } = await hostReq(conn, 'GET', '/user');
    if (status !== 200 || !json?.username) return { ok: false, message: mapHttpError(status, conn.kind).message };
    return { ok: true, login: String(json.username), name: String(json.name ?? json.username) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 查找仓库：GitLab 按 /projects/{namespace%2Fname}；Gitea 按 /repos/{owner}/{name} */
export async function findRepo(
  conn: ConnLike,
  repoName: string,
  fallbackNamespace: string,
): Promise<{ found: boolean; repo?: HostRepo }> {
  const ns = (conn.defaultNamespace || fallbackNamespace).trim();
  const fullPath = `${ns}/${repoName}`;
  if (conn.kind === 'gitea') {
    const { status, json } = await hostReq(conn, 'GET', `/repos/${ns}/${repoName}`);
    if (status === 200 && json) {
      return {
        found: true,
        repo: {
          fullPath,
          cloneUrl: String(json.clone_url ?? ''),
          defaultBranch: String(json.default_branch ?? 'main'),
          webUrl: String(json.html_url ?? json.clone_url ?? ''),
        },
      };
    }
    if (status === 404) return { found: false };
    throw mapHttpError(status, conn.kind);
  }
  const { status, json } = await hostReq(conn, 'GET', `/projects/${encodeURIComponent(fullPath)}`);
  if (status === 200 && json) {
    return {
      found: true,
      repo: {
        fullPath,
        cloneUrl: String(json.http_url_to_repo ?? `${normBaseUrl(conn.baseUrl)}/${fullPath}.git`),
        defaultBranch: String(json.default_branch ?? 'main'),
        webUrl: String(json.web_url ?? ''),
      },
    };
  }
  if (status === 404) return { found: false };
  throw mapHttpError(status, conn.kind);
}

/** 创建仓库（不存在时自动初始化，需求 7）。返回 created=false 表示已存在并关联。 */
export async function ensureRepo(
  conn: ConnLike,
  repoName: string,
  fallbackNamespace: string,
  opts: { private?: boolean } = {},
): Promise<{ created: boolean; repo: HostRepo }> {
  const existing = await findRepo(conn, repoName, fallbackNamespace);
  if (existing.found && existing.repo) return { created: false, repo: existing.repo };

  const ns = (conn.defaultNamespace || fallbackNamespace).trim();
  const isPrivate = opts.private ?? true;

  if (conn.kind === 'gitea') {
    // Gitea：个人仓库 POST /user/repos；组织仓库 POST /orgs/{org}/repos
    const target = ns === fallbackNamespace ? `/user/repos` : `/orgs/${encodeURIComponent(ns)}/repos`;
    const { status, json } = await hostReq(conn, 'POST', target, {
      name: repoName,
      auto_init: false,
      private: isPrivate,
      default_branch: 'main',
      description: '由 ewiki 知识平台自动初始化',
    });
    if (status === 201 && json) {
      return {
        created: true,
        repo: {
          fullPath: `${ns}/${repoName}`,
          cloneUrl: String(json.clone_url ?? ''),
          defaultBranch: String(json.default_branch ?? 'main'),
          webUrl: String(json.html_url ?? json.clone_url ?? ''),
        },
      };
    }
    if (status === 409 || status === 403 || status === 422) {
      const msg = status === 403 ? '令牌无创建仓库权限，或对目标命名空间无写入权限' : '仓库创建被拒绝（可能已存在同名仓库）';
      throw new GitHostError(status, 'CREATE_DENIED', msg);
    }
    throw mapHttpError(status, conn.kind);
  }

  // GitLab：POST /projects（namespace 为用户名时省略；否则解析 namespace_id）
  const body: Record<string, unknown> = {
    name: repoName,
    path: repoName,
    visibility: isPrivate ? 'private' : 'public',
    description: '由 ewiki 知识平台自动初始化',
  };
  if (ns && ns !== fallbackNamespace) {
    const nsRes = await hostReq(conn, 'GET', `/namespaces?search=${encodeURIComponent(ns)}`);
    const hit = Array.isArray(nsRes.json)
      ? nsRes.json.find((n: any) => n.path === ns || n.name === ns || n.full_path === ns)
      : null;
    if (hit) body.namespace_id = hit.id;
    else throw new GitHostError(400, 'NAMESPACE_NOT_FOUND', `命名空间不存在或不可见：${ns}`);
  }
  const { status, json } = await hostReq(conn, 'POST', '/projects', body);
  if (status === 201 && json) {
    return {
      created: true,
      repo: {
        fullPath: String(json.path_with_namespace ?? `${ns}/${repoName}`),
        cloneUrl: String(json.http_url_to_repo ?? ''),
        defaultBranch: String(json.default_branch ?? 'main'),
        webUrl: String(json.web_url ?? ''),
      },
    };
  }
  const msg = typeof json?.message === 'string' ? json.message : JSON.stringify(json?.message ?? '');
  if (status === 400 && /already been taken|has already/.test(msg)) {
    throw new GitHostError(409, 'REPO_NAME_TAKEN', `仓库名称已被占用：${msg}`);
  }
  if (status === 400 && /namespace/.test(msg)) {
    throw new GitHostError(400, 'NAMESPACE_INVALID', `命名空间无效：${msg}`);
  }
  throw mapHttpError(status, conn.kind);
}

/** 注入凭据的克隆地址（不落库，仅运行期使用） */
export function authenticatedCloneUrl(conn: ConnLike, repo: HostRepo, login: string): string {
  const token = connToken(conn);
  const url = repo.cloneUrl;
  if (url.startsWith('https://')) {
    const user = conn.kind === 'gitlab' ? 'oauth2' : encodeURIComponent(login);
    return url.replace('https://', `https://${user}:${encodeURIComponent(token)}@`);
  }
  if (url.startsWith('http://')) {
    const user = conn.kind === 'gitlab' ? 'oauth2' : encodeURIComponent(login);
    return url.replace('http://', `http://${user}:${encodeURIComponent(token)}@`);
  }
  throw new GitHostError(400, 'UNSUPPORTED_REMOTE', `不支持的仓库地址协议：${url.split(':')[0]}`);
}
