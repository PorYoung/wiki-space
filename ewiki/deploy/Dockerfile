# 单镜像多入口（ENGINEERING 第 4 章）：ENTRYPOINT 由 compose command 覆盖
# server / realtime / worker 共用本镜像，版本永远一致
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/editor/package.json packages/editor/package.json
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
ENTRYPOINT ["node", "apps/server/dist/index.js"]
