# 全文检索 · 向量检索 · 索引自动化管线 · 设计与落地规划

> 状态：**已实施并通过验收（M1+M2+M3 落地，2026-09-14）**，见 §14 实施记录；M4 按计划仅预留（§14.3 触发阈值）。
> 关联：`docs/DESIGN.md`（ADR-3 PostgreSQL 一体化、§3.2 数据模型 `search tsvector GENERATED` 规划、SE1 `GET /search`）、`docs/PRD.md`（§1.2 痛点"检索耗时与知识孤岛"、市场信号"AI/RAG 第一驱动"）、`specs/TEAM-PERMISSIONS-DESIGN.md`（五态可见性 + `readableProjectIdsSql` 单一口径）、`packages/shared/src/ports/index.ts`（SearchService 端口）
> 证据约定：现状结论均以 `file:line` 标注，已逐行核实。范围：ewiki（apps/server + apps/worker + apps/web + packages/db + packages/shared + deploy）。

---

## 0. 结论（TL;DR）

用户提出的三个缺口，根因与方案一句话对照：

| # | 缺口 | 根因（现状证据） | 方案 |
|---|---|---|---|
| 1 | 无全文检索 | 唯一生效的搜索是 `GET /api/v1/documents?q=` 里的手写 ILIKE 全表模糊匹配（`routes.ts:1270`）：无中文分词、无相关性排序、无索引、snippet 为前 120 字符硬切；`SearchService` 端口虽有接缝但 `PgSearchService` 的 `indexDocument/removeDocument` 是空操作且**未接入任何路由**（`adapters/pg/search.ts:13-19`） | PG tsvector 生成列（zhparser 中文分词）+ pg_trgm，M1 即时生效、零管道增量；查询收敛到新端点 `GET /api/v1/search`，权限强制复用 `readableProjectIdsSql` |
| 2 | 无向量检索 | 全库无任何 embedding/pgvector 代码或依赖；`.env.example` 有 `LLM_PROVIDER/LLM_API_KEY` 占位但 config.ts 与全部代码均未读取（`.env.example:37-39`） | pgvector（HNSW/cosine）+ chunk 级索引表 `document_chunks`；`EmbeddingProvider` 端口（openai-compatible 实现，兼容 OpenAI/智谱/通义/Ollama/vLLM，气隙部署走本地模型）；**知识库粒度开关**（`projects.search_config.vector`），不全局一刀切 |
| 3 | 无"自动提交队列 + 自动构建 + 增量更新/删除" | 写路径（创建/保存/软删/恢复/移动/文件夹级联/导入/同步收割）没有任何索引钩子；无索引状态追踪表 | 复用 pg-boss：新增 `search-index` / `search-build` 队列；写路径收敛点显式入队（singletonKey 按文档防抖合并、执行时读库最新态 = latest-wins 幂等）；开启向量 → `index_builds` 全量回填（断点续跑、进度可视）；夜间 cron 对账自愈缺口 |

**六条核心决策**（详见 §4 ADR-S1~S6）：

1. **搜索引擎不新增运维实体**：全文检索与向量检索都落在现有 PostgreSQL 16 内（ADR-3 既定方向），compose 仅把 postgres 官方镜像替换为自建「postgres + zhparser + pgvector」扩展镜像，容器数不变。Meilisearch / Qdrant 定位为规模触发的升级路径（端口已隔离）。
2. **全文索引 = documents 生成列**（`search_vector tsvector GENERATED ALWAYS AS … STORED`）：随 `documents.content` 写入自动更新，**全文检索天然增量、不需要队列**；队列只为向量索引（embedding 外呼）而建。
3. **向量索引 = chunk 级**（`document_chunks`，markdown 感知切分 ~512 token、带重叠），检索按文档聚合取最大分；chunk 存 `content_hash` + `embedding_model`，内容未变的 chunk **跳过重复 embedding**（增量更新的成本核心）。
4. **权限 = 查询时过滤**，所有检索（关键词/向量/混合）SQL 内联 `readableProjectIdsSql(uid)` + `deleted_at IS NULL` 双条件（`permissions.ts:111` 规范强制"搜索必须复用本函数"）。项目可见性变更因此**零索引动作**。
5. **索引触发 = 显式入队 + 对账兜底**，不用 DB 触发器：写路径收敛点调用 `enqueueSearchIndex(documentId)`；pg-boss singletonKey 防抖（3 秒窗口合并连击保存）；job 执行时读 DB 最新态；每日 cron 对账比对 `documents ↔ document_chunks` 缺口自愈；pg-boss 重试/死信兜失败。
6. **Embedding 走 Provider 端口**（仿 `ClassifyProvider` 模式）：接口在 shared、实现按 env 选择；默认 `openai-compatible`，`EMBEDDING_PROVIDER=none` 时向量能力整体下线（不建队列、不外呼），开启开关需先配置 Provider。

**关键取舍提示**：协同编辑（Yjs）的权威内容仍以 `documents.content` 显式保存为准（`BrowsePage.tsx:981` 乐观并发 PUT；`ydoc_snapshots` 只是 realtime 每 30s 的会话快照，7 天 TTL 清理 `blob-gc.ts:129-138`），索引跟着 `documents.content` 走即可覆盖当前全部写路径；若未来引入"协同内容自动 flush 到 content"，该 flush 点必须接同一索引钩子（§10 风险注记）。

---

## 1. 需求分析与扩展

### 1.1 用户原始诉求 → 工程需求映射

| 原始表述 | 工程需求 | 验收口径 |
|---|---|---|
| "缺乏全文检索" | 中文分词的全文索引 + 相关性排序 + 高亮 snippet + 按标签/路径/知识库过滤 | 中文句子按词命中（非整句子串）；结果按相关性降序；关键词高亮 |
| "缺乏向量检索" | 语义检索：查询文本 → embedding → 相似度召回 | 改述/同义表达可命中（如搜"怎么部署"命中"上线步骤"）；命中粒度为段落 |
| "自动提交队列" | 文档创建/更新/删除/恢复后**自动**进入索引构建队列，无需人工触发 | 保存文档 ≤ 数秒后索引可见（向量受防抖窗口影响 ≤ ~1 分钟） |
| "自动构建" | 对已开启向量的存量知识库，自动完成全量回填（含进度、可取消、可重试） | 开关打开后无需任何手工步骤，构建完成前新写入文档也进入增量队列 |
| "增量更新、删除" | 编辑只重嵌入变化的 chunk；删除（含软删、文件夹级联、项目删除）自动清索引 | 内容哈希未变的 chunk 不重复调用 embedding；删除后向量/全文均不再命中 |

### 1.2 扩展需求（从代码现状与部署形态推导，本期一并覆盖）

1. **权限一致性（P0，安全）**：检索是绕过页面权限直读内容的通道（snippet 即内容泄露面）。五态权限已强制"所有搜索必须复用 `readableProjectIdsSql`"（`permissions.ts:106-110` 注释），向量召回同样受此约束——pgvector 检索必须在 SQL 内做**预过滤**（WHERE project_id ∈ 可读集合），不能取回 Top-K 后再过滤（会因截断漏结果）。`readableProjectIdsSql` 已含 `deleted_at IS NULL`（已核实），文档软删后天然不可检索。
2. **文档全生命周期覆盖**：软删（`DELETE /documents/:id`）、恢复（`/restore`）、移动/重命名（`PATCH`，title 参与 FTS 权重）、文件夹级联重命名/删除（`/folders/*`）、导入器落库、worker 同步收割 upsert/软删（`worker/src/index.ts` `upsertFileDoc/harvestDocsFromDir`）——每条路径都要么入队、要么被对账兜住。
3. **成本与防抖**：embedding 是唯一有显著成本的动作（外呼计费 / 本地 GPU）。三层控制：a) 写路径 singletonKey 防抖合并连击保存；b) chunk 级 `content_hash` 去重，重命名/移动不触发 embedding；c) 按知识库开关，只有开启向量的库才产生 embedding 调用。
4. **失败自治**：embedding 服务不可用是常态而非异常。pg-boss 指数退避重试 → 死信留痕；夜间对账任务自动补齐失败缺口；构建任务记录失败 chunk 数，不因单条失败中断整体。
5. **气隙/私有化友好**：目标部署是内网 compose（`deploy/compose.yml`，GitLab CI 私有构建）。embedding 默认指向可内网部署的 openai-compatible 服务（Ollama/vLLM + bge-m3），外发 SaaS 仅作为配置选项并在 UI 开启时提示数据出境/外发边界。
6. **知识库粒度开关**：用户明确"**需要**支持向量检索的知识库"——向量是 per-project opt-in（`projects.search_config.vector`），默认关；全文检索默认开（无成本顾虑）。
7. **规模升级路径**：端口化隔离，使"PG 内嵌 → Meilisearch（全文）/ Qdrant·Milvus（向量）"是替换适配器而非重写业务（ADR-3/DESIGN.md:175 已预留该触发条件）。
8. **可观测**：索引规模统计（库/文档/chunk 数）、构建进度与失败原因、对账修复数量——管理端可查，不再"黑盒"。

### 1.3 术语澄清

- 本文"**自动提交队列**"指：文档变更**自动提交到索引构建队列**（类 git autoCommit 的触发心智，但目标是索引而非 Git 仓库）。现有 Git 自动提交链路（`docStorageEffects` → `commitAndPush`，`routes-platform.ts:317`）不受影响、不复用、不改动。
- "**构建**"分两层：全文索引随写自动更新（无构建概念）；向量索引有显式的全量回填（backfill）+ 常态增量两种构建形态。

---

## 2. 现状盘点（2026-09-14 逐行核实）

| # | 事实 | 证据 | 设计含义 |
|---|---|---|---|
| F1 | 数据库 PostgreSQL 16 + Drizzle，迁移用到 0007 | `apps/server/drizzle/0000~0007_*.sql` | 新迁移编号 **0008** |
| F2 | 现有搜索 = 手写 ILIKE（title/path/tags/content），权限过滤已接 `readableProjectIdsSql`，无任何索引 | `routes.ts:1270-1290` | 契约（`{items,total}`）可保留，实现可整体替换 |
| F3 | `SearchService` 端口已定义但实现为空壳、未接线 | `ports/index.ts:61-65`、`adapters/pg/search.ts:13-19` | 端口签名需扩展（补权限/分页/模式），实现按本方案落地 |
| F4 | 正文唯一权威源 = `documents.content`（纯 Markdown text）；CRDT 只存在于 `ydoc_snapshots`（realtime 30s 快照，7 天 TTL） | `schema.ts:194`、`realtime/src/index.ts:110`、`blob-gc.ts:129-138` | 索引只看 `documents.content`，无需解析 CRDT |
| F5 | 编辑保存 = 显式 PUT（乐观并发 `baseVersionNo`），每次保存插全量 `document_versions` 快照 | `routes.ts:1511`、`BrowsePage.tsx:981` | 索引钩子挂在 REST 写路径即可覆盖人工编辑 |
| F6 | 删除是软删除（documents/projects `deletedAt`），有恢复端点 | `routes.ts:1987/1734`、`schema.ts` 头注释 | 索引必须处理"软删→清除、恢复→重建" |
| F7 | 队列/事件基础设施成熟：pg-boss（幂等 singletonKey、7 队列、cron）、LISTEN/NOTIFY 广播；worker ×2 副本消费 | `adapters/pg/jobQueue.ts`、`worker/src/index.ts:1192-1222` | 新增队列即可，零新基础设施；worker 多副本 → job 必须幂等 |
| F8 | worker 已有"扫描 → 哈希对比 → 差量 upsert/软删"的对账模板 | `worker/src/index.ts` `harvestDocsFromDir/upsertFileDoc` | 夜间索引对账任务照搬该模式 |
| F9 | 权限单一口径 `readableProjectIdsSql`（含 `deleted_at is null`、五态、team 档位），注释强制搜索复用 | `permissions.ts:111-121` | 三种检索模式共用同一过滤子查询 |
| F10 | 配置：config.ts zod schema 无任何 embedding 键；`.env.example` 有 `LLM_PROVIDER/LLM_API_KEY` 占位未接线 | `apps/server/src/config.ts`、`.env.example:37-39` | 扩 env schema 时沿用既有命名带上 LLM 占位语义 |
| F11 | 部署：单机 6 容器 compose（caddy/server×2/realtime/worker×2/postgres/minio），无 Redis/无搜索引擎；CI 为私有 GitLab | `deploy/compose.yml`、`deploy/Dockerfile` | 只替换 postgres 镜像（+zhparser+pgvector），拓扑不动 |
| F12 | DESIGN.md 既定方向：`documents` 增加 `search tsvector GENERATED (title+content)` 列；"检索质量/规模不足 → 引入 Meilisearch"；ADR-3 PG 一体化 | `docs/DESIGN.md:272/175/634` | 本方案继承该方向并补齐中文分词与向量的一半 |

---

## 3. 目标与非目标

**目标（本期）**

1. 全文检索上线：中文分词、相关性排序、标题加权、高亮 snippet、tags/path 过滤；权限口径与全站一致。
2. 向量检索以知识库为粒度可开启：开启后自动全量构建 + 常态增量（更新/删除/恢复全自动），无需任何人工索引操作。
3. 混合检索：`mode=auto` 下关键词与语义召回融合（RRF），语义命中带"语义"标识与段落级 snippet。
4. 索引自治：写路径自动入队、防抖合并、失败重试与死信、夜间对账自愈、构建进度可视（项目设置页）。
5. 检索统一入口 `GET /api/v1/search`，SearchPage 切换接入；首页联想维持现状（廉价前缀匹配）。

**非目标（本期不做，列入 §12 开放问题）**

- 二进制文档（pdf/docx/图片）的文本抽取与 OCR 入索引；
- 匿名（未登录）检索（跟随权限 spec"本期全档位登录态"决策）；
- Meilisearch / Qdrant 独立引擎适配器的**实现**（仅端口预留与触发阈值定义）；
- AI 问答 / RAG 生成（检索是它的地基，本期只做检索）；
- 跨语言检索优化、自定义停用词/同义词词库管理界面；
- 协同内容自动 flush（Yjs snapshot → documents.content 的自动落库机制本身）。

---

## 4. 选型与 ADR

### ADR-S1：全文检索用 PG tsvector（zhparser），不引入独立搜索引擎

| 备选 | 结论 |
|---|---|
| **PG tsvector + pg_trgm（采纳）** | 与 ADR-3 一致：首年规模（≤ 数十万文档）下运维实体最少；生成列使增量成本≈0；zhparser 提供中文分词；pg_trgm 补标题模糊/前缀联想 |
| Meilisearch | 中文分词原生友好、开箱即用，但新增有状态容器 + 备份 + 与 PG 的事务一致性负担 → 作为规模触发后的升级路径（端口已隔离） |
| ES/OpenSearch | 运维成本与本产品体量不匹配，排除 |

中文分词是本 ADR 的关键约束：官方 `postgres:16` 镜像无 zhparser/pg_jieba。**自建扩展镜像**（`deploy/postgres/Dockerfile`：基于 postgres:16，编译安装 `pgvector` + `zhparser`+scws，CI 私有构建、气隙可导入）。服务启动时探测 `zhparser` 可用性：可用 → tsvector 配置 `chinese_zh`；不可用 → 降级 `simple` 配置 + 依赖 pg_trgm 子串匹配兜底（可用性优先，相关性弱，日志 warn + 管理端提示）。分词配置进 env（`SEARCH_FTS_CONFIG`），切换配置需重建生成列（表重写，见 §12 开放问题）。

### ADR-S2：向量检索用 pgvector（HNSW + cosine），与全文同库

| 备选 | 结论 |
|---|---|
| **pgvector（采纳）** | 零新增运维实体；权限预过滤与向量检索在一条 SQL 内完成（这是独立向量引擎做不到的天然优势）；HNSW 在 ≤ 百万 chunk 规模足够 |
| Qdrant / Milvus | 专业向量引擎，规模与过滤灵活性更强 → 升级路径（`VectorSearchProvider` 端口预留，触发阈值 §11） |

维度固定为 `vector(1024)`（bge-m3、智谱 embedding-3 等主流中文模型的原生/支持维度），`EMBEDDING_DIM` 仅允许在**首次启用向量前**配置；启用后换模型/换维度 = 全量重建（`index_builds.kind='vector-rebuild'`），因为 pgvector HNSW 索引要求列维度固定。

### ADR-S3：全文索引在文档级（生成列），向量索引在 chunk 级

- 全文：`documents.search_vector` 生成列，`setweight(title,'A') || setweight(content,'B')`。随写自动更新 = 天然增量、无管道、无一致性窗口——**这是"全文检索不需要队列"的根本原因**。写入放大（每次保存多一次 to_tsvector）在该体量可接受。
- 向量：长文档整体 embedding 会稀释语义、命中无法定位段落，故按 chunk 索引（markdown 感知切分：优先标题边界，~512 token、50 token 重叠），`document_chunks` 聚合到文档取最大分。chunk 同时带轻量 tsvector 列供混合检索的段落级关键词分支（可选，M3 评估）。

### ADR-S4：权限在查询时过滤，不在索引里做隔离

所有检索 SQL 内联 `readableProjectIdsSql(uid)` + `isNull(documents.deletedAt)`（+ 项目 `deleted_at is null`，该函数已含）。由此：**可见性/成员/团队变更、软删、恢复全部零索引动作**；索引里不存任何"谁能看"的状态，不存在权限漂移窗口。代价是向量检索必须做 SQL 预过滤下的 HNSW（pgvector 支持，配合 `hnsw.iterative_scan` 保证高选择性过滤下的召回率），这在 pgvector 0.7+ 已是成熟用法。

### ADR-S5：EmbeddingProvider 端口，openai-compatible 实现

仿 `ClassifyProvider` 模式（`ports/index.ts:68-86`：接口在 shared、实现按 env 选择、换实现=改 env+重启）：

```ts
export interface EmbeddingProvider {
  id: string;                       // 'none' | 'openai-compatible'
  dim: number;                      // 必须与 EMBEDDING_DIM 一致，启动时校验
  embed(texts: string[]): Promise<number[][]>;  // 批量接口，实现内部分批/限速
}
```

`openai-compatible` 一个实现覆盖 OpenAI / 智谱 / 通义 / Ollama / vLLM（差异全部收敛到 base_url + api_key + model 三个 env）。`none` 为缺省：向量开关打不开（接口 422 提示未配置），队列不消费、零外呼。

### ADR-S6：索引触发 = 显式入队 + latest-wins 幂等 + 对账兜底（不用 DB 触发器）

- **不用触发器**：触发器隐式、难测试、且把 embedding 外呼间接拖进请求事务边界的心智；显式入队与现有 `docStorageEffects`（NAS 镜像 + git autoCommit）的副作用风格一致。
- **latest-wins**：job 载荷只带 `documentId`（不带内容/不带操作类型），执行时读 `documents` 最新态决定"重建 chunk / 清除 chunk"——防抖合并后旧任务执行时自然落到最新状态，天然幂等，worker ×2 副本重复消费也安全。
- **对账兜底**：任何入队丢失路径（未来新增写路径忘了挂钩子、job 持续失败）由每日 cron 对账修复（见 §7.3）。

---

## 5. 领域模型（迁移 0008 + 端口扩展）

### 5.1 数据库（`packages/db/src/schema.ts`，迁移 `apps/server/drizzle/0008_*.sql`）

```sql
-- 0008_search_and_vector.sql（要点，非逐字）
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS zhparser;          -- 镜像内置；缺失时由启动探测降级
CREATE TEXT SEARCH CONFIGURATION chinese_zh (PARSER = zhparser);
ALTER TEXT SEARCH CONFIGURATION chinese_zh ADD MAPPING FOR n,v,a,i,e,l WITH simple;

-- 1) 全文索引：documents 生成列（title 权重 A，content 权重 B；binary 行 content 为 NULL → 空 tsvector）
ALTER TABLE documents ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(coalesce(to_tsvector('chinese_zh', coalesce(title,'')), ''::tsvector), 'A') ||
    setweight(coalesce(to_tsvector('chinese_zh', coalesce(content,'')), ''::tsvector), 'B')
  ) STORED;
CREATE INDEX documents_search_vector_gin ON documents USING gin (search_vector);
CREATE INDEX documents_title_trgm_gin ON documents USING gin (title gin_trgm_ops);

-- 2) 向量索引：chunk 表
CREATE TABLE document_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,  -- 冗余，供权限预过滤直查
  chunk_no        integer NOT NULL,
  content         text NOT NULL,
  content_hash    text NOT NULL,          -- sha256(content)；增量去重键
  heading_path    text,                   -- 所在标题链（"部署/回滚"），进 snippet 上下文
  embedding       vector(1024),           -- 构建中/失败时为 NULL（可区分"待嵌入"与"无向量"两态）
  embedding_model text,                   -- 产出模型；换模型重建的判定键
  token_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_no)
);
CREATE INDEX document_chunks_hnsw ON document_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX document_chunks_project_idx ON document_chunks (project_id, document_id);

-- 3) 知识库粒度开关
ALTER TABLE projects ADD COLUMN search_config jsonb NOT NULL DEFAULT '{"fts":true,"vector":false}';

-- 4) 构建台账（仿 ai_classify_runs）
CREATE TABLE index_builds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  kind        text NOT NULL,              -- 'vector' | 'vector-rebuild'
  status      text NOT NULL DEFAULT 'pending',  -- pending | running | done | failed | canceled
  total_docs  integer NOT NULL DEFAULT 0,
  done_docs   integer NOT NULL DEFAULT 0, -- 游标进度（断点续跑）
  failed_docs integer NOT NULL DEFAULT 0,
  cursor_doc  uuid,                       -- 续跑游标（按 id 排序的下一个起点）
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

要点说明：

- `document_chunks.project_id` 冗余是刻意的：权限预过滤 `WHERE project_id IN (可读集合)` 直接落在 chunk 表，不 join documents。
- `embedding` 可空：NULL = 该 chunk 尚未有有效向量（构建中断/模型切换），对账任务据此补齐，无需额外状态表。
- 外键 `ON DELETE CASCADE` 兜物理删除场景（本期业务是软删，但保证 GC/清库时索引不悬挂）。

### 5.2 端口扩展（`packages/shared/src/ports/index.ts`）

```ts
export type QueueName = 'sync' | 'publish' | 'ai-classify' | 'import' | 'export'
  | 'compensate' | 'gc-blob' | 'search-index' | 'search-build';

export interface SearchRequest {
  q: string;
  mode: 'auto' | 'keyword' | 'semantic';   // auto = 有向量用混合，否则纯关键词
  projectIds?: string[];                    // 权限解析后的可读集合（路由层产出）
  projectId?: string;                       // 单库内检索
  tags?: string[]; limit?: number; offset?: number;
}
export interface SearchHit {
  documentId: string; projectId: string; path: string; title: string;
  snippet: string;                          // 含 <em> 高亮标记
  score: number; reason: 'keyword' | 'semantic' | 'hybrid';
  heading?: string;                         // 命中 chunk 的标题链
}
export interface SearchResponse { items: SearchHit[]; hasMore: boolean; tookMs: number; }

export interface SearchService {           // 方言边界接口（SDD ADR-11），实现 = PgSearchService 重写
  search(req: SearchRequest): Promise<SearchResponse>;
}
export interface EmbeddingProvider { /* 见 ADR-S5 */ }
```

权限集合以 `projectIds: string[]` 数组传入而非 SQL 片段：保持端口对 DB 方案无感知（国产库边界）。当前体量（单库私有部署，可读集合 ≤ 数千）下数组绑定可行；若未来超限，再引入"SQL 片段注入"的方言专用逃生口（届时属于方言实现内部细节，接口不变）。

---

## 6. 索引管线：自动提交队列 + 增量更新/删除

### 6.1 写路径挂钩点（全部收敛点清单）

| 写事件 | 位置 | 动作 |
|---|---|---|
| 创建文档 | `routes.ts` `POST /projects/:id/documents` | 入队 `search-index {documentId}` |
| 保存（含版本回滚后的保存） | `routes.ts` `PUT /documents/:id` | 同上（防抖合并） |
| 软删 / 恢复 | `routes.ts` `DELETE`、`/restore` | 同上（执行时按 `deletedAt` 分流清除/重建） |
| 移动/重命名 | `PATCH /documents/:id` | 同上（FTS 生成列自动更新；向量 chunk 内容未变则 embedding 零调用） |
| 文件夹级联 | `/folders/rename`、`/folders/delete` | 批量入队（受影响文档集合） |
| 二进制上传/删除 | `routes-files.ts` | **跳过**（kind='binary' 不索引；入队无害但直接不调更省） |
| 导入器落库 | worker import sink → `upsertDoc` | 逐文档入队 |
| 同步收割 | worker `harvestDocsFromDir` upsert/软删 | 入队（远端删除同样走软删路径） |
| AI 整理移动文档 | ai-classify 应用路径 | 入队（path 变化） |

实现形态：`apps/server/src/lib/search-index.ts` 导出 `enqueueSearchIndex(boss, documentId, {delayMs?})`；worker 侧同构函数直连。**future-proof 注记**：若未来引入"协同内容自动 flush 到 documents.content"，flush 点必须调用同一函数（§10 R4）。

### 6.2 `search-index` 消费逻辑（worker）

```
job {documentId}
 1. 读 documents（含 deletedAt、kind、content、contentHash、project.search_config.vector）
 2. 分支：
    a. 文档不存在 / deletedAt 非空 / kind='binary' / 所在库 vector=false
        → DELETE FROM document_chunks WHERE document_id = $1；结束
    b. 否则：markdown 感知切分 → chunkHashes[]
 3. 与现有 chunks 对比（chunk_no, content_hash）：
    - 哈希相同 → 保留（embedding 不动）
    - 哈希不同/新增 → 批量 embed（EMBEDDING_BATCH_SIZE，如 32 条/批）→ upsert
    - 多余 chunk_no → 删除
 4. embedding 调用失败：该批 chunk embedding 置 NULL 不阻塞其它批；job throw 交给 pg-boss
    重试（指数退避，5 次）→ 死信队列留痕 + audit log；对账任务最终补齐
 5. 全程无锁竞争：同一文档的并发 job 由 singletonKey 防抖保证窗口内只有一个在跑；
    执行期互斥用 LockService.withLock(`search-index:${documentId}`) 兜底
```

防抖参数：`singletonKey = String(documentId)` + `singletonSeconds = 30`（连击保存合并；比协同 30s 快照节拍略长，避免协同会话期间的风暴）。写入侧 `delayMs` 不额外设置——singleton 窗口即是防抖窗口。

### 6.3 全量回填（自动构建，`search-build` 队列）

触发：`PUT /projects/:id`（或项目设置专用端点）将 `search_config.vector` 从 false → true 时，写 `index_builds{kind:'vector', status:'pending'}` 并 `boss.send('search-build', {buildId})`。

消费逻辑（照搬 `harvestDocsFromDir` 的"扫描→差量 upsert"模板）：

1. `withLock('search-build:'+projectId)` 互斥（同库同时只允许一个构建；重复入队 dedup）。
2. 游标分批：`WHERE project_id=$1 AND deleted_at IS NULL AND kind='text' AND id > cursor ORDER BY id LIMIT 50`；逐文档执行 §6.2 的 2~4 步（复用同一函数）；每批回写 `done_docs/cursor_doc`（**断点续跑**：worker 崩溃后重发 job 从游标继续）。
3. 构建期间新写入/编辑的文档由 §6.1 常态入队并行覆盖，无需等构建完成（构建只补存量）。
4. 取消：设置页置 `status='canceled'`，消费端每批检查；重新构建：`vector-rebuild`（清空该库 chunks 重跑，用于换模型）。
5. 完成：`status='done'` + finished_at；失败文档计数落 `failed_docs`（明细在对账任务中补齐）。

### 6.4 对账自愈（每日 cron，复用 `compensate` 或新增 `search-reconcile`）

`boss.schedule('search-reconcile', '0 4 * * *')`，对**开启了向量的库**执行：

1. 缺失：`documents` 中有而 `document_chunks` 无（或存在 `embedding IS NULL` 的 chunk、或 `embedding_model ≠ 当前模型`）→ 补建/补嵌。
2. 悬挂：chunk 指向已软删/转 binary 的文档 → 删除。
3. 修复计数写 audit log；连续多日修复量异常 → 管理端通知（复用 Notifier inbox 渠道）。

全文侧无对账需求（生成列由 DB 保证一致性；唯一例外是 zhparser 配置变更时的重建，见开放问题 Q4）。

---

## 7. 查询路径

### 7.1 端点

```
GET /api/v1/search?q=&mode=auto|keyword|semantic&projectId=&tags=&limit=&offset=
Authorization: Bearer（登录态，无匿名）
```

路由层职责：解析 `readableProjectIdsSql(uid)` → 物化为 id 数组 → 调 `SearchService.search()`（权限口径唯一，与项目列表/动态流同源）。

### 7.2 三种模式的 SQL 形态（PG 实现）

```
keyword:  WHERE search_vector @@ plainto_tsquery('chinese_zh', :q)
            AND project_id = ANY(:readable)        -- 文档级直接用 search_vector
          ORDER BY ts_rank_cd(search_vector, query) DESC
          补充：title 无命中时 pg_trgm similarity(title,:q) 兜底（错字/子串）
          snippet：ts_headline('chinese_zh', content, query, 'StartSel=<em>,…')

semantic: 首查 chunk 级：
            SELECT document_id, ... FROM document_chunks
            WHERE project_id = ANY(:readable) AND embedding IS NOT NULL
            ORDER BY embedding <=> embed(:q) LIMIT 64      -- 预过滤 + HNSW（iterative_scan）
          再按 document 聚合取最大相似度，LIMIT n

hybrid(auto): 关键词 Top-50 ∪ 语义 Top-50 → RRF 融合（score = Σ 1/(60+rank)），
              reason 标记来源；同文档取最高融合分
mode 降级链：semantic/hybrid 且 Provider=none 或目标库 vector=false → 自动降 keyword（响应带
             degraded 标记，前端提示"该库未开启向量检索"）
```

`mode=auto` 语义：查询范围内**任一**库开启向量 → 走 hybrid（未开启的库只在关键词分支贡献结果）；全未开启 → 纯 keyword。语义阈值：cosine 相似度 < 0.3 的 chunk 丢弃（防无关结果混入，阈值进 env 可调）。

### 7.3 与现有端点的关系

| 端点 | 处置 |
|---|---|
| `GET /api/v1/documents?q=`（`routes.ts:1270`） | **保留**，职责收窄为"首页联想/项目内快速过滤"（ILIKE 前缀命中 title/path/tags，延迟低）；其权限过滤已合规，不动 |
| `GET /api/v1/search`（新增） | SearchPage 与 `mode`/语义能力的唯一入口；DESIGN.md SE1 落地 |
| `PgSearchService.query`（空壳） | 删除旧签名，重写为 §5.2 `search()`；连同 `indexDocument/removeDocument` 一并清理（生成列架构下无此概念） |

---

## 8. 前端改动（apps/web）

| 页面 | 改动 |
|---|---|
| `SearchPage.tsx` | 切换到 `/api/v1/search`；新增 模式切换（自动/关键词/语义）与"该库未开启向量"降级提示；语义/hybrid 命中行加"语义"徽标 + `heading` 面包屑；`<em>` 高亮渲染（现有高亮逻辑替换为服务端标记） |
| `HomePage.tsx` | **不改**（联想继续走 `/documents?q=`） |
| 项目设置页 AI 区 | 新增"向量检索"卡片：开关（Provider 未配置时禁用并提示配置方法）+ 构建进度（`index_builds`：进度条、done/total、失败数、上次完成时间）+ 暂停/重新构建按钮 + 数据外发提示（Provider 为外部 SaaS 时显示"开启后文档内容将发送至所配置的嵌入服务"） |
| 管理端 | 平台概览增补检索统计卡（索引文档数/chunk 数/向量维度/Provider/最近对账修复数）——非阻塞，M3 |

---

## 9. 配置与部署

### 9.1 env（`apps/server/src/config.ts` + `.env.example`，server 与 worker 共享）

```bash
# ---- 检索（新增；LLM_* 旧占位保留但不再使用，注释指向新键） ----
SEARCH_FTS_CONFIG=chinese_zh        # chinese_zh | simple（zhparser 不可用时自动降级并告警）
EMBEDDING_PROVIDER=none             # none | openai-compatible
EMBEDDING_BASE_URL=                 # 如 http://ollama:11434/v1 或 https://open.bigmodel.cn/api/paas/v4
EMBEDDING_API_KEY=
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIM=1024                  # 首次启用向量后不可变（pgvector 列维度固定）
EMBEDDING_BATCH_SIZE=32
EMBEDDING_TIMEOUT_MS=10000
SEARCH_SEMANTIC_MIN_SCORE=0.3
SEARCH_INDEX_DEBOUNCE_SECONDS=30
```

### 9.2 compose / 镜像

- 新增 `deploy/postgres/Dockerfile`：`FROM postgres:16` → 编译 `pgvector`、`zhparser`（含 scws）→ 产出 `ewiki/postgres-search:16`，CI 构建推送私有 registry（气隙环境 `docker save/load` 导入）。
- `deploy/compose.yml`：postgres 服务 image 替换；**容器拓扑不变**（仍 6 容器）。数据卷兼容：`CREATE EXTENSION` 由迁移 0008 执行，旧库升级只需跑迁移。

---

## 10. 风险与应对

| # | 风险 | 概率 | 应对 |
|---|---|---|---|
| R1 | zhparser 分词质量/自定义词典不足（专有名词切错） | 中 | M1 验收含中文分词用例集；词典能力不足时评估 pg_jieba（同为镜像内置，SQL 配置切换）；兜底 pg_trgm 子串匹配始终可用 |
| R2 | 生成列拖慢 documents 写入（大文档 to_tsvector） | 低 | 该体量写 QPS 低；实测 P95 回归纳入验收；超预期则改为 FTS 独立表 + 同事务更新（DESIGN.md:291 本来就预留"同事务更新 tsvector"表述） |
| R3 | embedding 服务不稳定导致索引滞后 | 中 | 重试+死信+对账三层兜底；响应侧对 `embedding IS NULL` 的 chunk 自动跳过（滞后=该文档暂不参与语义召回，不影响关键词） |
| R4 | 未来"协同自动 flush"绕过索引钩子 | 低 | 本 spec 明文约束 flush 点必须调 `enqueueSearchIndex`；对账任务每日自愈兜底 |
| R5 | 权限口径漂移（有人在新检索里手写 visibility 条件） | 低 | 权限 spec 已强制单一口径；本方案 review 清单加一条：检索 SQL 必须内联 `readableProjectIdsSql` 产物 |
| R6 | 换 embedding 模型导致新旧向量不可比 | 高（必然发生） | chunk 行记 `embedding_model`；对账将不一致 chunk 视为待重建；换模型走 `vector-rebuild` 显式全量 |
| R7 | HNSW 预过滤召回率不足（可读集合很小、结果被截断） | 低 | 开启 `hnsw.iterative_scan = strict_order`；规模触发阈值见 §11 |

---

## 11. 分期实施计划

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M1 全文检索** | 扩展镜像（pgvector+zhparser 一次到位）；迁移 0008（tsvector 生成列 + trgm + document_chunks/search_config/index_builds 建表可先行）；`GET /api/v1/search` keyword 模式 + 权限口径；SearchPage 接入；e2e 续编 P11 段 | 中文句子按词命中；相关性排序合理（标题命中靠前）；无权限库/软删文档不可见；`documents?q=` 回归不破 |
| **M2 索引管线 + 向量基础** | `EmbeddingProvider` 端口 + openai-compatible 实现；`search-index`/`search-build` 队列 + 全部写路径挂钩；项目开关 + 自动构建 + 构建进度 UI；夜间对账 | 开启向量 → 自动全量构建（断点续跑可验证）；编辑/删除/恢复后索引自动增删（含 chunk 哈希去重断言：重命名零 embedding 调用）；杀掉 embedding 服务，恢复后对账自愈 |
| **M3 混合检索 + 体验** | hybrid/RRF + 语义徽标 + 降级提示；管理端检索统计；性能压测（10 万 chunk 级 HNSW 延迟基线） | `mode=auto` 融合结果优于单路（标注用例集人工评估）；P95 检索延迟 ≤ 500ms（含查询 embedding） |
| **M4 升级路径（仅预留）** | `VectorSearchProvider`/外部全文引擎端口定义；触发阈值写入文档：chunks > 500 万 或 P95 > 800ms → 启动 Meilisearch/Qdrant 适配器专项 | 文档评审即可（无代码） |

实施顺序依赖：M1 的迁移建表与镜像必须先行；M2 依赖 M1 的表结构与队列命名；M3 独立于 M2 的构建链路，仅消费其产物。

---

## 12. 开放问题（待评审）

1. **EMBEDDING_DIM 锁定 1024**：若选定模型原生维度不同（如 OpenAI 1536），要么截断（Matryoshka 模型支持）、要么首启用前定维度——建议默认 bge-m3（1024，中文强、可本地部署），评审确认。
2. **chunk 参数**：512 token / 50 重叠为业界常用起点，需在真实语料（本仓库 docs + ewiki 文档）上做检索质量抽查后定型。
3. **语义阈值 0.3** 与 RRF k=60 为经验值，M3 用标注用例集校准。
4. **zhparser 配置变更重建**：生成列表达式变更 = 全表重写，需要停机窗口或分批回填方案（届时生成列改为普通列 + 触发器/同事务更新的备选形态，呼应 R2）。
5. **二进制文档抽取**（pdf/docx/OCR）入索引的优先级与实现（附件型知识库占比高的话需求会提前）。
6. **匿名读检索**：跟随权限 spec 匿名读决策，若开放则 `readableProjectIdsSql` 需匿名变体（仅 public-*）。
7. **`/documents?q=` 与 `/search` 的长期收敛**：建议 M3 后将联想也切 `/search?mode=keyword&limit=5`，最终下线手写 ILIKE。
8. **检索审计粒度**：是否需要记录"谁在何时搜了什么"（审计合规 vs 存储成本/隐私），待合规要求明确。

---

## 13. 参考

- `docs/DESIGN.md`：ADR-3（PG 一体化）、§3.2（`search tsvector GENERATED` 规划）、§4.7 一致性分级（"搜索索引：同事务更新，重建任务兜底"）、SE1（`GET /search`）
- `specs/TEAM-PERMISSIONS-DESIGN.md`：五态可见性、`readableProjectIdsSql` 单一口径（permissions.ts:111）
- `packages/shared/src/ports/index.ts`：SearchService / JobQueue / ClassifyProvider（Provider 模式范本）
- `apps/worker/src/index.ts`：`harvestDocsFromDir`（对账模板）、队列注册与 cron
- pgvector：HNSW 索引与迭代扫描（iterative_scan）；zhparser：SCWS 中文分词扩展

---

## 14. 实施记录（2026-09-14 落地）

> 状态：**M1 + M2 + M3 全部落地，M4 按计划仅预留**。验收证据见 §14.4。

### 14.1 交付物清单

| 层 | 交付物 | 位置 |
|---|---|---|
| 镜像/部署 | `ewiki/pg16-search:16`（postgres:16 + pgvector 0.8.0 + zhparser/scws） | `deploy/postgres/Dockerfile`；compose postgres 服务已切换 |
| 迁移 | 0008（vector/pg_trgm 扩展、`chinese_zh` 配置含 simple COPY 兜底、documents.search_vector 生成列 + GIN/trgm 索引、document_chunks + HNSW、index_builds、projects.search_config） | `apps/server/drizzle/0008_search_and_vector.sql` |
| 端口 | QueueName +`search-index/search-build/search-reconcile`；SearchService 重构为 `search(req)`；`EmbeddingProvider` + `loadEmbeddingSettings`；singletonKey/singletonSeconds 入队选项 | `packages/shared/src/ports/index.ts` |
| 共享工具 | `chunkMarkdown`（标题链/围栏保护/重叠/硬切）、`fuseRRF`、`enqueueSearchIndex`（防抖+容错）、`highlightTerms`；openai-compatible 嵌入适配器（纯 fetch，批量/超时/维度校验） | `packages/shared/src/search.ts`、`src/adapters/embedding.ts`（单测 `search.test.ts` 15 用例） |
| 检索服务 | PgSearchService：keyword（ts_rank_cd + ts_headline + trgm 兜底）/ semantic（HNSW + iterative_scan 事务内 SET LOCAL + 文档聚合）/ hybrid（RRF k=60）+ 降级链 | `apps/server/src/adapters/pg/pg/search.ts`（`adapters/pg/search.ts`） |
| API | `GET /api/v1/search`（权限物化 `readableProjectIds` + projectName 附带）；`PUT /projects/:id/search-config`（开启即自动投递构建，Provider 未配置 422）；`GET /projects/:id/search-index`；`POST .../rebuild`；`POST .../cancel`；项目 DELETE 清 chunk + 取消构建 | `apps/server/src/http/routes.ts`；`lib/permissions.ts` 新增 `readableProjectIds()` |
| 管线 | worker 三队列消费：`handleSearchIndex`（latest-wins 单文档增量重建，哈希去重搬运已嵌向量）、`handleSearchBuild`（游标分批/断点续跑/每批可取消/失败计数）、`handleSearchReconcile`（每日 04:00：缺失/待嵌/模型不符入队修复 + 悬挂 chunk 清除） | `apps/worker/src/index.ts`、`src/search-indexer.ts` |
| 写路径挂钩 | routes.ts 7 处（创建/保存/软删/恢复/移动/文件夹重命名/文件夹删除）+ routes-files.ts `broadcast` 漏斗（上传/替换）+ worker 收割与导入（harvest changedDocIds / import upsertDoc） | 同左 |
| 前端 | SearchPage 接入 `/api/v1/search`（自动/关键词/语义切换、语义/混合徽标、heading、degraded 提示、`<em>` 安全渲染）；项目设置 AI 页签新增向量卡片（开关/外发提示/进度条/取消/重建） | `apps/web/src/pages/SearchPage.tsx`、`ProjectSettingsPage.tsx` |
| 配置 | config.ts + `.env.example` 新增 SEARCH_FTS_CONFIG / SEARCH_SEMANTIC_MIN_SCORE / SEARCH_INDEX_DEBOUNCE_SECONDS / EMBEDDING_* 九键 | `apps/server/src/config.ts` |

### 14.2 与设计的偏差（评审确认过/无影响）

1. **防抖窗口参数**：env 定名 `SEARCH_INDEX_DEBOUNCE_SECONDS`（spec 草案写 MS），默认 30s；pg-boss `singletonKey + singletonSeconds` 语义。
2. **`chinese_zh` 兜底形态**：迁移用 `CREATE TEXT SEARCH CONFIGURATION chinese_zh (COPY = pg_catalog.simple)`，使配置名恒存在、查询侧零分支（比 spec 的 env 降级方案更简单）；`SEARCH_FTS_CONFIG` 保留为生成列/查询一致性口径。
3. **chunk 级 tsvector 未建**（spec §ADR-S3 的 M3 可选项）：hybrid 的关键词分支用文档级生成列已足够，按 YAGNI 暂缓。
4. **执行期互斥**：同文档并发由防抖窗口 + 幂等重建兜底，未引入 advisory lock（worker 代码注释声明；偶发并发仅冗余嵌入，无错误状态）。
5. **PG 嵌入向量搬运**：重切分后同序同哈希的 chunk 直接搬运 embedding 列值（读旧行 → DELETE+INSERT 同事务），未引入临时表。

### 14.3 M4 升级路径触发阈值（评审稿定案）

| 信号 | 阈值 | 动作 |
|---|---|---|
| document_chunks 行数 | > 5,000,000（HNSW 内存 ≈ dim×4B×2×行数） | 启动 Qdrant 适配器专项（`VectorSearchProvider` 端口，检索侧替换 `semanticSearch` 分支） |
| `/search` P95 延迟 | > 800ms（含查询 embedding，持续一周） | 先 pgvector 调参（ef_search/iterative_scan），无效再换引擎 |
| 中文分词质量/多语言需求 | zhparser 无法满足（评测用例集通过率 < 80%） | 启动 Meilisearch 适配器专项（SearchService 端口整体替换，keyword 分支） |
| 换 embedding 模型/维度 | 必然发生 | 走 `vector-rebuild` 全量重建（已实现），无引擎迁移 |

### 14.4 验收记录（2026-09-14）

- **单测**：`pnpm test` 全绿（shared 70、server 32，含 chunker/RRF/highlight 15 用例 + 运行时配置合并 4 用例）。
- **typecheck**：`pnpm typecheck` 全部 10 包通过；`pnpm --filter @ewiki/web build` 通过。
- **迁移实跑**：开发库（`ewiki-pg` 容器已替换为扩展镜像，数据卷保留）`db:migrate` 成功；`chinese_zh` 分词验证（"向量检索与全文索引的自动构建" → 向量/检索/全文/索引/构建）；存量行 search_vector 回填；6 个检索索引就绪；`document_chunks.embedding` typmod=1024。
- **端到端**：`node scripts/e2e-platform.mjs` **96/96 全部通过**（既有 P0–P10 回归 + P11 检索验收 10 项 + P12 管理与运营验收 7 项），报告 `scripts/e2e-report.json`。
- **对账自愈实测**：人为删除 chunk 后手动投递 `search-reconcile` → worker 日志 `queuedDocs=1` → 缺失 chunk 自动重建并重嵌（`embedding_model` 回到当前模型、`has_vec=t`）。
- **mock 嵌入服务**：`scripts/mock-embedding-server.mjs`（确定性 2-gram 哈希向量 + 嵌入计数端点，供零重嵌断言；验证辅助设施，非生产依赖）。
- **实现期修复记录**（评审留痕）：构建游标死循环（闭包读旧 `build.cursorDoc` → 本地变量推进）；pg 驱动 vector 列返回字符串（`parseVector` 归一后再搬运）；drizzle sql 模板数组展开为多参数（权限白名单改 IN 列表）；`pg_parser` → `pg_ts_parser` 目录表名；**防抖丢更新**（singletonSeconds 窗口含已完成任务，会吞掉窗口内的后续变更 → 改为 `startAfter` 延迟 + 仅 pending 去重，latest-wins 语义零丢失，e2e P11h 回归覆盖）。

---

## 15. 管理与运营能力（2026-09-15 增补实施）

> 需求：设置配置与状态管理友好；便捷设置构建配置；便捷管理构建任务；管理员便捷全局配置与把控、资源调配、任务视图。全部落地，验收见 P12 段（96/96）。

### 15.1 知识库级（项目设置 → AI 整理页签「向量检索」卡片）

| 能力 | 形态 |
|---|---|
| 便捷开关与构建配置 | 向量开关、chunk 切分参数（目标 token 128–2048 / 重叠 0–256）合并式保存（`PUT search-config`）；开启向量自动投递构建，无需手工触发 |
| 配置漂移提示 | `index_builds.params` 留痕构建时参数（chunk/overlap/model），与当前配置不一致时提示「保存后请重新构建以生效」 |
| 构建任务管理 | 构建历史列表（状态/进度/失败数/时间/错误）+ 进行中可取消 + 失败可重试（`search-index/rebuild`）+ 「修复缺口」一键即时对账（`search-index/repair`，仅补缺失/待嵌/模型不符文档） |

### 15.2 平台级（管理端 → 「检索与任务」页签）

| 能力 | 形态 |
|---|---|
| 全局配置运行时化 | 嵌入 Provider/BaseUrl/apiKey（secretbox 加密落库、仅回显尾 4 位）/模型/批量/超时、防抖窗口、语义阈值、**全局向量开关** —— `platform_settings` 覆盖 env 默认，保存后 ≤10s 全站生效，无需重启；apiKey 不回显明文 |
| 全局把控 | kill switch 关闭即全局暂停语义检索与索引更新（已有向量保留，恢复后由对账/修复补齐）；开启向量前置校验（Provider 未配置 422 / 全局暂停 422） |
| 资源调配视图 | chunk 总量/待嵌入/向量库数/进行中构建/失败文档 五项指标 + 三队列（search-index/build/reconcile）实时积压表（pgboss.job 只读查询）+ 「立即对账」手动触发 |
| 任务视图 | 全平台构建任务表（最近 50 条：知识库/类型/状态/进度/失败/参数/错误）+ 失败、取消任务行内重试（vector 从断点续跑，vector-rebuild 重头） |

### 15.3 实现要点

- 运行时配置层 `apps/server/src/lib/search-settings.ts`：env 默认 ⊕ platform_settings 覆盖，读侧 10s TTL 缓存（WeakMap 按 db 实例），保存即失效；server 查询侧与 worker 索引侧共用同一解析入口（worker 复用 server lib，同 blob-gc 模式），`PgSearchService` 构造改为注入 `getRuntime()` 旗标解析器。
- 防抖语义修正（安全修复）：`singletonKey + startAfter` 取代 `singletonSeconds`（后者窗口含已完成任务会吞变更）——延迟期内 pending 去重合并，任务完成后新变更必产生新任务。
- 迁移 0009（index_builds.params）/ 0010（projects.search_config 默认值含 chunk 参数）。
- e2e P12：总览一体下发与非管理员 403、全局配置保存即时生效、kill switch 关闭/恢复、chunk 参数保存 + 构建留痕比对、修复缺口、done 构建重试 409、立即对账权限。
