# ─── Stage 1: Build ────────────────────────────────────────────────────────────
# Compiles TypeScript server + builds Vite web UI

FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies (including devDeps for build)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY web/ ./web/

RUN npm run build

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean image — only production dependencies + compiled output

FROM node:22-alpine AS runtime

WORKDIR /app

# Install only prod dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Mount point for Claude Code transcripts
RUN mkdir -p /claude-projects

EXPOSE 4040

# Environment defaults (overridden by docker-compose)
ENV NODE_ENV=production \
    PORT=4040 \
    CLAUDE_PROJECTS_DIR=/claude-projects

CMD ["node", "dist/cli.js", "start", "--no-open"]
