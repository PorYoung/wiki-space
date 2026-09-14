# 搜索触达 · 多文档库与混合库检索 · 设计方案

> 状态：**已实施并通过验收（2026-09-15）**，e2e 102/102（P0–P10 回归 + P11 检索 10 项 + P12 管理运营 7 项 + P13 触达与多库/混合库 6 项）；实施记录见 §10。
> 关联：`specs/SEARCH-VECTOR-DESIGN.md`（§7 查询路径 / §15 管理与运营，已实施 96/96）、`specs/TEAM-PERMISSIONS-DESIGN.md`（五态可见性 + `readableProjectIdsSql` 单一口径 + 匿名读决策留待）
> 证据约定：现状结论以 `file:line` 标注，已逐行核实。范围：ewiki（apps/server + apps/web）。

---

## 0. 结论（TL;DR）

**向量库与搜索入口的关联是查询侧自动的，无需任何注册/配置动作**：知识库开启向量并完成构建后，即自动进入 `/api/v1/search` 的语义召回范围（`mode=auto` 默认融合）。用户主触达 = 搜索页 `/search`（自动模式零操作获得语义命中，带「语义/混合」徽标）。

但逐行核查发现 **4 个触达/正确性缺口**，本方案补齐：

| # | 缺口 | 证据 | 方案 |
|---|---|---|---|
| G1 | 项目内搜索无语义：BrowsePage 文档树搜索是纯前端过滤，不调检索 API | `BrowsePage.tsx:543-546`（`tree.docs.filter(...)`） | R1 双层搜索：保留即时树过滤，Enter 触发库内深度搜索（`/search?projectId=&mode=auto`，服务端已支持） |
| G2 | 阅读页无「相似文档」：语义价值最高的触点（无需输入查询词）缺失 | `ReadPage.tsx:135-142`（仅关键词结果导航） | R2 新端点 `GET /documents/:id/related`（文档自身 chunk 逐个 HNSW + RRF 聚合）+ ReadPage 相关文档模块 |
| G3 | 可发现性弱：语义能力存在感只在"搜了之后"的降级提示出现 | `SearchPage.tsx` degraded 分支 | R3 新端点 `GET /search/coverage`（可读范围内语义覆盖明细）驱动空态引导 + 库范围选择器标注 |
| G4 | **多库正确性缺口：语义检索未按 `embedding_model` 过滤**——换模型过渡期，新查询向量会与旧模型 chunk 向量跨空间比对（结果无意义且污染排序） | `adapters/pg/search.ts` semanticSearch 仅 `embedding IS NOT NULL`（grep 零命中 model 过滤） | R4-c 查询侧硬过滤 `embedding_model = 当前模型`（必须随本方案落地） |

**多文档库 / 混合文档库处理**（R4，形式化既有行为 + 补齐）：

```
查询范围 = 用户可读库集合（readableProjectIdsSql）∩ 请求 scope（缺省全部 / projectId / projectIds 多选）

关键词路  → 恒覆盖范围内全部 text 文档（含未建向量库）
语义路    → 仅覆盖：已开向量 ∧ 已产出 chunk ∧ embedding_model = 当前运行模型的库
融合      → 两路各取 Top-N，RRF(k=60) 融合排序；reason 标注每条命中的来源
透明化    → 响应新增 coverage: {semanticProjects, readableProjects, buildingProjects}
            UI 显示「语义召回覆盖 2/5 库（其余以关键词参与）」——覆盖缺口靠补构建解决，
            不做排序补偿加权（ADR-M1）
```

**公开文档库/匿名检索**：本期维持登录态（权限 spec 既定决策），方案只预留接缝（§5.5）——`readableProjectIdsSql` 匿名变体 + `/search` optional-auth 豁免模式，权限 spec 匿名读落地时 ≤1 天接通。

---

## 1. 现状盘点（2026-09-15 逐行核实）

| # | 事实 | 证据 | 设计含义 |
|---|---|---|---|
| F1 | `/api/v1/search` 仅支持单库 `projectId`（含 canRead 校验）；`projectIds` 是权限物化的内部产物，未暴露给调用方 | `routes.ts:1407` | R4 增加 `projectIds` 多选参数，与可读集合取交集 |
| F2 | 语义路无模型过滤：`WHERE c.embedding IS NOT NULL`，跨模型向量会被同场比对 | `adapters/pg/search.ts` semanticSearch | G4 必修：`AND c.embedding_model = ${model}` |
| F3 | BrowsePage 树搜索 = 前端过滤已加载树（路径/标题子串） | `BrowsePage.tsx:543-546` | R1 在其上叠加深层搜索，不动即时过滤 |
| F4 | 首页联想走 `/documents?q=` 前缀匹配，Enter 跳 `/search?q=` | `HomePage.tsx:61/93` | 维持（延迟优先）；仅补空态引导文案 |
| F5 | ReadPage 有搜索结果导航面板（prev/next），数据源关键词接口 | `ReadPage.tsx:107-142` | R2 相关文档模块复用该视觉区 |
| F6 | 语义分支可用性判定已含三条件：全局开关 ∧ Provider ∧ 任一可读库开向量 | `adapters/pg/search.ts` anyProjectVectorEnabled | R4 混合库行为已有骨架，本方案形式化 + 透明化 |
| F7 | chunk 行已带 `embedding_model`，对账已按模型判定重建（R6） | `schema.ts document_chunks`、worker reconcile | G4 过滤条件的数据基础已备 |
| F8 | 降级链已实现：provider 未配置 / 全局暂停 / 范围内无向量库 → 自动降关键词 + degraded 标记 | SEARCH-VECTOR-DESIGN §7.2 | 混合库缺省行为正确，无需改造 |

---

## 2. R1 项目内深度搜索（BrowsePage）

**双层搜索设计**——即时性与语义各得其所：

| 层 | 触发 | 数据源 | 用途 |
|---|---|---|---|
| 即时树过滤（保留） | 输入即过滤 | 前端已加载文档树（路径/标题子串） | 快速定位已知文件名 |
| 深度搜索（新增） | Enter / 「全文搜索」按钮 | `GET /api/v1/search?q=&projectId=&mode=auto&limit=20` | 全文 + 语义召回（库已开向量即含语义，自动） |

- 结果面板复用 ReadPage 的结果导航交互（列表 + 上一/下一篇 + 命中高亮 snippet + `<em>` 安全渲染）。
- URL 同步 `?q=`（可分享/刷新保持）；`mode` 不暴露切换（库内场景自动即可，库未开向量时服务端自动降级关键词，与全站行为一致）。
- 服务端零改动（`projectId` 已带 `projectAccess.canRead` 精确校验）。

## 3. R2 相关文档（ReadPage 语义触点）

### 3.1 端点

```
GET /api/v1/documents/:id/related?scope=global|project&limit=5
→ { items: [{ documentId, projectId, projectName, path, title, score, reason:'semantic', heading }] }
```

- 登录态；`scope=global`（默认）= 全部可读库内召回，`scope=project` = 限文档所在库。
- 无向量数据（文档无 chunk / 库未开向量 / Provider 未配置）→ `{ items: [] }`，前端隐藏模块。

### 3.2 召回算法（ADR-M2）

**文档自身 chunk 逐个 HNSW + RRF 聚合**，不做均值向量全表比对：

```
1. 取文档自身 chunks（embedding IS NOT NULL ∧ embedding_model=当前模型），
   按 token_count 降序取前 8 个作为"查询向量"（代表性段落）
2. 每个 chunk 走一次 HNSW Top-16：
   WHERE c.embedding_model = :model AND c.embedding IS NOT NULL
     AND c.document_id <> :self
     AND d.deleted_at IS NULL
     AND c.project_id IN (可读集合 ∩ scope)
   ORDER BY c.embedding <=> :chunkVec LIMIT 16
3. 全部 chunk 级命中按 documentId 做 RRF(k=60) 聚合 → 文档排名
4. 过滤 score 低于 SEARCH_SEMANTIC_MIN_SCORE 的文档，取 Top-limit
```

- 每步都走 HNSW 索引（8 次点查级查询），避免"均值向量 GROUP BY 无法走索引"的全表扫描；RRF 复用既有融合机制。
- 权限与全站检索同口径（可读集合物化）；排除自身/同文档重复命中天然由聚合完成。
- 阈值过滤防止弱相关噪音；`heading` 取最高分 chunk 的标题链（沿用语义检索字段语义）。

### 3.3 前端

ReadPage 右栏（TOC 同侧）新增「相关文档」模块：标题 + 库名（跨库时）+ heading + 相似度；点击跳转 `/read/:id`。加载失败/空 → 整模块隐藏（零打扰）。

## 4. R3 可发现性（coverage 端点 + 空态引导）

```
GET /api/v1/search/coverage
→ {
    globalEnabled: boolean, provider: 'none'|'openai-compatible',
    projects: [ { id, name, vectorEnabled, building } ]   // 可读集合内，按库名排序
  }
```

- `vectorEnabled` 取自 `projects.search_config`；`building` = 存在 pending/running 的 index_builds（可读集合一次聚合查询）。
- 驱动三处 UI：
  1. **SearchPage 空态**：「语义检索已覆盖 N 个知识库：库A、库B…」（构建中带徽标）；全部未覆盖 → 「开启知识库向量检索后，可按含义召回段落」。
  2. **范围选择器标注**（R4）：多选库里已开语义的带 ✦ 标。
  3. **HomePage 空态**：一句能力引导文案（「支持全文与语义检索」），不接接口（静态文案，避免首页新依赖）。

## 5. R4 多文档库与混合文档库处理

### 5.1 范围模型（scope）

```
有效范围 = readableProjectIdsSql(uid)  ∩  请求 scope
```

| scope | 参数 | 行为 |
|---|---|---|
| 全部可读库（缺省） | 无参数 | 现状行为 |
| 单库 | `projectId=`（已有） | canRead 精确校验（现状） |
| **多选库（新增）** | `projectIds=a,b,c` | 与可读集合取**交集**——请求未授权的库被静默剔除（不可用作越权枚举探针，响应不区分"无权限"与"无结果"） |

公开文档库（public-*）天然在可读集合内：多库检索跨个人库/团队库/公开库联邦执行，无需按库分别请求。

### 5.2 混合覆盖的融合语义（形式化）

| 库状态 | 关键词路 | 语义路 | 说明 |
|---|---|---|---|
| 未开向量 | ✅ 全覆盖 | ➖ 不参与 | 经关键词路正常命中，reason=keyword |
| 已开向量·构建中 | ✅ | ✅ 部分（已完成 chunk） | coverage.buildingProjects 标注 |
| 已开向量·构建完成 | ✅ | ✅ 全量 | reason=semantic/hybrid |
| 已开向量·模型待重建 | ✅ | ➖ 旧模型 chunk 退出语义路（G4 修复） | 「修复缺口/重建」后回归 |

- **ADR-M1（不做排序补偿加权）**：未建向量库在语义型查询下天然只能经关键词路参与，存在排名劣势。选择**透明化而非补偿**——coverage 指示条 + reason 徽标让用户理解结果构成；补偿加权会引入不可解释偏置，且覆盖缺口应靠「补构建」闭环（管理端/设置页已具备）解决。
- 响应新增：`coverage: { semanticProjects, readableProjects, buildingProjects }`，UI 顶部指示「语义召回覆盖 2/5 个知识库」。

### 5.3 模型一致性过滤（G4，正确性修复）

`semanticSearch`/`related` 全部增加 `AND c.embedding_model = ${当前运行模型}`：

- 跨模型向量不在同一空间，比对分数无意义——旧模型 chunk 在换模型过渡期**自动退出语义召回**（降级为仅关键词参与，不是报错）。
- 过渡期收口闭环已具备：chunk 按模型标记 → 夜间对账/「修复缺口」→ 重嵌回当前模型 → 自动回归语义路。
- **ADR-M3（查询侧硬过滤，而非双模型共存查询）**：模型更替是低频事件且对账自愈，为过渡期维护双空间并行查询的复杂度不成比例。

### 5.4 公开文档库与匿名检索（接缝预留，本期不实现）

- 权限 spec 既定「本期全档位登录态」，匿名读为显式非目标。本方案只留两个接缝，权限 spec 匿名读决策落地时对接：
  1. `readableProjectIds` 匿名变体：`uid = null → visibility ∈ ('public-read','public-write')`（SQL 结构已兼容，仅去掉成员存在分支）；
  2. `/api/v1/search` 与 `/related` 采用 `/open/*` 同款 optional-auth 豁免模式（Caddy/网关不变）。
- 检索侧无需其他改动：snippet 高亮、coverage、混合库逻辑均以"可读集合"为唯一权限口径，匿名集合是其退化形态。
- 预估对接工作量 ≤1 天；风险点仅一个：匿名流量下 `ts_headline`/嵌入调用的限流（届时挂平台限流中间件，属网关层事项）。

### 5.5 UI（SearchPage）

- 结果头部增加「范围」选择器：`全部可读库`（默认）/ 多选库 chips（已开语义带 ✦ 标，数据来自 coverage 端点）；选择写入 URL（`?projects=id,id`，可分享）。
- coverage 指示条置于模式切换旁（「语义召回覆盖 2/5 库」）；`coverage.semanticProjects === 0` 时与现有 degraded 提示合一，不重复展示。

---

## 6. API 契约汇总

| 端点 | 变更 | 契约要点 |
|---|---|---|
| `GET /api/v1/search` | 扩展 | 入参增 `projectIds`（逗号分隔，与可读集交集）；响应增 `coverage`；语义路增模型过滤（行为修正） |
| `GET /api/v1/documents/:id/related` | 新增 | §3.1 契约；权限 = 可读集合 ∩ scope；无向量数据返回空 items |
| `GET /api/v1/search/coverage` | 新增 | §4 契约；可读范围内逐库 vectorEnabled/building |

前端接线：BrowsePage 深度搜索（R1）、ReadPage 相关文档模块（R2）、SearchPage 范围选择器 + coverage 指示条 + 空态引导（R3/R4）、HomePage 空态文案（R3）。

---

## 7. 实施计划与验收标准

| 期 | 内容 | 验收（e2e P13 段） |
|---|---|---|
| **M-A 多库与混合库** | projectIds 参数 + 交集安全、模型一致性过滤、coverage 响应与端点、SearchPage 范围选择器/指示条 | 两库（一开向量一未开）混合检索：两库文档均可命中且 reason 标注正确；coverage 数值正确；**换模型后旧模型 chunk 立即退出语义召回**（对账回归后恢复）；projectIds 含未授权库 → 静默剔除且与"无结果"不可区分 |
| **M-B 触达补齐** | BrowsePage 深度搜索、SearchPage 空态引导、HomePage 文案 | 库内深度搜索走 /search 且语义自动参与（库已开向量）；未开向量库内搜索自动降级关键词 |
| **M-C 相关文档** | related 端点 + ReadPage 模块 | 相关文档返回同内容主题文档（同库）、不含自身、无权限库不出现；未开向量库的文档 → 空模块隐藏 |

实施顺序 M-A → M-B → M-C（M-A 含正确性修复应先行）；每期全量 e2e 回归 + `pnpm typecheck/test` 门槛不变。

---

## 8. 开放问题（待评审）

1. **相关文档默认跨库**（scope=global）：跨库推荐是知识网络的价值所在，但可能"跳出"用户当前工作上下文——是否需要 UI 一键切换「仅本库」？（建议：v1 仅 global，模块头部标注库名观察反馈）
2. **coverage 缓存**：库数量级小（单次聚合查询），v1 不缓存；多租户规模后再评估。
3. **related 的 chunk 代表性**：按 token 降序取前 8 个 chunk 够不够（长文档尾部内容可能欠表达）——M-C 上线后以点击率观察，必要时改为"全部 chunk 上限 16"。
4. **匿名检索的限流**：留接缝后，真实开放前需网关层限流 + ts_headline 成本评估（届时专项）。

---

## 9. 参考

- `specs/SEARCH-VECTOR-DESIGN.md`：§5.2 端口/契约、§7 查询路径与降级链、§15 管理与运营
- `specs/TEAM-PERMISSIONS-DESIGN.md`：readableProjectIdsSql 单一口径（permissions.ts:111）、匿名读非目标决策
- `apps/web/src/pages/BrowsePage.tsx:543`、`ReadPage.tsx:135`、`HomePage.tsx:61`：触达现状证据


---

## 10. 实施记录（2026-09-15）

### 10.1 交付物

| 项 | 交付物 | 位置 |
|---|---|---|
| G4 正确性修复 | `SearchRuntimeFlags.embeddingModel` + 语义路/相关文档 `embedding_model = 当前模型` 硬过滤 | `apps/server/src/adapters/pg/search.ts`、`routes.ts` |
| R4 scope | `/api/v1/search` 增 `projectIds` 多选参数，与可读集合取交集（未授权库静默剔除）；响应增 `coverage {semanticProjects, readableProjects, buildingProjects}` | `routes.ts` |
| R3 可发现性 | `GET /api/v1/search/coverage`（可读范围逐库 vectorEnabled/building + 全局开关）；SearchPage 空态引导 + 结果头「语义召回覆盖 X/Y 库」指示 | `routes.ts`、`SearchPage.tsx` |
| R4 UI | SearchPage 范围选择器（多选 chips、已开语义 ✦ 标、构建中标注，URL `?projects=` 可分享） | `SearchPage.tsx` |
| R1 项目内深度搜索 | BrowsePage 树搜索 Enter → 深度搜索面板（`/search?projectId=&mode=auto`，语义/混合徽标、snippet 高亮、降级提示），返回目录树一键还原 | `BrowsePage.tsx` |
| R2 相关文档 | `GET /api/v1/documents/:id/related?scope=global\|project&limit=`（自身 chunk Top-8 逐个 HNSW Top-16 → RRF 聚合 → 阈值过滤）；ReadPage 底部「相关文档 · 语义推荐」模块（空结果隐藏） | `routes.ts`、`ReadPage.tsx` |

### 10.2 与设计的偏差

1. **匿名检索接缝未实现代码**（按 §5.4 决策）：`readableProjectIds` 匿名变体与 optional-auth 仅为设计预留，落地待权限 spec 匿名读决策。
2. **SearchPage 范围选择器**采用 popover + checkbox 列表（设计稿的 chips 形态在结果头部空间不足），交互等价。
3. **ReadPage 相关文档置于文末**（设计稿"右栏"会与 TOC/搜索结果面板争位），符合"相关阅读"常见心智。

### 10.3 验收记录

- `pnpm typecheck` 10 包全绿；单测全绿（shared 70 / server 32 / storage 15）；web 构建通过。
- e2e **102/102**（`scripts/e2e-report.json`），关键新用例：混合库检索双命中且 reason/coverage 正确（P13b）、未授权库 scope 交集静默剔除（P13c）、换模型旧向量即时退出语义召回且恢复后回归（P13d）、相关文档不含自身且越权 403（P13e）。
- **测试基建修正**：e2e 的 alice 改为每轮注册新用户（`alice-<runId>@`）——复用账号时历史项目累积会挤出 `/projects` 列表第一页（limit=100），导致示例库断言与后续用例漂移（P1b/P3 假失败根因，非产品缺陷）。
- 过程中 Docker Desktop 守护进程一次意外退出导致 PG/Gitea 下线（server 启动 AggregateError 的根因），已恢复数据并给 `ewiki-pg`/`gitea` 容器设置 `unless-stopped` 自启策略。
