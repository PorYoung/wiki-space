# WorkBuddy vs OpenKnowledge / 自研 ewiki：能力差距对比

> 版本：v1.0（2026-09-14）
> 目的：梳理 WorkBuddy（腾讯 AI 办公工作台）与 Inkeep 开源的 OpenKnowledge（AI-native Markdown IDE / LLM Wiki），以及工作区自研 ewiki 之间的定位与能力差距，输出差异清单供产品与研发参考。
> 数据来源：OpenKnowledge README / docs（2026-09 抓取）、WorkBuddy 官方文档 Overview、ewiki PRD/README、公开评测文章。

---

## 1. 一句话定位

| 产品 | 定位 |
| --- | --- |
| **OpenKnowledge** | 本地优先（local-first）的 AI-native Markdown 编辑器 + LLM Wiki：以"文件夹里的 .md 文件"为唯一真相源，人类用 WYSIWYG 编辑器、AI 代理通过 MCP/CLI 读写同一份文件。GPL-3.0 开源，免费。 |
| **WorkBuddy** | 腾讯出品的全场景 AI 办公工作台：自然语言下达任务 → 自主拆解执行 → 交付完整成果（文档/表格/PPT/数据分析），连接腾讯办公生态。闭源商业产品。 |
| **ewiki（自研）** | 团队文档知识管理平台：多源接入（git/local/web/database）→ 统一整理 → 团队协作（四角色/冲突处理/实时协同）→ 一键发布站点。自建后端（Hono + PG + 对象存储）。 |

三者的共同交集是"**围绕知识文档的 AI 辅助**"，但切入点完全不同：

- OpenKnowledge 的切入点是**编辑体验 + 代理可读写**（Notion × VS Code，但文件是 markdown）；
- WorkBuddy 的切入点是**任务执行**（对话式办公自动化，不绑定某个知识库）；
- ewiki 的切入点是**企业知识管理链路**（多源 → 协作 → 发布），AI 目前只是"整理"辅助。

---

## 2. 能力对比矩阵

| 维度 | OpenKnowledge | WorkBuddy | ewiki（现状） |
| --- | --- | --- | --- |
| **定位** | AI-native 编辑器 + LLM Wiki | AI 办公工作台（通用任务执行） | 团队知识管理平台 |
| **部署形态** | 桌面 App（mac/Win/Linux）+ 本地 Web（`ok start`） | 桌面客户端（闭源） | Web SPA + 服务端（自托管） |
| **数据主权** | 纯本地文件（.md/.mdx），无专有存储 | 本地文件可读写 + 云端能力 | 自托管 PG + 对象存储/NAS |
| **文档模型** | 文件夹 = 知识库，无强制 schema | 无固定文档模型（任务/文件产物） | Document / Project / Source（Drizzle 建模） |
| **编辑器** | 真 WYSIWYG（Notion 感），字节保真 | 任务面板 + 结果区，非文档编辑器 | TipTap 封装（占位），阅读视图为主 |
| **AI 问答/检索** | Agentic search（embedding + 层级检索） | 深度研究 / 对话分析 | 仅"AI 整理"（归类/打标），无问答 |
| **AI 代理接入** | 一等公民：内置 MCP server + Agent Skills，`ok init` 自动接线 Claude Code/Codex/OpenCode/Pi 等 | 自身即 agent（不对外暴露 MCP 供其他 agent 消费） | 无 MCP，无 agent 集成 |
| **协同** | git/GitHub 同步、团队分享（无代码） | 无（任务制） | 四角色权限、409 冲突保护、WS/Yjs 实时协同 |
| **发布** | 无内置站点发布（可导出） | 可生成报告/PPT/文档产物 | 五套模板发布为平台子路径，匿名可访问 |
| **图谱** | wiki-link 图视图（graph viewer） | 无 | S6 图谱洞察（P1 规划，未落地） |
| **同步状态机** | 无（git 原生冲突由 git 管） | 无 | 已实现：synced/local/conflict/untracked 四态 |
| **权限体系** | 无（文件即权限） | 无 | Owner/Maintainer/Editor/Guest + 项目可见性 |
| **多源接入** | 打开任意含 md 的文件夹（含 Obsidian vault） | 本地文件夹授权读取 | git / local / web / database 四类数据源 |
| **离线能力** | 本地优先，天然离线 | 断网能力衰减（产品评估点） | 远期路线（桌面端离线模式，见 ARCHITECTURE-DUAL-SCENARIO） |
| **许可** | GPL-3.0-or-later | 商业闭源 | 内部项目 |
| **生态** | npm 包 + MCP + Discord 社区 | 腾讯办公生态连接器 | GitLab/Gitea 连接、LDAP 预留 |

---

## 3. 差异清单（按方向分）

### 3.1 OpenKnowledge 领先、值得对标的能力

| # | 能力 | 说明 | 对 ewiki 的启示 |
| --- | --- | --- | --- |
| O1 | **真 WYSIWYG Markdown 编辑器** | 编辑 .md 像 Google Doc/Notion，底层字节保真。ewiki 的 TipTap 还是占位。 | 补齐编辑器是"编辑体验"类差距的第一位。 |
| O2 | **内置 MCP Server + Agent Skills** | 让 Claude Code / Codex / OpenCode 等 agent 直接搜索、读写知识库，而非 grep 目录。 | ewiki 无任何 MCP 暴露——这是与"AI 原生"最直接的能力鸿沟。 |
| O3 | **`ok init` 自动接线 agent** | 检测本机 harness（Claude Code/Desktop/Cursor/Codex/OpenCode/OpenClaw），一键配置 MCP + skills。 | 对应 ewiki 的"存储配置"向导，可借鉴为"AI 接入向导"。 |
| O4 | **Agentic search** | 基于 embedding + 层级检索，专为 LLM 代理检索优化。 | ewiki 只有关键字/目录检索，无向量检索。 |
| O5 | **wiki-link 图视图** | 文档间双向链接的可视化。 | ewiki S6 图谱洞察仍在 P1 规划。 |
| O6 | **丰富嵌入组件** | Mermaid、LaTeX、视频/PDF 嵌入、可嵌入 HTML，面向工程 spec 与可视化报告。 | ewiki 渲染管线已支持表格/hljs/KaTeX/mermaid（markdown-it 同源），组件化嵌入可对标。 |
| O7 | **编辑历史按会话回滚** | 每次人工/AI 编辑记录元数据（编辑者+时间戳），按会话回滚。 | ewiki 有 git 版本管理，但缺"会话级"回滚视图。 |
| O8 | **CRDT 实时协同** | 多人 + 多 agent 同时编辑同一文档，实时同步。 | ewiki 已有 WS + Yjs 协同（P1 验收），方向一致，可对比成熟度。 |

### 3.2 ewiki / WorkBuddy 领先、OpenKnowledge 没有的能力

| # | 能力 | 说明 |
| --- | --- | --- |
| W1 | **服务端权限与多租户** | ewiki 的四角色 + 项目可见性（private/team/public），OpenKnowledge 无权限模型（文件即权限）。 |
| W2 | **多源接入与同步状态机** | ewiki 的 git/local/web/database 四类源 + synced/local/conflict/untracked 自动检出；OpenKnowledge 只吃本地文件夹。 |
| W3 | **一键发布站点** | ewiki 五套模板发布为平台子路径，匿名可访问；OpenKnowledge 无发布能力。 |
| W4 | **企业集成** | WorkBuddy 连接腾讯办公生态；ewiki 预留 LDAP、GitLab Runner 推送 API。 |
| W5 | **审计台账 / 系统管理** | ewiki 管理员审计、存储基础设施状态；OpenKnowledge 无。 |

### 3.3 WorkBuddy 独有的差异化

| # | 能力 | 说明 |
| --- | --- | --- |
| B1 | **自然语言任务执行** | 拆解 → 规划 → 执行 → 交付成果，非"编辑器 + 侧边 AI"。 |
| B2 | **多模态产物** | 文档/表格/PPT/数据分析/可视化，直接生成可验收结果。 |
| B3 | **自动化与计划任务** | 定时/周期任务（agent 自主跑）。 |
| B4 | **深度研究** | 复杂问题多步调研输出报告。 |
| B5 | **技能（Skills）体系** | 可安装/编写领域技能，扩展专业能力。 |

---

## 4. 差距量化评估

以下按"AI 原生度 / 编辑体验 / 知识管理 / 企业能力"四维打分（1-5），基于公开资料与 ewiki 现状：

| 维度 | OpenKnowledge | WorkBuddy | ewiki（现状） |
| --- | --- | --- | --- |
| AI 原生度（agent 可读写） | ★★★★★ | ★★★☆☆ | ★★☆☆☆ |
| 编辑体验（WYSIWYG） | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ |
| 知识管理（多源/权限/状态） | ★★☆☆☆ | ★★☆☆☆ | ★★★★☆ |
| 企业能力（权限/审计/发布） | ★★☆☆☆ | ★★★☆☆ | ★★★★☆ |
| 任务执行（办公自动化） | ★★☆☆☆ | ★★★★★ | ★☆☆☆☆ |
| 离线/数据主权 | ★★★★★ | ★★★☆☆ | ★★★☆☆（远期） |

---

## 5. 结论与建议

1. **OpenKnowledge 的核心启示不是"编辑器"，而是"让 AI 成为一等公民"**：内置 MCP server + skills + agentic search + `ok init` 接线。这正是 ewiki 目前最缺的一层——它把知识库做成"人可编辑的文件夹"，ewiki 是"人可编辑的平台"。若 ewiki 要走向 AI 原生，优先补 **MCP 服务暴露 + 向量检索 + agent 读写接口**，而不是先堆编辑器功能。
2. **两者知识管理能力互补**：OpenKnowledge 弱在权限/多源/发布/审计，强在编辑与 agent 集成；ewiki 恰好相反。若未来做桌面端（ARCHITECTURE-DUAL-SCENARIO 已规划），OpenKnowledge 的"文件夹即知识库 + 本地优先 + CRDT"是可直接借鉴的架构参照。
3. **WorkBuddy 与两者不构成直接竞争，而是能力互补**：WorkBuddy 是通用任务执行层（交付文档/表格/PPT），OpenKnowledge/ewiki 是知识沉淀层。理想组合是"ewiki 沉淀知识 + MCP 暴露 → WorkBuddy/任意 agent 消费执行"。
4. **可立项的对标项（按优先级）**：
   - P0：ewiki 暴露 MCP server（文档检索 + 文档读写），让 Claude Code / 内部 agent 可消费；
   - P1：补齐 WYSIWYG 编辑器（对标 O1/O6）；
   - P1：agentic search（embedding 检索，对标 O4）；
   - P2：会话级编辑历史回滚（对标 O7）；
   - P2：`ok init` 式"AI 接入向导"（对标 O3）。

---

*附：数据快照（2026-09-14）*
- OpenKnowledge：v0.18.0（2026-06），GPL-3.0-or-later，TypeScript monorepo（turbo + pnpm），~4.2k stars，Node.js 24+ 运行 Web 版。
- WorkBuddy：腾讯 AI 办公工作台，闭源，官方文档 Overview（2026-06 更新）。
- ewiki：内部项目，React 19 + Vite + Hono + Drizzle + pg-boss，四进程架构（web/server/realtime/worker），2026-09 平台化首期已验收（53 项 e2e 断言）。
