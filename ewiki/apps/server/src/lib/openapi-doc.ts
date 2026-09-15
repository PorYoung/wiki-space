// ---------------------------------------------------------------------------
// OpenAPI 3.1 契约文档（OPEN-API-MCP-DESIGN ADR-O1）：GET /api/open/v1/openapi.json
//   手工维护的单一事实源 —— 开放面端点变更时同步本文件（e2e 断言关键端点在场）。
//   响应形状与内部面回环结果一致（网关投影），此处描述关键字段。
// ---------------------------------------------------------------------------

const bearer = [{ bearerAuth: [] }];

/** D3 写端点公共参数（幂等重放，评审决议 6） */
const idempotencyParam = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  schema: { type: 'string', maxLength: 200 },
  description: '写幂等键：同键重放返回首次 2xx 响应（Idempotency-Replayed: true）；同键不同 method/path → 409 IDEMPOTENCY_CONFLICT',
};

const jsonRes = (desc: string) => ({
  description: desc,
  content: { 'application/json': { schema: { type: 'object' } } },
});

const errRes = {
  description: '错误信封 {code, message, requestId}；code 见各端点说明',
  content: { 'application/json': { schema: { type: 'object' } } },
};

export function buildOpenApiDoc(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'ewiki 开放 API',
      version: '1.0.0',
      description:
        '文档知识库对外开放面：D1 公开检索（匿名）/ D2 个人检索 / D3 个人管理。' +
        '鉴权：`Authorization: Bearer ewk_…`（Web 端 设置 → API 令牌 签发；scope: search/read/write）。' +
        '限流响应头 X-RateLimit-*（跨副本 PG 精确配额）；浏览器跨源调用已启用 CORS（`*` 默认，OPENAPI_CORS_ORIGINS 可收紧）。' +
        'MCP 客户端接入 POST /mcp（Streamable HTTP：POST 按 Accept 协商 SSE/JSON，GET 通知流 keep-alive）或 stdio 桥（@ewiki/mcp）。',
    },
    servers: [{ url: '/', description: '当前部署' }],
    tags: [
      { name: 'D1 公开检索', description: '匿名（限流 + 平台开关，默认关）' },
      { name: 'D2 个人检索', description: 'token 身份，权限与属主登录态完全一致' },
      { name: 'D3 个人管理', description: 'token 写操作；副作用（版本/Git/索引）与站内编辑一致' },
      { name: 'MCP', description: 'Model Context Protocol（stateless JSON-RPC）' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'ewk_ 前缀个人访问令牌' },
      },
    },
    paths: {
      '/api/open/v1/sites/{slug}/search': {
        get: {
          tags: ['D1 公开检索'],
          summary: '发布站访客检索（按最近发布清单过滤）',
          description: '匿名；仅 keyword 模式；返回 snippet（≤高亮片段）不含全文。平台开关关闭或站点不存在一律 404。code: NOT_FOUND / RATE_LIMITED',
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          ],
          security: [],
          responses: { 200: jsonRes('{items[path,title,snippet,heading,score], hasMore, publishedAt, degraded?}'), 404: errRes, 429: errRes },
        },
      },
      '/api/open/v1/public/search': {
        get: {
          tags: ['D1 公开检索'],
          summary: '平台公开面检索（仅 public-* 可见性知识库）',
          description: '匿名；默认关闭（管理端「开放接口」开启）。code: NOT_FOUND / RATE_LIMITED',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
          security: [],
          responses: { 200: jsonRes('{items[projectId,path,title,snippet,heading,score], hasMore}'), 404: errRes, 429: errRes },
        },
      },
      '/api/open/v1/search': {
        get: {
          tags: ['D2 个人检索'],
          summary: '混合检索（关键词/语义/RRF 融合）',
          description: 'scope: search。与站内检索同源；权限 = 令牌属主可读集合。mode=auto|keyword|semantic；响应含 degraded 降级说明与 projectName 附带。',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'mode', in: 'query', schema: { type: 'string', enum: ['auto', 'keyword', 'semantic'] } },
            { name: 'projectId', in: 'query', schema: { type: 'string' } },
            { name: 'projectIds', in: 'query', schema: { type: 'string' }, description: '逗号分隔，至多 50' },
            { name: 'tags', in: 'query', schema: { type: 'string' }, description: '逗号分隔' },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          security: bearer,
          responses: { 200: jsonRes('{items[documentId,projectId,projectName,path,title,snippet,score,reason,heading], hasMore, tookMs, degraded?}'), 401: errRes, 403: errRes, 429: errRes },
        },
      },
      '/api/open/v1/projects': {
        get: {
          tags: ['D2 个人检索'],
          summary: '属主可读的知识库列表',
          security: bearer,
          responses: { 200: jsonRes('{items[Project], page, pageSize, total}'), 401: errRes },
        },
        post: {
          tags: ['D3 个人管理'],
          summary: '新建知识库',
          description: 'scope: write。body: {name, description?, visibility?, ownerType?}（缺省个人库/私有）。',
          parameters: [idempotencyParam],
          security: bearer,
          responses: { 201: jsonRes('Project'), 400: errRes, 403: errRes },
        },
      },
      '/api/open/v1/projects/{id}/documents': {
        get: {
          tags: ['D2 个人检索'],
          summary: '库内文档列表（真分页）',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['text', 'binary'] } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
          ],
          security: bearer,
          responses: { 200: jsonRes('{items[Document+summary], page, pageSize, total}'), 401: errRes, 403: errRes, 404: errRes },
        },
        post: {
          tags: ['D3 个人管理'],
          summary: '新建文档（Markdown 文本）',
          description: 'scope: write。body: {path(必填，POSIX 含扩展名), title?, content?}。副作用：v1 版本快照 + Git 提交 + 检索索引。code: DOCUMENT_EXISTS / VALIDATION_FAILED',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, idempotencyParam],
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          security: bearer,
          responses: { 201: jsonRes('Document + effects'), 400: errRes, 409: errRes, 415: errRes },
        },
      },
      '/api/open/v1/documents/{id}': {
        get: {
          tags: ['D2 个人检索'],
          summary: '文档详情（含 content 全文）',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: bearer,
          responses: { 200: jsonRes('Document'), 404: errRes },
        },
        put: {
          tags: ['D3 个人管理'],
          summary: '保存文档（新版本快照）',
          description: 'scope: write。body: {content?, title?, message?, tags?, baseVersionNo?}；baseVersionNo 与最新版本不符 → 409 DOCUMENT_VERSION_CONFLICT（读改写并发保护）。',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, idempotencyParam],
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          security: bearer,
          responses: { 200: jsonRes('{ok, document, version, effects}'), 409: errRes, 415: errRes },
        },
        patch: {
          tags: ['D3 个人管理'],
          summary: '移动/重命名文档（与改标题）',
          description: 'scope: write。body: {path?, title?}；路径变更 = Git 原子改名，不产生新版本。',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, idempotencyParam],
          security: bearer,
          responses: { 200: jsonRes('{ok, document, effects}'), 409: errRes },
        },
        delete: {
          tags: ['D3 个人管理'],
          summary: '软删除文档（可恢复）',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, idempotencyParam],
          security: bearer,
          responses: { 200: jsonRes('{ok, effects}'), 404: errRes },
        },
      },
      '/api/open/v1/documents/{id}/tags': {
        put: {
          tags: ['D3 个人管理'],
          summary: '整体替换文档标签（≤8 个）',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, idempotencyParam],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } } } } },
          security: bearer,
          responses: { 200: jsonRes('{ok, document, version, effects}'), 404: errRes },
        },
      },
      '/api/open/v1/documents/{id}/versions': {
        get: {
          tags: ['D2 个人检索'],
          summary: '版本历史（最近 50 条）',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: bearer,
          responses: { 200: jsonRes('{items[versionNo,message,authorName,createdAt,...], total}'), 404: errRes },
        },
      },
      '/api/open/v1/projects/{id}/ai-suggestions': {
        get: {
          tags: ['D2 个人检索'],
          summary: 'AI 整理建议（只读）',
          description: '每文档最新一条归档建议 {folder, tags, at}；采纳需显式调用 PATCH /documents/{id} 与 PUT /documents/{id}/tags。',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: bearer,
          responses: { 200: jsonRes('{items[documentId,path,title,suggestion], total}'), 403: errRes },
        },
      },
      '/api/open/v1/mcp': {
        post: {
          tags: ['MCP'],
          summary: 'MCP Streamable HTTP 端点（JSON-RPC 2.0）',
          description: 'methods: initialize / ping / tools/list / tools/call；工具子集随令牌 scope 裁剪。notification → 202；Accept 含 text/event-stream 时以 SSE 单消息流回包；GET 打开服务端通知流（注释心跳保活）；无状态部署不签发 Mcp-Session-Id。',
          security: bearer,
          responses: { 200: jsonRes('JSON-RPC response'), 202: { description: 'notification 已受理' }, 401: errRes },
        },
      },
    },
  };
}
