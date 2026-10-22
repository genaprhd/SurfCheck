FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @surf-check/shared build \
  && pnpm --filter @surf-check/api build \
  && pnpm --filter @surf-check/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8777 \
    SURF_CHECK_SPOTS_FILE=/data/surf_check_spots.json

WORKDIR /app

COPY --from=build --chown=node:node /out/ ./
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 8777

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8777/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
