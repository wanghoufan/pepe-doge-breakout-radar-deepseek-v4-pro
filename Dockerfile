# pepe-doge-breakout-radar ｜ Next.js 自定义 server（src/server.ts）生产镜像
# 构建逻辑对齐 scripts/build.sh：pnpm install → next build → tsup dist/server.js
# node:sqlite 需 Node>=22.5，本地为 v24，镜像统一 24-slim
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm next build
RUN pnpm tsup src/server.ts --format cjs --platform node --target node24 --outDir dist --no-splitting --no-minify
# tsup/esbuild 外部化 node:sqlite 时剥掉 node: 前缀，补回（否则 Node24 运行时 MODULE_NOT_FOUND）
RUN grep -q 'require("node:sqlite")' dist/server.js || sed -i 's/require("sqlite")/require("node:sqlite")/g' dist/server.js

FROM base AS runner
ENV NODE_ENV=production \
    COZE_PROJECT_ENV=PROD \
    HOSTNAME=0.0.0.0 \
    PORT=5000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db
EXPOSE 5000
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/market/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
