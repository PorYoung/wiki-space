# Git 提交聚合（Commit Coalescing）设计

状态：已落地（2026-09-17，M1-M5 全部交付；落地差异：台账增加 checkpoint 操作类型与 actor_email 冗余列，checkpoint 即台账内一种不产生文件变更的操作行）
负责人：待定
关联调研：保存即提交导致 git 历史碎片化 —— 业界两条路线（协作层 + DB 为真源；git-backed 但 commit=发布），本方案取后者：**git 保留为真源镜像，但把 commit 从「保存动作」解耦为「聚合窗口的产物」**。

---

## 1. 背景与问题

现状：所有文档写路由（保存/删除/恢复/移动/批量）在 HTTP 请求内**同步**执行 NAS 镜像 + `git add/commit/push`（`apps/server/src/http/routes-platform.ts:137` `docStorageEffectsBatch`，由 `apps/server/src/http/routes.ts` 8 处调用），每次保存 = 主分支上一个提交。

三个后果：

1. **碎片化**：一次编辑会话（连续 N 次保存）产生 N 个提交；message 是固定模板（`routes-platform.ts:326`），历史不可读。
2. **并发竞态**：多条保存并发时同时操作同一工作副本 `<FS_ROOT>/repos/<projectId>`，git 命令无互斥（PG advisory lock 目前只有搜索索引器在用）。
3. **保存延迟耦合**：push 网络抖动直接拖慢保存请求（单条 git 命令限时 120s）。

业界参照（调研结论，详见 §17）：GitHub Wiki/Gollum 靠「显式保存 + 用户填 message」；GitBook/Decap CMS 靠「暂存区 + 合并时 squash」；Outline/Hocuspocus 靠「DB 真源 + 防抖持久化」。本方案 = **GitBook 的窗口思想 + Outline/Hocuspocus 的防抖模式 + 现有 pg-boss 基建**，不引入新依赖。

## 2. 目标 / 非目标

**目标**

- G1 同一文档库在一个时间窗内的多次保存/删除/移动/恢复 → **恰好一个 git 提交**。
- G2 提交在请求外异步产生，保存接口不再等待 git（消除竞态与延迟耦合）。
- G3 提交 message 可读：聚合用户备注（窗口内任意保存填的 message），缺省回退自动模板；多人窗口用 `Co-authored-by` 列全参与者。
- G4 提供「立即提交」（checkpoint）逃生门，绕过窗口直接聚合提交。
- G5 平滑可回滚：保留现有 inline 链路为 kill-switch 分支，一个 env 切回。

**非目标**

- 不改变「DB 是真源、git 是镜像」的定位；版本恢复仍走 `documentVersions` 快照（不依赖 git）。
- 不做 staging 分支 / PR 式 editorial workflow（单库直推主分支语义不变）。
- 不改 CRDT 实时协同通道本身（`apps/realtime`）；协同内容进 git 仍经 HTTP 保存路径（缺口见 §16-Q1）。
- 不处理二进制文档入 git（维持现状：binary op 跳过 git，仅 NAS 镜像）。

## 3. 方案总览

```
 保存/删除/移动/恢复（HTTP）
   │
   ├─ ① DB 写入（documents + documentVersions + activity）        ← 真源，不变
   ├─ ② NAS 镜像（同步，落盘快，语义不变）
   ├─ ③ git_pending_ops 插入待提交操作台账（代替同步 commitAndPush）
   └─ ④ enqueueGitFlush(boss, projectId)  ← singletonKey=projectId 去重
                │
                ▼
      worker『git-flush』队列（新增，batchSize=1）
                │
        ⑤ 防抖判定：窗口内静默 ≥ DEBOUNCE 或 距窗口起点 ≥ MAX_WAIT？
           ├─ 否 → 重排任务（startAfter=剩余时间），返回
           └─ 是 → withLock('git-workdir:'+projectId)
                │
        ⑥ 台账按 path 折叠（latest-wins，seq 定序）→ 从 documents 读最新内容
                │
        ⑦ commitAndPush（一次提交，author=首操作者，Co-authored-by 其余）
                │
        ⑧ 台账标记已消费 → documents 置 synced → 回填 documentVersions.commitHash
           → syncJobs(trigger='flush') 留痕 → pg_notify 项目房间 'git.flushed'
           → flush 后复查：窗口内又来了新操作？→ 立即再入队（防丢触发）
```

提交边界（三选一先到）：

| 边界 | 默认值 | 说明 |
|---|---|---|
| 静默防抖 | 5 分钟无新操作 | 会话自然结束（Outline/Hocuspocus 模式） |
| 窗口上限 | 30 分钟 | 持续编辑不无限等待（max-wait 强制落盘） |
| 显式 checkpoint | 立即 | 用户点「立即提交」，可附 message |

## 4. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **窗口按 project 而非 document** | git 提交单位本来就是一个库；同库多文档的会话式编辑应合并为一个提交（与现有 `docStorageEffectsBatch` 批量=一提交语义一致） |
| D2 | **待提交操作台账表（`git_pending_ops`）为 flush 的输入**，不依赖 `documents.status='modified'` 推断 | 删除是软删、移动有 fromPath、二进制要跳过——status 推不出操作序列；台账带 `seq bigserial` 保证同毫秒批量操作的折叠定序 |
| D3 | **防抖+max-wait 在 job 体里判定**，而不是靠 `startAfter` 重置 | pg-boss `singletonKey` 去重不延长已 pending 任务的延迟；job 执行时读台账时间戳决定「flush 还是重排」，得到真正的 trailing-edge 防抖（`packages/shared/src/search.ts:140` 注释的同款约束） |
| D4 | **flush 后复查再入队** | pg-boss 对 active 中的同 singletonKey 任务会去重：flush 执行期间新到的保存可能被丢弃触发；job 收尾时检查台账非空则立即再入队，自愈 |
| D5 | **git 写操作全部收敛到 worker**（flush 任务），server 请求路径不再触碰工作副本 | 单一写方 + 单一锁点；复用 worker 已有的 `ensureWorkdir/pullWorkdir/reposRoot` 依赖（`apps/worker/src/index.ts:27,469`） |
| D6 | **`withLock('git-workdir:'+projectId)` 串行化** flush、sync（pull）两条链路 | 二者操作同一工作副本且 sync 会 `reset --hard`（`packages/git/src/git-push.ts:156`）；复用 `apps/server/src/adapters/pg/lock.ts` 的 `PgLockService`（worker 已有 import server 内部模块的先例） |
| D7 | **用户 message 语义改为「窗口注解」**：存 `git_pending_ops.message`，flush 时进提交 body；不再回填自动模板到 `documentVersions.message` | 意义注入点（保存时）与提交点（窗口关闭）解耦——调研核心结论；版本历史展示交回 `changedSummary` + commitHash |
| D8 | **inline 链路保留为 kill-switch**：`GIT_PUSH_MODE=inline` 时走现逻辑（外加 withLock） | 新链路出问题一个 env 回滚；inline 模式顺带补上锁，修复现存竞态 |

## 5. 数据模型（迁移 `0013_git_commit_coalescing.sql`）

```sql
-- 待提交操作台账：flush 任务的输入，也是「窗口」的唯一状态载体（无需独立 window 表：
-- 窗口起点 = min(created_at)，最后活动 = max(created_at)，均可由未消费行推导）
CREATE TABLE git_pending_ops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigserial NOT NULL,                -- 折叠定序（批量插入同 createdAt 时保序）
  project_id  uuid NOT NULL REFERENCES projects(id),
  document_id uuid REFERENCES documents(id),     -- 台账型操作必有；预留可空
  path        text NOT NULL,
  op          text NOT NULL CHECK (op IN ('upsert','delete','move')),
  from_path   text,                              -- move 专用
  kind        text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','binary')),
  actor_id    uuid NOT NULL REFERENCES users(id),
  actor_name  text NOT NULL,                     -- 冗余，message 组装免 join
  message     text,                              -- 用户备注（窗口注解）
  commit_hash text,                              -- 消费后回填
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX git_pending_ops_pending_idx ON git_pending_ops (project_id, seq) WHERE consumed_at IS NULL;
CREATE INDEX git_pending_ops_document_idx ON git_pending_ops (document_id) WHERE consumed_at IS NULL;
```

drizzle 对应表加进 `packages/db/src/schema.ts`（`gitPendingOps`），同步更新 `meta/_journal.json`。

> 台账保留已消费行（`consumed_at` 非空）便于排查与 message 审计；worker `gc-blob` 同款思路可加每日清理（保留 30 天），P2。

## 6. 写路径改造（server）

`routes-platform.ts` 拆分：

```
docStorageEffectsBatch(deps, project, ops, actor, message)   ← 签名不变，8 个调用点零改动
  ├─ NAS 镜像（现逻辑原样）
  └─ git 部分：
      ├─ mode=inline   → withLock 后走现有 ensureWorkdir+commitAndPush（kill-switch 分支）
      └─ mode=coalesced → insertPendingOps(ops, actor, message) + enqueueGitFlush(boss, projectId)
```

调用点清单（均无需改签名，仅 `effects.git` 返回结构变化）：

| 调用点 | 场景 |
|---|---|
| `routes.ts:1940` | 保存 PUT /documents/:id |
| `routes.ts:2163` | 版本恢复 |
| `routes.ts:2283` | 创建文档 |
| `routes.ts:2363` | 删除文档 |
| `routes.ts:2476 / 2556 / 2628` | 移动/重命名/文件夹批量 |
| `routes.ts:610-625` | 建库初始化提交（**保持 inline 不变**：一次性模板落库，必须随建库完成） |

`routes-open.ts` 无 git 调用点（已核实），不受影响。

写路由需要透传 `body.message` 到 `docStorageEffects`（当前单文档包装函数没有 message 参数，加一个可选参数即可）。

## 7. flush 任务（worker）

### 7.1 队列与入队

- 新队列 `git-flush`，`batchSize: 1`（git 副本 I/O 不并发，与 gc-blob 同理）。
- 入队助手放 `packages/shared/src/git.ts`（对齐 `enqueueSearchIndex` 形态）：

```ts
export function enqueueGitFlush(send: PgBossSendLike, projectId: string,
  opts: { startAfterSeconds?: number } = {}): Promise<void>
// send('git-flush', { projectId }, { singletonKey: projectId, ... })
```

- 写路径每次调用 `enqueueGitFlush(boss, projectId)`：窗口内首个操作真正创建延迟任务，后续操作被 singletonKey 去重（不重置延迟）。
- checkpoint：`enqueueGitFlush(boss, projectId, { startAfterSeconds: 1, singletonKey: 'cp:' + projectId })`——**必须用独立去重键**：pg-boss 对 pending 任务的同 key 去重会让默认键入队被吞，checkpoint 最坏等满防抖窗口；`cp:` 键让第二个 job 秒级启动，读到 checkpoint 行后跳过 rearm 直接 flush（§7.3），与残留的防抖任务天然幂等（台账已消费则空转）。

### 7.2 防抖判定（纯函数，可单测）

```ts
type WindowClock = { now: number; firstPendingAt: number; lastActivityAt: number };
type FlushDecision = { action: 'flush' } | { action: 'rearm'; delayMs: number };

function decideFlush(c: WindowClock, debounceMs: number, maxWaitMs: number): FlushDecision {
  const idle = c.now - c.lastActivityAt;
  const elapsed = c.now - c.firstPendingAt;
  if (idle >= debounceMs || elapsed >= maxWaitMs) return { action: 'flush' };
  return { action: 'rearm', delayMs: Math.min(debounceMs - idle, maxWaitMs - elapsed) };
}
```

### 7.3 job 主流程

```
handleGitFlush(job {projectId}):
  rows = SELECT * FROM git_pending_ops WHERE project_id=? AND consumed_at IS NULL ORDER BY seq
  if rows 空 → return（空转，正常）

  clock = { firstPendingAt: min(rows.created_at), lastActivityAt: max(rows.created_at) }
  d = decideFlush(clock, DEBOUNCE_MS, MAX_WAIT_MS)
  if d.action == 'rearm' → enqueueGitFlush(boss, projectId, { startAfterSeconds: d.delayMs/1000 + 1 }); return

  await lockService.withLock('git-workdir:' + projectId, flushProject(projectId, rows))

flushProject:
  project = SELECT … WHERE deleted_at IS NULL；库已删 → 全部标记 consumed 并返回
  cfg 校验（storageKind=git / autoCommit / connection）同现逻辑，不满足 → 标记 consumed 返回

  // 折叠：expand（move → delete(from) + upsert(to)）→ 按 path 取 seq 最大步骤
  steps = fold(rows)
  // 内容解析：upsert 步骤一律读 documents 表最新 content（latest-wins）；
  // 行已不存在（删除后未重建）→ 视为 delete；kind=binary → 跳过
  changes = buildPushChanges(steps)
  if changes 空 → 标记 consumed(noop)；return

  { workdir } = ensureWorkdir(…)          // 现有参数拼装照抄 handleSync:448-471
  result = commitAndPush(workdir, changes, author=首操作者, message=buildCommitMessage(rows, checkpointMessage))

  if result.ok:
    标记 rows consumed（回填 commit_hash, consumed_at）
    UPDATE documents SET status='synced' WHERE id IN (rows.document_id) AND deleted_at IS NULL
    UPDATE document_versions SET commit_hash=result.commit_hash
      WHERE commit_hash IS NULL AND document_id IN (…) AND created_at <= now()   -- 窗口内版本统一挂哈希
    INSERT sync_jobs { trigger:'flush', commit_hash, status:'succeeded',
                       stats:{ ops:rows.length, pushed, noop, actors:[…] } }
    UPDATE projects SET storageStatus='synced', lastSyncedAt=now()
    audit 'git.flush'；pg_notify 项目房间 { event:'git.flushed', documentIds, commitHash }
  else:
    INSERT sync_jobs { trigger:'flush', status:'failed', error }
    UPDATE projects SET storageStatus='error', lastError=…
    audit 'git.flush_failed'
    throw   // 交给 pg-boss 重试（send 时带 retryLimit/ retryBackoff，见 §7.4）；台账不清，重试即重放

  // D4：flush 期间新到操作的兜底
  if EXISTS pending ops → enqueueGitFlush(boss, projectId, { startAfterSeconds: 1 })
```

### 7.4 投递参数

```ts
send('git-flush', { projectId }, {
  singletonKey: projectId,
  startAfter: <判定值>,
  retryLimit: 5, retryDelay: 60, retryBackoff: true,   // push 失败指数退避重试，最终兜底=storageStatus=error + 手动重试/checkpoint
})
```

失败不丢数据：DB 真源已落，台账未消费，重试或下次任意保存/checkpoint 自然重放。

## 8. Commit message 规范

**Subject**（沿用现有 `docs(...)` 前缀习惯，兼容按路径检索历史的用法）：

| 窗口形态 | subject |
|---|---|
| 单文档更新 | `docs(<path>): 平台内更新（<首操作者>）` |
| 单文档删除 | `docs(<path>): 删除文档（<首操作者>）` |
| 多操作 | `docs(<projectName>): 聚合更新 <N> 项（<首操作者> 等 <K> 人）` |
| checkpoint 且带 message | 首行截断 72 字符作为 subject，前置同款 `docs(...): ` 前缀 |

**Body**（有则才写）：

```
变更明细:
- M docs/guide/intro.md（张三）修复安装步骤描述      ← 窗口内首个用户备注，截断 50 字
- D docs/old.md（李四）
…（上限 20 行，超出显示「…等 N 项」）

Co-authored-by: 李四 <lisi@example.com>            ← 除首操作者外的全部参与者，去重
```

实现为纯函数 `buildCommitMessage(ops, opts)`，放 `packages/shared/src/git.ts`，配套单测。

## 9. API 变更

| 接口 | 变更 |
|---|---|
| `PUT /api/v1/documents/:id` 等全部写路由 | 响应 `effects.git` 在 coalesced 模式下变为 `{ attempted:true, ok:true, deferred:true, pendingOps:<n> }`（无 commitHash）；新增可选 `effects.git.etaSeconds`。inline 模式结构不变 |
| `POST /api/v1/projects/:id/git-flush`（新增） | checkpoint。body `{ message?: string }`，权限 canWrite。效果：向台账写一条 checkpoint 注记 + 立即触发 flush。返回 `202 { ok:true }`；结果经 `projects.storageStatus` / syncJobs 呈现 |
| `GET /api/v1/projects/:id/git-pending`（新增） | `{ pendingCount, oldestPendingAt, etaSeconds, mode }`，权限 canRead。供前端徽标轮询（或并入现有项目详情响应，M4 定） |

`documentVersions` 行为变化：commitHash 仍在 flush 后**批量**回填（时间线上稍晚出现，`git.flushed` 事件触发前端刷新）；`message` 不再回填自动提交信息（D7）。

## 10. 前端改造（apps/web）

| 位置 | 变更 |
|---|---|
| `BrowsePage.tsx:1078` 保存 toast | 「已保存」+（coalesced）「Git 将在约 N 分钟内自动提交」；不再展示即时 commitHash |
| `wrapSaveWithConflict`（BrowsePage.tsx:1084） | 不变：409 判定只依赖 DB 版本号，与 git 解耦后语义更纯粹 |
| 项目/文档头部 | pending 徽标：「N 处变更待提交」+ `GET git-pending` 轮询（打开页面时）+「立即提交」按钮（调 checkpoint，转圈至 storageStatus 回 synced） |
| 版本时间线 | 监听项目房间 `git.flushed` 事件 → 刷新版本列表（commitHash 迟到场景） |
| 存储设置页 | syncJobs 列表自然多出 `trigger='flush'` 行，无需新 UI；可加一条窗口参数说明文案 |

## 11. 并发与锁矩阵

同一库的工作副本写方全部过 `withLock('git-workdir:'+projectId)`（PgLockService，djb2 → `pg_advisory_lock`）：

| 写方 | 位置 | 加锁 |
|---|---|---|
| flush 任务 | worker（新增） | ✅ 全程（ensureWorkdir → commitAndPush） |
| sync 任务（pull + reset --hard） | worker `handleSync:448-477` | ✅ M3 顺带补上（修现存竞态） |
| inline 兜底（kill-switch） | server `docStorageEffectsBatch` | ✅（server 已有 PgLockService） |
| 建库初始化提交 | server `routes.ts:610` | ✅（同上，属 inline 分支） |
| publish 任务 | worker | 不碰工作副本（渲染读 DB，已核实），无需锁 |

锁顺序单一（总是先锁后干活，锁内不再取其他锁），无死锁面。

## 12. 配置与灰度

`apps/server/src/config.ts` + worker/realtime 就地读取（对齐现有 env 惯例）：

| env | 默认 | 说明 |
|---|---|---|
| `GIT_PUSH_MODE` | `coalesced` | `inline` = kill-switch，整体回退现行为（含锁） |
| `GIT_FLUSH_DEBOUNCE_SECONDS` | `300` | 静默防抖 |
| `GIT_FLUSH_MAX_WAIT_SECONDS` | `1800` | 窗口上限 |
| `GIT_FLUSH_RETRY_LIMIT` / `_RETRY_DELAY_SECONDS` | `5` / `60` | push 失败重试 |

灰度步骤：M1-M4 合入（默认 coalesced 但先在 dev 验证）→ 生产观察一周（关注 syncJobs trigger='flush' 失败率、pending 峰值）→ 如异常 `GIT_PUSH_MODE=inline` 即时回滚，无需回代码。

## 13. 测试计划

| 层 | 内容 |
|---|---|
| 单测（vitest，对齐 `open-settings.test.ts` 惯例） | `buildCommitMessage`（单/多操作、删除、checkpoint subject、Co-authored-by 去重、20 行截断）；`foldOps`（upsert→delete→重建、move 链、binary 跳过、seq 定序）；`decideFlush`（防抖重排、max-wait 强制、边界值） |
| 单测（worker） | flush 主流程 mock git：成功回填链路（ops consumed / documents synced / versions commitHash / syncJobs）、失败保留台账、空转、库已删 |
| e2e（`scripts/e2e-platform.mjs` 增场景） | 连续 3 次保存同一文档 → 断言主分支恰 1 个新提交且内容为最终态；checkpoint 立即提交；`git-pending` 计数；多用户窗口 → Co-authored-by 断言 |
| 手工回归 | inline kill-switch 切换、每日 sync 与 flush 交错、删除库时窗口未 flush |

## 14. 里程碑

| 里程碑 | 内容 | 规模 |
|---|---|---|
| M1 | 迁移 0013 + schema 表 + shared（`enqueueGitFlush` / `buildCommitMessage` / `foldOps` / `decideFlush`）+ 单测 | 0.5d |
| M2 | `docStorageEffectsBatch` 分支改造 + message 透传 + 新增 2 个 API | 1d |
| M3 | worker `git-flush` 队列 + 锁矩阵（sync/inline 补锁）+ 事件广播 + 单测 | 1d |
| M4 | 前端（toast / 徽标 / 立即提交 / `git.flushed` 刷新） | 1d |
| M5 | e2e 场景 + 文档（.env.example、README/运维说明）+ 灰度开关验证 | 0.5d |

## 15. 风险与缓解

| 风险 | 缓解 |
|---|---|
| pg-boss 对 active 任务的同 key 去重可能吞掉 flush 期间的触发 | D4 flush 后复查再入队（自愈）；另有 max-wait + checkpoint 兜底 |
| flush 失败期间用户看到的「已保存」与远端不一致 | 状态机如实呈现（modified / storageStatus=error + 现有 toast/通知链路）；DB 真源不受影响，重试重放 |
| 外部直接 clone 仓库的消费者感知滞后 | 产品语义改为「近实时镜像」（最长滞后 MAX_WAIT + 重试）；每日 03:00 反向 sync 不受影响 |
| worker 与 server 必须共享 `FS_ROOT/repos` 卷且能连 git 远端 | 非新增约束（sync 任务已依赖），部署文档标注即可 |

## 16. 开放问题（评审时确认）

- **Q1 协同编辑（CRDT-only）内容不进 git 是既有缺口**：本期假设「协同会话中总有人做 HTTP 保存」。P2 提案：前端在房间空化/最后本地操作后 60s 静默触发一次自动保存（携带 baseVersionNo，409 静默重载重试），即可把 CRDT 内容送进同一聚合管线。
- **Q2 `documentVersions.message` 不再回填自动提交信息**，版本时间线显示「随批量提交 abc1234」——确认 UI 可接受。
- **Q3 checkpoint 权限**用 canWrite 还是收紧到 owner/admin？
- **Q4 默认 5min/30min 窗口**是否合适（上线后可按 syncJobs stats 调参）。
- **Q5 台账清理策略**（建议 gc-blob 同款每日任务，保留 30 天已消费行）。

## 17. 附：业界参照对照

| 参照 | 采纳点 |
|---|---|
| GitBook change request | 「编辑攒在暂存区、合并时才成 commit」→ 本方案的窗口 + checkpoint |
| Outline / Hocuspocus | 防抖 + max-wait 持久化模式 → `decideFlush` |
| Decap CMS editorial workflow `squash_merges` | 窗口内多操作折叠为一个提交 → `foldOps` |
| Gollum / MediaWiki 编辑摘要 | 用户 message 保留但语义改为窗口注解（D7） |
| git `Co-authored-by` 惯例 | 多人窗口署名 |
