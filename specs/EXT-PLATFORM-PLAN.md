# 可扩展能力平台 · 设计与实施计划（EXT-PLATFORM-PLAN）

> 关联文档：[PROTOTYPE-PARITY-PLAN.md](./PROTOTYPE-PARITY-PLAN.md) 第 8 批后遗留的三个后置专项。
> 2026-09-09 复盘修正：三个专项中两个的"依赖外部能力"前提已过时——worker 内已存在自研轻量实现（见 §1 现状盘点），真正缺的是 **server HTTP 路由、渲染器抽包、通知横切链路**。本计划将其合并为 **第 9 批** 实施。

---

## 0. 结论（TL;DR）

- **不引入插件框架**（运行时动态加载 / 插件注册表 / 生命周期钩子）。真实需求是"换实现方便"，用项目既有的 **ports & adapters + 队列 + env 配置** 语汇即可满足：接口定义在 `packages/shared`，轻量实现为默认适配器，运维换实现 = 提供同接口模块 + 改 env + 重启（编译期 Provider 模式）。
- **渲染器抽包**：worker 与 server 必须消费同一个渲染实现，否则预览就是撒谎。`markdownToHtml` / 站点装配逻辑从 `apps/worker` 迁入新包 `@ewiki/render`，发布模板（t-docs 五套）作为渲染参数而非五套渲染器。
- **通知是平台横切服务，不是插件**：`activities`（项目动态流，公共审计）与 `notifications`（个人收件箱，带已读）语义分离；站内渠道为兜底，邮件/webhook 是**并行增加**的渠道适配器而非替换。
- WS 链路已预留：`WsEventName` 枚举含 `notification.new`，realtime 已 LISTEN `ewiki_events`——整条链路只差"往 notifications 表写行 + 发 NOTIFY"这一步。

## 1. 现状盘点（2026-09-09 逐行核实）

| 能力 | 已有 | 缺失 |
|---|---|---|
| AI 分类 | worker `handleAiClassify`（启发式关键词分类，建议写 `ai_classify_runs.stats`，只建议不执行）；表已建 | server 无 `POST /projects/:id/ai-classify`（入队）与 `GET …/ai-classify-runs`（读表）；前端 ProjectSettings 两卡 disabled |
| 外部导入 | worker `handleImport`：`folder` 递归 *.md、`web-crawler` 单页抓取转 MD，`import_jobs` 带进度；表已建 | server 无 `POST /projects/:id/import-jobs` / 查询路由；前端仅 Notion/Confluence/Google 三张 disabled 卡（与本实现能力不符） |
| 发布渲染 | worker 完整管线：`markdownToHtml`（标题/列表/引用/代码块子集）→ `renderDocsToHtml` → 工件落盘 → `current.json` 原子切换 | 渲染器长在 worker 内部无法复用；无预览端点；模板 id 未参与渲染 |
| 通知 | `notifications` 表（userId/type/payload/readAt）；`WsEventName.notification.new`；realtime LISTEN；TopBar 通知中心（但读的是 `/activities`）；Settings 偏好开关 | 无写入方、无读路由、无已读/分页、无落地页；worker 各 handler 只写 activities |
| 事件底座 | `EventChannel` 含 `'notifications'`；`PgEventBus` / `PgJobQueue` 端口适配器（`server/adapters/pg`）；worker `pg_notify('ewiki_events',…)` → realtime 按房间广播 | notifications 事件无人发布 |

环境事实：server 路由直接持 `deps.boss` 入队（`POST /sources/:id/sync` 用 `singletonKey` 同分钟去重）；worker `tsx watch` 热重载；包均为源码直出 TS（无构建步骤）。

## 2. 架构决策（ADR 风格）

### ADR-P1 · Provider 接口 + env 选择，不做动态插件
- 接口进 `@ewiki/shared/ports`：`ClassifyProvider`、`ImportProvider`、`Notifier`。
- worker 维护实现注册表（`heuristic` 分类器 / `folder`、`basic-crawler` 导入器），经 `AI_CLASSIFY_PROVIDER` 等 env 选择，缺省即自研轻量实现。
- 换实现路径：新增同接口适配器（可放独立 npm 包）→ 改 env → 重启 worker。拒绝动态加载的理由：插件 API 版本化、隔离与配置 UI 的成本在现阶段无对应收益；且 pg-boss 队列本身已是进程间解耦边界。

### ADR-P2 · 渲染单一事实源（`@ewiki/render`）
- 纯函数包：入参 docs 数组 + 渲染选项，不触 DB（DB 查询留在调用方 worker/server）。
- `renderMarkdown(md)` / `renderSitePage` / `renderSiteIndex` / `renderDocPage`（预览用单页）/ `renderSite`（发布用全站，含 hash）。
- 发布模板 = 渲染参数（`templateId` → accent/字体/版式元数据），五套模板共享一个渲染器；`accent` 与 `sidebarSide` 可被预览端点入参覆盖（PreviewModal 外观定制保持真实有效）。
- 边界声明：自研渲染为 Markdown 常用子集（标题/段落/行内/代码块/引用/无序列表/链接），表格等按纯文本透传——与既有 worker 行为一致，不回退。

### ADR-P3 · 通知 = 平台服务 + 渠道适配器
- 语义分离：`activities` 公共动态流（已有）；`notifications` 个人收件箱（本次接通）。**不合并**。
- 默认站内渠道 `InboxNotifier`：写 `notifications` 表 + `pg_notify('ewiki_events', {channel:'notifications', payload:{room:`user:${userId}`, event:'notification.new', …}})`。
- 事件准入（原型级，控制音量）：
  - `sync.error`（同步失败才通知；成功走 activities）
  - `publish.finished`（通知项目全员）
  - `import.finished` / `import.failed`（通知触发者，job.data 带 startedBy）
  - `team.invite`（server 邀请成功时通知被邀请人）
  - ai-classify **不通知**（结果在设置页可见，避免噪音）
- 邮件/webhook 渠道：`Notifier` 接口的多渠道数组，env 未配置则跳过——后期**增装**适配器，站内永远兜底。
- 读取侧：`GET /notifications`（游标分页 + unread 计数）、`POST /notifications/:id/read`、`POST /notifications/read-all`；前端 TopBar 切真数据源 + `/notifications` 落地页。WS 推送已广播，前端先轮询（60s + focus），WS 订阅留待专项。

## 3. 接口定义（落地于 `packages/shared/src/ports/index.ts`）

```ts
// ---- AI 分类（生成-确认两段式的"生成"段：只建议，不落库到文档） ----
export interface ClassifySuggestion {
  documentId: string;
  path: string;
  title: string;
  folder: string;
  tags: string[];
}
export interface ClassifyProvider {
  id: string; // 'heuristic' | 未来 'llm-xx'
  suggest(docs: Array<{ id: string; path: string; title: string }>): Promise<ClassifySuggestion[]>;
}

// ---- 外部导入 ----
export interface ImportResult { docs: number }
export interface ImportProvider {
  id: string; // 'folder' | 'basic-crawler' | 未来 'notion-oauth'
  supportedParams: string[];
  run(params: Record<string, unknown>, sink: { upsertDoc(path: string, content: string): Promise<void>; onProgress(done: number): Promise<void> }): Promise<ImportResult>;
}

// ---- 通知（站内收件箱 + 未来渠道） ----
export interface NotificationInput {
  userId: string;
  type: 'sync.error' | 'publish.finished' | 'import.finished' | 'import.failed' | 'team.invite';
  payload: { projectId?: string; title: string; message: string; link?: string };
}
export interface Notifier {
  channel: string; // 'inbox' | 'email' | 'webhook'
  send(input: NotificationInput): Promise<void>;
}
```

env 清单：`AI_CLASSIFY_PROVIDER`（默认 `heuristic`）、`NOTIFY_EMAIL_WEBHOOK`（预留，未配置跳过）。其余沿用现有 `DATABASE_URL` / `FS_ROOT` / `JWT_SECRET`。

## 4. HTTP 契约（第 9 批新增）

| 路由 | 语义 | 备注 |
|---|---|---|
| `GET /api/v1/projects/:id/publish-preview?docId&templateId&accent&sidebarSide` | 同步渲染单文档页（无 docId 则渲染项目索引页），返回 `{html}` | 不落盘、无缓存；渲染实现 = worker 发布同一包 |
| `POST /api/v1/projects/:id/ai-classify` | 入队 ai-classify（singletonKey 同分钟去重），202 `{jobId}` | worker 启发式实现 |
| `GET /api/v1/projects/:id/ai-classify-runs` | 最近 50 条建议记录 | stats jsonb 原样下发，前端聚合 |
| `POST /api/v1/projects/:id/import-jobs` | 建 `import_jobs` 行 + 入队；importer 白名单 `folder`/`web-crawler`（notion/obsidian 返回 400 NOT_IMPLEMENTED） | body `{importer, params}` |
| `GET /api/v1/projects/:id/import-jobs` | 最近 20 条导入任务 | |
| `GET /api/v1/import-jobs/:id` | 单任务进度（前端轮询） | |
| `GET /api/v1/notifications?limit&before&unread` | `{items, unread}`，createdAt 游标分页 | |
| `POST /api/v1/notifications/:id/read` / `POST /api/v1/notifications/read-all` | 已读 / 全部已读 | 只允许操作本人行 |

## 5. 实施步骤（第 9 批，每步独立可验收）

1. **Step 1 渲染抽包**：新建 `packages/render`（`@ewiki/render`）；worker 删本地实现改 import；server 加 publish-preview；PreviewModal 画布切真 HTML（iframe srcDoc + sandbox），复制按钮解禁，外观定制参数透传渲染端点。
2. **Step 2 能力路由**：shared ports 增补；worker Provider 注册表；server 四组路由；ProjectSettings「AI 整理 / 外部导入」两卡解禁（导入卡改为 本地文件夹 / 网页抓取 可用 + Notion/Obsidian 禁用声明；任务进度轮询）。
3. **Step 3 通知横切**：worker `InboxNotifier` + 三事件接入 + `notifyProjectMembers`；server 邀请通知；notifications 三路由；TopBar 切真数据源 + 落地页 `/notifications`（路由注册 + 徽标未读数）。

## 6. 验收清单（2026-09-09 实测复核）

- [x] `pnpm -r typecheck`（7 包全绿）与 `pnpm --filter @ewiki/web build` 双绿
- [x] 预览：`GET …/publish-preview` 返回模板着色 HTML（document/index 双 scope 实测：t-blog+accent 覆盖 serif 生效、t-api mono+amber 生效）；PreviewModal iframe 渲染且「复制预览 HTML」可用；worker 发布产物与预览同源（同一 @ewiki/render）
- [x] AI 分类：POST 入队 202（singletonKey 同分钟去重）→ worker 消费 → runs 6 条可查（suggestion 落 stats jsonb）
- [x] 导入：web-crawler 建任务 201 → running → done（1 篇文档落库）；notion 返回 400 NOT_IMPLEMENTED
- [x] 通知：import.finished 自动落 notifications（unread=4）；单条已读 200；read-all {"updated":3}；unread 归零；未带 token 401
- [x] 验收数据零残留：测试导入文档/ai_classify_runs/notifications/import_jobs 已物理清理（项目恢复 6 篇文档）
- [x] 原型还原计划文档同步核销（专项 1/2/3 自研部分，余量见 §7/PROTOTYPE-PARITY-PLAN 第 9 批行）

> 实施修正记录：worker 导入注册表 key 曾用 `basic-crawler` 与 server 白名单 `web-crawler` 不一致导致首个任务失败，已对齐 shared Importer 枚举。

## 7. 风险与边界（如实声明）

- web-crawler 为单页抓取：无深度爬取、无 robots 遵循、无 JS 渲染——轻量实现边界，深度需求换 `ImportProvider` 适配器。
- 分类建议不直接改文档（确认制），避免启发式误伤。
- 预览端点同步渲染、无缓存：原型级文档量（<500）可接受；量大后可加内存 LRU 或入队预渲染。
- 通知无 WS 前端订阅（事件已广播）：先 60s 轮询 + focus 刷新，WS 订阅随通知专项后续迭代。
