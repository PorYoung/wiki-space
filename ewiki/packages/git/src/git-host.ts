// ---------------------------------------------------------------------------
// Git 托管服务连接器：GitLab 为第一方言（接口按 GitLab REST v4 实现），
// Gitea 为兼容演示方言（本地测试环境提供）。两类实例共用同一条
// 「连接验证 → 查找仓库 → 缺失自动初始化 → token 内嵌克隆/推送」管线。
// 本包由 server（建库/保存推送）与 worker（同步消化）共用，不归属任一 app。
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
): Promise<{ status: number; json: unknown }> {
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
  } catch {
    throw new GitHostError(502, 'HOST_UNREACHABLE', `无法连接到 Git 服务（${apiBase(conn)}），请检查地址与网络`);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** 托管平台 REST 响应统一按松散字典读取（字段随方言/版本不同） */
function asRecord(json: unknown): Record<string, unknown> | null {
  return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
}

function mapHttpError(status: number, _kind: string): GitHostError {
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
    const rec = asRecord(json);
    if (status !== 200 || !rec?.username) return { ok: false, message: mapHttpError(status, conn.kind).message };
    return { ok: true, login: String(rec.username), name: String(rec.name ?? rec.username) };
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
    const rec = asRecord(json);
    if (status === 200 && rec) {
      return {
        found: true,
        repo: {
          fullPath,
          cloneUrl: String(rec.clone_url ?? ''),
          defaultBranch: String(rec.default_branch ?? 'main'),
          webUrl: String(rec.html_url ?? rec.clone_url ?? ''),
        },
      };
    }
    if (status === 404) return { found: false };
    throw mapHttpError(status, conn.kind);
  }
  const { status, json } = await hostReq(conn, 'GET', `/projects/${encodeURIComponent(fullPath)}`);
  const rec = asRecord(json);
  if (status === 200 && rec) {
    return {
      found: true,
      repo: {
        fullPath,
        cloneUrl: String(rec.http_url_to_repo ?? `${normBaseUrl(conn.baseUrl)}/${fullPath}.git`),
        defaultBranch: String(rec.default_branch ?? 'main'),
        webUrl: String(rec.web_url ?? ''),
      },
    };
  }
  if (status === 404) return { found: false };
  throw mapHttpError(status, conn.kind);
}

/** 创建仓库（不存在时自动初始化）。返回 created=false 表示已存在并关联。 */
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
    const rec = asRecord(json);
    if (status === 201 && rec) {
      return {
        created: true,
        repo: {
          fullPath: `${ns}/${repoName}`,
          cloneUrl: String(rec.clone_url ?? ''),
          defaultBranch: String(rec.default_branch ?? 'main'),
          webUrl: String(rec.html_url ?? rec.clone_url ?? ''),
        },
      };
    }
    if (status === 409 || status === 403 || status === 422) {
      const giteaMsg = status === 403 && rec ? String(rec.message ?? '') : '';
      const msg =
        status === 403
          ? `令牌无创建仓库权限，或对目标命名空间无写入权限${giteaMsg ? `：${giteaMsg}` : ''}`
          : '仓库创建被拒绝（可能已存在同名仓库）';
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
    const list = Array.isArray(nsRes.json) ? (nsRes.json as Array<Record<string, unknown>>) : [];
    const hit = list.find((n) => n.path === ns || n.name === ns || n.full_path === ns);
    if (hit) body.namespace_id = hit.id;
    else throw new GitHostError(400, 'NAMESPACE_NOT_FOUND', `命名空间不存在或不可见：${ns}`);
  }
  const { status, json } = await hostReq(conn, 'POST', '/projects', body);
  const rec = asRecord(json);
  if (status === 201 && rec) {
    return {
      created: true,
      repo: {
        fullPath: String(rec.path_with_namespace ?? `${ns}/${repoName}`),
        cloneUrl: String(rec.http_url_to_repo ?? ''),
        defaultBranch: String(rec.default_branch ?? 'main'),
        webUrl: String(rec.web_url ?? ''),
      },
    };
  }
  const rawMessage = rec?.message;
  const msg = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage ?? '');
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
