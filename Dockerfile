# Web UI is static JS - build once on the host CPU (avoids QEMU + esbuild crashes).
# Runtime is multi-arch (bun binary + prod deps + embedded Postgres per target).

FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY landing/package.json ./landing/
RUN pnpm install --frozen-lockfile --filter agentlens...

COPY tsconfig.json vite.config.ts ./
COPY web/ ./web/
RUN pnpm run build:web

# ─── Bun runtime + embedded Postgres (per target platform) ────────────────────
FROM oven/bun:1-alpine AS runtime

RUN apk add --no-cache \
      postgresql \
      postgresql-contrib \
      su-exec \
      curl \
    && mkdir -p /var/lib/postgresql/data /var/run/postgresql \
         /claude-projects /cursor-projects \
    && chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql

WORKDIR /app

COPY package.json ./
RUN bun install --production \
  && rm -rf /root/.bun/install/cache \
  && find node_modules -name "*.md" -delete \
  && find node_modules -name "*.map" -delete \
  && find node_modules -type d -name "test" -prune -exec rm -rf {} + 2>/dev/null || true \
  && find node_modules -type d -name "tests" -prune -exec rm -rf {} + 2>/dev/null || true

COPY src/ ./src/
COPY docker/ ./docker/
COPY --from=builder /app/dist/web ./dist/web
RUN chmod +x /app/docker/entrypoint.sh \
  && ln -sf /app/docker/entrypoint.sh /entrypoint.sh

EXPOSE 4040

VOLUME ["/var/lib/postgresql/data"]

ENV NODE_ENV=production \
    PORT=4040 \
    PGDATA=/var/lib/postgresql/data \
    CLAUDE_PROJECTS_DIR=/claude-projects \
    CURSOR_PROJECTS_DIR=/cursor-projects

ENTRYPOINT ["/entrypoint.sh"]
