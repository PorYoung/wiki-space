// ---------------------------------------------------------------------------
// MCP 工具清单（OPEN-API-MCP-DESIGN §8）：开放 REST 的 1:1 投影。
//   描述即文档：写工具强制"检索优先查重"、更新给标准并发序列（read → update(baseVersionNo)，
//   409 重读重试）、删除声明软删可恢复——这些守则是 AI 正确编排的关键。
// ---------------------------------------------------------------------------

import { McpToolError, textResult, type McpClient, type ToolDef } from './protocol.js';

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function reqStr(args: Record<string, unknown>, key: string, tool: string): string {
  const v = str(args, key);
  if (!v) throw new McpToolError(400, 'INVALID_ARGUMENTS', `${tool}: 缺少必填参数 ${key}`);
  return v;
}

async function callJson(client: McpClient, method: string, path: string, opts?: { query?: Record<string, string | undefined>; body?: unknown }): Promise<Record<string, unknown>> {
  const res = await client.call(method, path, opts);
  return (res.json ?? {}) as Record<string, unknown>;
}

export const KB_TOOLS: ToolDef[] = [
  {
    name: 'kb_search',
    title: '检索知识库',
    description:
      '全文/语义/混合检索用户可读的知识库（含标题加权与段落级语义命中）。' +
      '回答用户知识性问题前必须先调用本工具，再按需读取全文。' +
      'mode=auto（默认，库开启向量时混合检索）/keyword/semantic；未开向量的库自动降级 keyword（响应 degraded 提示）。' +
      ' projectId 限定单库；tags 过滤标签。回答时引用结果的 path 与 heading。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '检索词（自然语言或关键词）' },
        mode: { type: 'string', enum: ['auto', 'keyword', 'semantic'], description: '缺省 auto' },
        projectId: { type: 'string', description: '限定知识库 id（kb_list_projects 获取）' },
        tags: { type: 'array', items: { type: 'string' }, description: '按标签过滤' },
        limit: { type: 'number', description: '返回条数，缺省 10，上限 50' },
      },
      required: ['q'],
    },
    async execute(client, args) {
      const json = await callJson(client, 'GET', '/search', {
        query: {
          q: reqStr(args, 'q', 'kb_search'),
          mode: str(args, 'mode'),
          projectId: str(args, 'projectId'),
          limit: num(args, 'limit') !== undefined ? String(num(args, 'limit')) : undefined,
        },
      });
      const items = (json.items as unknown[] | undefined) ?? [];
      const brief = items.map((it) => {
        const h = it as Record<string, unknown>;
        return {
          documentId: h.documentId,
          projectId: h.projectId,
          projectName: h.projectName,
          path: h.path,
          title: h.title,
          snippet: h.snippet,
          heading: h.heading,
          score: h.score,
          reason: h.reason,
        };
      });
      return textResult(JSON.stringify({ items: brief, hasMore: json.hasMore, degraded: json.degraded ?? undefined }, null, 2), { items: brief });
    },
  },
  {
    name: 'kb_read_document',
    title: '读取文档全文',
    description: '按 documentId 读取文档全文（Markdown）与元数据。通常在 kb_search 命中后调用以获取完整上下文。',
    inputSchema: {
      type: 'object',
      properties: { documentId: { type: 'string', description: '文档 id（kb_search 结果给出）' } },
      required: ['documentId'],
    },
    async execute(client, args) {
      const id = reqStr(args, 'documentId', 'kb_read_document');
      const json = await callJson(client, 'GET', `/documents/${encodeURIComponent(id)}`);
      return textResult(JSON.stringify(json, null, 2), json);
    },
  },
  {
    name: 'kb_list_projects',
    title: '列出知识库',
    description:
      '列出当前令牌属主可读的全部知识库（含可见性与文档数）。采集入库前先用本工具确认目标库，' +
      'kb_create_project 前必须先调用本工具确认没有合适的既有库（抑制库蔓延）。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute(client) {
      const json = await callJson(client, 'GET', '/projects');
      const items = ((json.items as unknown[] | undefined) ?? []).map((it) => {
        const h = it as Record<string, unknown>;
        return {
          id: h.id,
          name: h.name,
          description: h.description,
          visibility: h.visibility,
          ownerType: h.ownerType,
          updatedAt: h.updatedAt,
        };
      });
      return textResult(JSON.stringify({ items }, null, 2), { items });
    },
  },
  {
    name: 'kb_list_documents',
    title: '列出库内文档',
    description: '列出知识库内的文档清单（元数据与摘要，不含全文）。维护治理场景用它按库拉清单。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '知识库 id' },
        q: { type: 'string', description: '按路径/标题/标签子串过滤' },
        tag: { type: 'string', description: '按标签过滤' },
      },
      required: ['projectId'],
    },
    async execute(client, args) {
      const projectId = reqStr(args, 'projectId', 'kb_list_documents');
      const json = await callJson(client, 'GET', `/projects/${encodeURIComponent(projectId)}/documents`, {
        query: { q: str(args, 'q'), tag: str(args, 'tag') },
      });
      const items = ((json.items as unknown[] | undefined) ?? []).map((it) => {
        const h = it as Record<string, unknown>;
        return {
          documentId: h.id,
          path: h.path,
          title: h.title,
          tags: h.tags,
          kind: h.kind,
          wordCount: h.wordCount,
          updatedAt: h.updatedAt,
        };
      });
      return textResult(JSON.stringify({ items, total: json.total }, null, 2), { items, total: json.total });
    },
  },
  {
    name: 'kb_get_versions',
    title: '查看版本历史',
    description: '查看文档的版本时间线（谁在何时改了什么）。维护治理场景判断文档是否长期未更新。',
    inputSchema: {
      type: 'object',
      properties: { documentId: { type: 'string' } },
      required: ['documentId'],
    },
    async execute(client, args) {
      const id = reqStr(args, 'documentId', 'kb_get_versions');
      const json = await callJson(client, 'GET', `/documents/${encodeURIComponent(id)}/versions`);
      return textResult(JSON.stringify(json, null, 2), json);
    },
  },
  {
    name: 'kb_suggest_organization',
    title: '获取 AI 整理建议',
    description:
      '读取平台 AI 整理（ai-classify）对库内文档的归档建议（目标文件夹与标签，附依据）。' +
      '建议只读——采纳任何一条都必须向用户复述并经其确认后，显式调用 kb_move_document / kb_set_tags 执行。',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: '知识库 id' } },
      required: ['projectId'],
    },
    async execute(client, args) {
      const projectId = reqStr(args, 'projectId', 'kb_suggest_organization');
      const json = await callJson(client, 'GET', `/projects/${encodeURIComponent(projectId)}/ai-suggestions`);
      return textResult(JSON.stringify(json, null, 2), json);
    },
  },
  {
    name: 'kb_create_document',
    title: '新建文档',
    description:
      '在指定知识库新建 Markdown 文档（自动生成 v1 版本快照、Git 提交并进入检索索引）。' +
      '创建前必须先 kb_search 查重，避免产生重复文档；path 为库内 POSIX 路径且必须含扩展名（如 notes/2026-09-15-方案.md）。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '目标知识库 id' },
        path: { type: 'string', description: '库内路径（POSIX，含扩展名）' },
        title: { type: 'string', description: '标题；缺省从内容 H1 或文件名推导' },
        content: { type: 'string', description: 'Markdown 全文' },
      },
      required: ['projectId', 'path'],
    },
    async execute(client, args) {
      const projectId = reqStr(args, 'projectId', 'kb_create_document');
      const json = await callJson(client, 'POST', `/projects/${encodeURIComponent(projectId)}/documents`, {
        body: {
          path: reqStr(args, 'path', 'kb_create_document'),
          ...(str(args, 'title') ? { title: str(args, 'title') } : {}),
          ...(typeof args.content === 'string' ? { content: args.content } : {}),
        },
      });
      const { effects: _effects, ...doc } = json as Record<string, unknown>;
      return textResult(JSON.stringify({ ok: true, document: { id: (doc as { id?: string }).id, path: (doc as { path?: string }).path, title: (doc as { title?: string }).title } }, null, 2), doc);
    },
  },
  {
    name: 'kb_update_document',
    title: '更新文档内容',
    description:
      '更新文档全文（产生新版本快照）。标准序列：kb_read_document → 修改 → 本工具（携带读到的 latestVersionNo 作为 baseVersionNo）。' +
      '返回 409（版本冲突）说明他人已先保存：必须重新 kb_read_document 后基于最新内容重试，禁止盲目覆盖。',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        content: { type: 'string', description: '修改后的 Markdown 全文（整文替换）' },
        title: { type: 'string' },
        message: { type: 'string', description: '版本说明（本次改动的一句话摘要）' },
        baseVersionNo: { type: 'number', description: '并发保护：kb_read_document 返回的 latestVersionNo' },
      },
      required: ['documentId', 'content'],
    },
    async execute(client, args) {
      const id = reqStr(args, 'documentId', 'kb_update_document');
      const body: Record<string, unknown> = { content: args.content };
      if (typeof args.title === 'string') body.title = args.title;
      if (typeof args.message === 'string') body.message = args.message;
      if (typeof args.baseVersionNo === 'number') body.baseVersionNo = args.baseVersionNo;
      const json = await callJson(client, 'PUT', `/documents/${encodeURIComponent(id)}`, { body });
      return textResult(JSON.stringify({ ok: true, version: (json as { version?: number }).version }, null, 2), { ok: true, version: (json as { version?: number }).version });
    },
  },
  {
    name: 'kb_move_document',
    title: '移动/重命名文档',
    description: '移动文档到新路径或重命名（不产生新版本，Git 内原子改名）。采纳整理建议时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        path: { type: 'string', description: '新路径（POSIX，含扩展名）' },
        title: { type: 'string', description: '新标题' },
      },
      required: ['documentId'],
    },
    async execute(client, args) {
      const id = reqStr(args, 'documentId', 'kb_move_document');
      const body: Record<string, unknown> = {};
      if (str(args, 'path')) body.path = str(args, 'path');
      if (str(args, 'title')) body.title = str(args, 'title');
      if (Object.keys(body).length === 0) {
        throw new McpToolError(400, 'INVALID_ARGUMENTS', 'kb_move_document: 需要 path 或 title 至少其一');
      }
      const json = await callJson(client, 'PATCH', `/documents/${encodeURIComponent(id)}`, { body });
      const doc = (json.document ?? {}) as Record<string, unknown>;
      return textResult(JSON.stringify({ ok: true, path: doc.path, title: doc.title }, null, 2), { ok: true });
    },
  },
  {
    name: 'kb_set_tags',
    title: '设置文档标签',
    description: '整体替换文档标签（最多 8 个）。采纳整理建议时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
      required: ['documentId', 'tags'],
    },
    async execute(client, args) {
      const id = reqStr(args, 'documentId', 'kb_set_tags');
      const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [];
      const json = await callJson(client, 'PUT', `/documents/${encodeURIComponent(id)}/tags`, { body: { tags } });
      return textResult(JSON.stringify({ ok: true, tags: (json.document as { tags?: string[] } | undefined)?.tags ?? tags }, null, 2), { ok: true });
    },
  },
  {
    name: 'kb_delete_document',
    title: '删除文档（软删）',
    description:
      '软删除文档（可在 Web 端恢复，本期无恢复 API）。破坏性操作：执行前必须向用户复述目标文档的标题与路径并取得确认；' +
      '若存在反向引用（响应 refererrers 非空）应一并告知用户。',
    inputSchema: {
      type: 'object',
      properties: { documentId: { type: 'string' } },
      required: ['documentId'],
    },
    annotations: { destructiveHint: true },
    async execute(client, args) {
      const id = reqStr(args, 'documentId', 'kb_delete_document');
      const json = await callJson(client, 'DELETE', `/documents/${encodeURIComponent(id)}`);
      return textResult(JSON.stringify({ ok: true, deleted: true }, null, 2), { ok: (json as { ok?: boolean }).ok ?? true });
    },
  },
  {
    name: 'kb_create_project',
    title: '新建知识库',
    description:
      '新建个人知识库。抑制库蔓延：调用前必须先 kb_list_projects 确认没有合适的既有库，并向用户复述拟建库名与用途。' +
      'visibility 缺省 private；team-* 档位与团队归属仅限用户在 Web 端操作。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '库名（1-80 字符）' },
        description: { type: 'string' },
        visibility: { type: 'string', enum: ['private', 'public-read'], description: '缺省 private' },
      },
      required: ['name'],
    },
    async execute(client, args) {
      const body: Record<string, unknown> = { name: reqStr(args, 'name', 'kb_create_project'), ownerType: 'user' };
      if (str(args, 'description')) body.description = str(args, 'description');
      if (str(args, 'visibility')) body.visibility = str(args, 'visibility');
      const json = await callJson(client, 'POST', '/projects', { body });
      return textResult(JSON.stringify({ ok: true, id: (json as { id?: string }).id, name: (json as { name?: string }).name }, null, 2), { id: (json as { id?: string }).id });
    },
  },
];
