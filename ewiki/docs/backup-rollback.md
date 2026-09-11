# 备份与回滚方案

## 1. 备份对象与 RPO/RTO

| 对象 | 方式 | 频率建议 | 说明 |
| --- | --- | --- | --- |
| PostgreSQL（用户/文档/版本/台账等全部业务数据） | `pg_dump -Fc` 逻辑备份 | 每日 1 次 + 变更前 | 唯一结构化数据源 |
| NAS 存储目录（云文档镜像、发布站点产物） | 目录打包 zip | 每日 1 次 | 可由 PG 中内容重建，但直接打包恢复更快 |

- **RPO**：≤ 1 天（按建议频率）；关键变更（如存储根目录切换）前手动备份一次。
- **RTO**：单机 ≤ 30 分钟（解包 + pg_restore + 重启进程）。

## 2. 备份脚本

```powershell
pwsh scripts/backup.ps1                       # 默认输出到 ewiki\backups\
pwsh scripts/backup.ps1 -Dest D:\backups -NasRoot D:\nas\wiki
```

产物：`backups/backup-<时间戳>.zip`（内含 `db-*.dump` + `nas-*.zip`）。

> 本脚本刻意**不含任何删除命令**（AutoClaw 安全约束）。保留策略：人工保留最近 7 份，清理命令：
> `Get-ChildItem backups -Filter backup-*.zip | Sort-Object LastWriteTime -Descending | Select-Object -Skip 7 | Remove-Item -Force`

## 3. 恢复流程

### 3.1 恢复演练（不动原库，推荐先做）

```powershell
$ts = Get-Date -Format 'HHmmss'; $scratch = "ewiki_restore_check_$ts"
Expand-Archive backups\backup-<ts>.zip -DestinationPath <tmp>
docker cp <tmp>\db-<ts>.dump ewiki-pg:/tmp/restore.dump
docker exec ewiki-pg sh -c "createdb -U ewiki $scratch && pg_restore -U ewiki -d $scratch /tmp/restore.dump; psql -U ewiki -d $scratch -t -c 'select count(*) from users;'"
docker exec ewiki-pg sh -c "dropdb -U ewiki --if-exists $scratch; rm -f /tmp/restore.dump"
```

### 3.2 完整回滚（覆盖原库 + NAS）

1. 停止 server / worker / realtime 进程；
2. `docker exec ewiki-pg sh -c "pg_restore -U ewiki --clean --if-exists -d ewiki /tmp/restore.dump"`；
3. NAS：将备份内 `nas-*.zip` 解包覆盖 `FS_NAS_ROOT`（覆盖前将现目录改名留存）；
4. 重启进程，`GET /healthz` + 登录抽验。

### 3.3 演练记录（2026-09-09）

- 备份：`backups/backup-20260909-222131.zip`（96 KB，db dump + NAS zip）。
- 恢复演练：还原到临时库 `ewiki_restore_check_*`，校验 `users=4`、`documents=69`、`storage_connections=8`，与原库一致；原库未受影响，临时库已清理。✅

## 4. 特别说明

- 平台设置「存储根目录（NAS）」变更会写入 `platform_settings` 表并进审计；回滚数据库即随之回滚该设置，**NAS 物理目录不会被脚本改动**（恢复 NAS 用 3.2 第 3 步）。
- Git 仓库本身在 GitLab/Gitea 服务端，不在本平台备份范围；平台内 `apps/server/data/repos/<sourceId>/` 为工作副本，可随时用连接配置重新克隆。
