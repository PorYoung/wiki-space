# 单镜像多入口（ENGINEERING 第 4 章）：ENTRYPOINT 由 compose command 覆盖
# server / realtime / worker 共用本镜像，版本永远一致
#
# 注意：deps 阶段的 COPY 清单必须与 pnpm-lock.yaml 的 importers 保持一致
# （apps/server realtime worker web + packages/db git mcp render shared storage theme）。
# 新增/删除 workspace 包时同步更新本清单，否则 --frozen-lockfile 安装失败。
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/git/package.json packages/git/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/theme/package.json packages/theme/package.json
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm -r build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./
# 缺省入口为 server；compose 的 command: 会覆盖 CMD（web-init/migrate/seed/realtime/worker 同理）。
# 注意不能用 ENTRYPOINT：compose command 与 ENTRYPOINT 是拼接而非覆盖。
CMD ["node", "apps/server/dist/index.js"]
