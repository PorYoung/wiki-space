# ewiki 内网离线容器部署指南

> 适用形态：内网（气隙/受限）环境，Docker 单主机部署 6 容器拓扑（caddy + server×2 + realtime + worker×2 + pg16-search + minio）。
> 常规在线部署见 `docs/deploy.md`；备份与回滚见 `docs/backup-rollback.md`。

## 1. 拓扑与职责

| 容器 | 镜像 | 职责 |
| --- | --- | --- |
| caddy | `caddy:2.10`（PIN） | 网关：SPA 静态（web_dist 卷）、`/api` 反代 server、`/ws` `/collab` 反代 realtime、发布站点反代 server `/sites/:slug/*` |
| server ×2 | `ewiki/app:<TAG>` | REST API + 公开发布站点（读 NAS `current.json` 指针）+ 开放 API/MCP |
| realtime ×1 | `ewiki/app:<TAG>` | WS 事件 + Yjs 协同（ydoc_snapshots 持久化） |
| worker ×2 | `ewiki/app:<TAG>` | pg-boss 队列：同步/发布/导入/检索索引/补偿 |
| migrate（任务） | `ewiki/app:<TAG>` | `drizzle-kit migrate`，幂等，每次 up 自动执行（只向前） |
| web-init（任务） | `ewiki/app:<TAG>` | 把镜像内 `apps/web/dist` 灌入 `web_dist` 卷 |
| seed（任务，profile=init） | `ewiki/app:<TAG>` | 首次部署建种子管理员 |
| pg16-search | `ewiki/pg16-search:<TAG>` | postgres:16 + pgvector + zhparser（全文/向量检索） |
| minio | `minio/minio:RELEASE.2025-04-22T22-12-26Z`（PIN） | S3 对象存储（`STORAGE_DRIVER=s3` 时启用） |

数据面：
- **NAS**（必配）：宿主机目录 bind 挂载进 server/worker 的 `/srv/nas/wiki`（用户云文档镜像 + 发布站点产物）与 `/srv/nas/wiki-platform`（平台工作数据：Git 工作副本、blob）。
- **命名卷**：`pg_data`、`minio_data`、`caddy_data`、`web_dist`。

## 2. 前提

**构建侧（可联网）**：Docker Engine ≥ 24 + Compose v2、git、bash（Windows 用 Git Bash）。pg16-search 镜像构建需访问 apt 源、github.com、xunsearch.com。

**内网侧**：Docker Engine ≥ 24 + Compose v2 插件；80/443 端口空闲；已创建 NAS 目录（如 `/srv/nas/wiki`、`/srv/nas/wiki-platform`）；（可选）内网 Ollama 服务，用于向量检索 embedding。

## 3. 构建侧：打离线包

```bash
cd ewiki
bash scripts/airgap-export.sh            # TAG 缺省 = git 短 SHA；也可显式 bash scripts/airgap-export.sh v1.0.0
```

产出 `deploy/airgap/`：

```
ewiki-images-<TAG>.tar.gz      # 全部镜像（层去重）：app / pg16-search / postgres:16.9 / caddy / minio
ewiki-images-<TAG>.tar.gz.sha256
config-<TAG>.tar.gz            # deploy/ 配置 + 离线部署/备份文档（不含 .env.production，密钥不出构建侧）
MANIFEST-<TAG>.txt             # 镜像清单（imageID/RepoDigest/大小）
load.sh                        # 内网侧导入脚本
```

将整个 `deploy/airgap/` 目录拷贝进内网（U 盘/摆渡工具均可）。

## 4. 内网侧：部署

```bash
# 1) 导入镜像（含 sha256 校验）
cd deploy/airgap && bash load.sh

# 2) 放置配置并生成生产环境文件
mkdir -p /srv/ewiki && tar xzf config-*.tar.gz -C /srv/ewiki
cd /srv/ewiki
cp deploy/.env.production.example deploy/.env.production
vi deploy/.env.production     # 必改：JWT_SECRET、ENCRYPTION_KEY、POSTGRES_PASSWORD、MINIO_ROOT_PASSWORD、
                              #      NAS_HOST_ROOT / PLATFORM_DATA_HOST_ROOT 指向真实 NAS 目录
#    如接内网 Ollama 向量检索：
#      EMBEDDING_PROVIDER=openai-compatible
#      EMBEDDING_BASE_URL=http://<ollama-host>:11434/v1

# 3) 启动（migrate 自动执行，web-init 自动灌前端产物）
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d

# 4) 首次部署：建种子管理员（admin@ewiki.local / ewiki-admin，上线后立即改密）
docker compose --env-file deploy/.env.production -f deploy/compose.yml --profile init run --rm seed

# 5) 验证
docker compose --env-file deploy/.env.production -f deploy/compose.yml ps      # 全部 healthy / 迁移任务 exited 0
curl -s http://localhost/api/v1/healthz 2>/dev/null || curl -s http://localhost/healthz
```

浏览器访问 `http://<内网主机>/`（生产建议配置 DNS 解析 `ewiki.yfzx.cn`；子域名发布形态另需泛域名解析与 TLS，见 Caddyfile on_demand_tls 说明）。

## 5. 内网开发设施（compose.dev）

内网开发机同样离线可用（postgres:16.9 与 minio 镜像已包含在离线包内）：

```bash
tar xzf config-*.tar.gz -C ~/ewiki && cd ~/ewiki
docker compose -f deploy/compose.dev.yml up -d     # PostgreSQL + MinIO
# 应用进程按 docs/deploy.md 第 2 节以 pnpm 运行（依赖安装见下方 FAQ）
```

## 6. 升级与回滚

- **升级**：构建侧对新提交重跑 `airgap-export.sh <新TAG>` → 内网 `load.sh` → `TAG=<新TAG> docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d`（migrate 幂等自动执行）。
- **回滚**：保留旧版离线包，`TAG=<旧TAG>` 重新 `up -d` 即可；数据库遵循**迁移只向前**（回滚代码不回滚表结构，兼容窗口 ≥ 1 个版本）。
- **数据备份/恢复**：见 `docs/backup-rollback.md`（pg_data 卷 + NAS 目录双备份）。

## 7. FAQ

- **为什么 pg16-search 必须在构建侧编译？** zhparser/SCWS 无官方二进制镜像，需在联网环境源码编译进镜像；离线包以内 `docker load` 导入后内网无需任何编译。
- **内网 pnpm install 怎么办（开发形态）？** 生产容器化运行不需要；开发机可在构建侧 `pnpm deploy` 或直接把 `node_modules` 随仓库摆渡，或搭建内网 npm registry（verdaccio）。
- **server 副本数**：启用 Git 直连源（保存自动 commit+push，工作副本在共享 NAS）时建议 `docker compose up -d --scale server=1`，避免两副本并发操作同一 Git 工作副本；纯云文档形态可保持 2 副本。
- **镜像校验**：导入前后均可 `docker image inspect <镜像> --format '{{.Id}}'` 与包内 `MANIFEST-<TAG>.txt` 比对。
- **基础镜像版本**：`caddy:2.10`、`minio/minio:RELEASE.2025-04-22T22-12-26Z`、`postgres:16.9` 为当前 PIN，升级时同步修改 `deploy/compose.yml` 与 `scripts/airgap-export.sh` 并重新打包。
