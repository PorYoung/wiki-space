---
title: 移除数据源概念，文档库自持存储后端，存储源收敛为用户连接配置
status: accepted
tags:
  - domain:storage
  - domain:document-library
  - refactor
---

## Context

`sources` 表通过 `project_id NOT NULL` 与文档库强制绑定（`@ewiki/packages/db/src/schema.ts` L87-L105），前端建数据源时也必须选择唯一的「归属文档库」（`@ewiki/apps/web/src/pages/SourcesPage.tsx`），实际构成文档库与数据源 1:1，「数据源」成为文档库的重复概念。其声明的四种类型中 `web`、`database` 从未实现同步 worker（`@ewiki/apps/web/src/pages/SourcesPage.tsx` 注释与 `@docs/DESIGN.md` 5.1 的 TODO），而 Git 类型的凭据早已不存于数据源、改为引用用户级的 `storage_connections`（`@ewiki/packages/db/src/schema.ts` L315-L331，GitLab/Gitea），数据源实体已退化为文档库后端的冗余包装层。

## Decision

移除独立的「数据源（Source）」概念与 `sources` 层，将 Git 仓库或本地文件夹两类存储后端下沉为文档库自身属性；「存储源」术语仅指用户级可复用连接配置，由现有 `storage_connections` 泛化而来（kind 从 `gitlab|gitea` 扩展至对象存储等后端），文档库后端仅保留 `git` 与 `local`，`web` 与 `database` 类型一并删除。

## Alternatives Considered

1. 保留 `sources` 并允许一个文档库挂多个数据源 — rejected because 当前约束为 `project_id NOT NULL` 的 1:1 绑定且产品无多后端汇入场景，保留只会延续重复概念与双份 CRUD/API 面（`/api/v1/sources` 与文档库接口并存）。
2. 将 `storage_connections` 也并入文档库字段 — rejected because GitLab/Gitea 令牌是跨多个 Git 文档库复用的用户级凭据（`owner_id NOT NULL`，见 `@ewiki/packages/db/src/schema.ts` L318-L320），并入文档库会在每库重复加密存储令牌并重复校验。
3. 保留 `web`、`database` 类型作为占位 — deferred because 二者同步从未实现（`@docs/DESIGN.md` 5.1 TODO），保留未实现枚举值会让 API 契约持续承诺不支持的能力；出现真实需求时按新 ADR 重新加入。

## Consequences

### Positive

- 概念与 API 面对齐：文档库即同步单元，新建 Git 文档库从「建库 + 建数据源」两步、至少 2 次 POST 收敛为 1 次请求 [expected]。
- 凭据收敛到存储源单一实体，令牌加密存储点从两处（`sources.config_encrypted` 与 `storage_connections.token_encrypted`）减为一处。
- 类型枚举减少 2 个永不成立的取值（`web`、`database`），前端表单与 worker 分发的死分支随之删除。

### Tradeoff

- 需要一次性破坏性迁移：删除 `sources` 表，并将 `push_tokens.source_id`、`sync_jobs.source_id`（均 NOT NULL）与可空的 `documents.source_id`（`@ewiki/packages/db/src/schema.ts` L107-L141）改挂文档库主键；开放推送路径 `/open/sources/:sourceId/push`（`@docs/DESIGN.md` 4.3 O1）必须改址，已发出的 push token 全部失效。
- 同步调度属性（`auto_sync`、`interval_seconds`）上移为文档库属性，`@docs/DESIGN.md` 中模块依赖链 `open-api → sync → sources → documents → projects` 缩短一级，相关 ER、API（S1/S2/S3）、5.1 同步流程与原型页需同步改写。
- 单库单后端被固化为不变量：同一文档库要并存 Git 与本地两个后端时无法仅靠配置实现，必须改 schema。

## Superseded when

- 出现单个文档库需从 ≥2 个异构后端同时汇入内容的需求（当前为严格 1:1 绑定，见 `sources.project_id NOT NULL`）。
- 存储连接必须被多用户共享或纳入文档库/组织级管理，而非当前的 `owner_id` 单用户归属。
- 网页抓取或数据库导出同步有了明确排期并提交可运行的 worker（当前 `web`/`database` 同步代码为零，仅枚举占位）。
