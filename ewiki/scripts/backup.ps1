# ---------------------------------------------------------------------------
# ewiki 平台备份脚本（备份与回滚方案 · 演练脚本）
# 内容：PostgreSQL 逻辑备份（pg_dump -Fc）+ NAS 存储目录打包 → backups/backup-<ts>.zip
# 用法：pwsh scripts/backup.ps1 [-Dest D:\backups]
# 说明：脚本刻意不含任何删除/清理命令（AutoClaw 安全约束）；过期备份请按
#       docs/backup-rollback.md 中的保留策略人工清理（保留最近 7 份）。
# ---------------------------------------------------------------------------

param(
  [string]$Dest = "D:\works\wiki-space\ewiki\backups",
  [string]$PgContainer = "ewiki-pg",
  [string]$PgUser = "ewiki",
  [string]$PgDb = "ewiki",
  [string]$NasRoot = "D:\works\wiki-space\ewiki\data-nas"
)

$ErrorActionPreference = 'Stop'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$work = Join-Path $Dest "_work-$ts"
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Host "[1/3] PostgreSQL 逻辑备份（$PgContainer / $PgDb）"
docker exec $PgContainer sh -c "pg_dump -U $PgUser -d $PgDb -Fc > /tmp/ewiki-dump-$ts.dump"
if ($LASTEXITCODE -ne 0) { throw "pg_dump 失败" }
docker cp "${PgContainer}:/tmp/ewiki-dump-$ts.dump" (Join-Path $work "db-$ts.dump")
if ($LASTEXITCODE -ne 0) { throw "docker cp 失败" }

Write-Host "[2/3] NAS 存储目录打包（$NasRoot）"
if (Test-Path $NasRoot) {
  Compress-Archive -Path "$NasRoot\*" -DestinationPath (Join-Path $work "nas-$ts.zip") -Force
} else {
  Write-Warning "NAS 目录不存在，跳过：$NasRoot"
}

Write-Host "[3/3] 归档"
$zip = Join-Path $Dest "backup-$ts.zip"
Compress-Archive -Path (Join-Path $work "*") -DestinationPath $zip -Force

$size = (Get-Item $zip).Length
Write-Host "备份完成：$zip（$([Math]::Round($size/1KB,1)) KB）"
Write-Host "中间目录 $work 可人工核对后删除（脚本不做删除操作）。"
