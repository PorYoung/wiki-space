#!/usr/bin/env bash
# ============================================================
# ewiki 内网离线交付打包（在【可联网】的构建机上执行）
#
# 产出 deploy/airgap/：
#   ewiki-images-<TAG>.tar.gz   全部镜像（层去重）：app / pg16-search / postgres / caddy / minio
#   config-<TAG>.tar.gz         部署配置（deploy/ + docs/offline-deploy.md，不含任何 .env.production）
#   MANIFEST-<TAG>.txt          镜像清单（tag / imageID / RepoDigest / 大小）+ sha256
#   load.sh                     内网侧导入脚本
#
# 用法：
#   bash scripts/airgap-export.sh [TAG]        # TAG 缺省 = git 短 SHA
#
# 注意：
#   - pg16-search 构建需要外网（apt、github、xunsearch 源码编译 pgvector/SCWS/zhparser），
#     首次构建约 5-15 分钟；该镜像构建后可本地缓存，重复打包会走 docker 构建缓存。
#   - 基础镜像 PIN 必须与 deploy/compose.yml 保持一致。
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${1:-$(git rev-parse --short HEAD)}"
OUT="$ROOT/deploy/airgap"
mkdir -p "$OUT"

# ---- 基础镜像 PIN（与 deploy/compose.yml 同步修改） ----
CADDY_IMAGE="caddy:2.10"
MINIO_IMAGE="minio/minio:RELEASE.2025-04-22T22-12-26Z"
PG_DEV_IMAGE="postgres:16.9" # 内网开发设施（compose.dev.yml）用

APP_IMAGE="ewiki/app:$TAG"
PG_SEARCH_IMAGE="ewiki/pg16-search:$TAG"

echo "==> [1/6] 构建应用镜像（单镜像多入口：server/realtime/worker/web 产物）"
docker build -f deploy/Dockerfile -t "$APP_IMAGE" .

echo "==> [2/6] 构建检索扩展 PG 镜像（postgres:16 + pgvector + zhparser，需外网）"
docker build -f deploy/postgres/Dockerfile -t "$PG_SEARCH_IMAGE" deploy/postgres

echo "==> [3/6] 拉取固定版本基础镜像"
docker pull "$CADDY_IMAGE"
docker pull "$MINIO_IMAGE"
docker pull "$PG_DEV_IMAGE"

echo "==> [4/6] 导出镜像（层去重，单 tar）"
IMAGES_TAR="$OUT/ewiki-images-$TAG.tar.gz"
docker save "$APP_IMAGE" "$PG_SEARCH_IMAGE" "$PG_DEV_IMAGE" "$CADDY_IMAGE" "$MINIO_IMAGE" | gzip > "$IMAGES_TAR"

echo "==> [5/6] 生成清单 / 校验和 / 导入脚本"
MANIFEST="$OUT/MANIFEST-$TAG.txt"
{
  echo "# ewiki 离线包清单  TAG=$TAG  生成时间=$(date -u +%FT%TZ)"
  echo "# 在内网执行: bash load.sh"
  for img in "$APP_IMAGE" "$PG_SEARCH_IMAGE" "$PG_DEV_IMAGE" "$CADDY_IMAGE" "$MINIO_IMAGE"; do
    printf '%s\n' "$img"
    docker image inspect "$img" --format '  imageID={{.Id}}  size={{.Size}}  digest={{json .RepoDigests}}'
  done
} > "$MANIFEST"
sha256sum "$IMAGES_TAR" > "$IMAGES_TAR.sha256"

cat > "$OUT/load.sh" <<'LOAD'
#!/usr/bin/env bash
# 内网侧导入：解出本目录后执行 `bash load.sh`，随后按 docs/offline-deploy.md 继续部署
set -euo pipefail
cd "$(dirname "$0")"
TAR="$(ls ewiki-images-*.tar.gz | head -n1)"
echo "==> 校验 $TAR"
sha256sum -c "$TAR.sha256"
echo "==> docker load（可能需要数分钟）"
gunzip -c "$TAR" | docker load
echo "==> 完成。下一步："
echo "    1) tar xzf config-*.tar.gz -C /srv/ewiki   # 或按需放置 deploy/ 与文档"
echo "    2) cd /srv/ewiki && cp deploy/.env.production.example deploy/.env.production 并修改密钥"
echo "    3) docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d"
echo "    4) 首次建种子管理员: docker compose --env-file deploy/.env.production -f deploy/compose.yml --profile init run --rm seed"
LOAD
chmod +x "$OUT/load.sh"

CONFIG_TAR="$OUT/config-$TAG.tar.gz"
# 显式排除 .env.production：离线包只携带模板，密钥在内网侧生成
tar czf "$CONFIG_TAR" --exclude='deploy/.env.production' --exclude='deploy/airgap' \
  deploy/Caddyfile deploy/Dockerfile deploy/compose.yml deploy/compose.dev.yml \
  deploy/.env.production.example deploy/postgres docs/offline-deploy.md docs/backup-rollback.md

echo "==> [6/6] 完成。离线包内容（deploy/airgap/）："
ls -lh "$IMAGES_TAR" "$IMAGES_TAR.sha256" "$CONFIG_TAR" "$MANIFEST" "$OUT/load.sh"
echo "传输到内网后：解压整个 airgap 目录 → bash load.sh → 按 docs/offline-deploy.md 部署。"
