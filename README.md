# AgentLens

**DevTools for AI coding agents.**

AgentLens records every observable action in a Claude Code session and turns it into an interactive timeline - so you can see exactly what your AI coding agent did, why it took so long, and where it got stuck.

---

## Install

### Option 1 - One command (Docker, recommended)

```bash
curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/main/scripts/install.sh | bash
```

Installs Claude Code hooks + starts PostgreSQL + AgentLens in Docker.  
Opens `http://localhost:4040` automatically.

**Or pull the image from Docker Hub:**

```bash
docker pull ratheshprabakar/agentlens:v1.0.0
```

Image: [ratheshprabakar/agentlens](https://hub.docker.com/r/ratheshprabakar/agentlens)

**Requirements:** Docker Desktop · `curl`

### Option 2 - CLI binary (no Docker needed for hook management)

```bash
# macOS Apple Silicon
curl -Lo agentlens https://github.com/Ratheshprabakar/AgentLens/releases/latest/download/agentlens-macos-arm64
chmod +x agentlens && sudo mv agentlens /usr/local/bin/

# macOS Intel
curl -Lo agentlens https://github.com/Ratheshprabakar/AgentLens/releases/latest/download/agentlens-macos-x64
chmod +x agentlens && sudo mv agentlens /usr/local/bin/

# Linux x64
curl -Lo agentlens https://github.com/Ratheshprabakar/AgentLens/releases/latest/download/agentlens-linux-x64
chmod +x agentlens && sudo mv agentlens /usr/local/bin/
```

Self-contained binary - no Node.js, no Bun, no nothing required on the host.

```bash
agentlens install      # install Claude Code hooks
agentlens status       # check hook installation
agentlens import       # import historical sessions
```

> **Full server + UI:** Use Docker (Option 1). The binary is primarily for hook management.

### Option 3 - npm / npx

```bash
# Run without installing
npx agentlens install

# Or install globally
npm install -g agentlens
agentlens install
```

---

## Stop / uninstall

```bash
docker compose -f docker-compose.prod.yml down          # stop, keep data
docker compose -f docker-compose.prod.yml down -v       # stop + delete database

./scripts/install.sh --uninstall-hooks                  # remove Claude Code hooks
```

---

## How it works

```
Claude Code (any session on your machine)
        │
        ▼  Claude Code hooks fire on every tool call
   curl → POST http://localhost:4040/api/events
        │
        ▼
┌─────────────────────────────────────┐
│           Docker                    │
│                                     │
│  ┌──────────────────────────────┐   │
│  │  AgentLens App (Node.js)    │   │
│  │  • Ingest events from hooks │   │
│  │  • Parse transcripts        │   │
│  │  • Serve React UI           │   │
│  └──────────┬───────────────────┘   │
│             │                       │
│  ┌──────────▼───────────────────┐   │
│  │  PostgreSQL                  │   │
│  │  (persistent via pgdata vol) │   │
│  └──────────────────────────────┘   │
│                                     │
│  Volume mounts:                     │
│    ~/.claude/projects → /claude-projects (read-only)
│    pgdata             → postgres data
└─────────────────────────────────────┘
```

### Three ways sessions get captured

| Method                 | When                                                 | Works even if collector was off?  |
| ---------------------- | ---------------------------------------------------- | --------------------------------- |
| **Real-time hooks**    | Every tool call while `docker-compose up` is running | No                                |
| **Startup import**     | Every time the container starts                      | ✅ Yes - backfills all history    |
| **Transcript watcher** | Every 5 s while container is running                 | ✅ Yes - picks up active sessions |

---

## Configuration

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

| Variable              | Default              | Description                      |
| --------------------- | -------------------- | -------------------------------- |
| `PORT`                | `4040`               | Host port for the dashboard      |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code transcript directory |
| `DATABASE_URL`        | (internal)           | PostgreSQL connection string     |

---

## Hooks

The install script adds this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:4040/api/events ..."
          }
        ]
      }
    ]
  }
}
```

**The hook is a plain `curl` call** - no Node.js binary on the host. If the container is down, `curl` silently exits 0 and Claude Code continues normally.

Remove hooks:

```bash
./scripts/install.sh --uninstall-hooks
```

---

## Marketing site

The product landing page lives in [`landing/`](landing/) - a **separate** Vite + React app for promotion and install CTAs. It is **not** bundled into the Docker Hub image.

```bash
cd landing && pnpm install && pnpm run dev   # http://localhost:4050
```

Docker install still only starts Postgres + the dashboard UI (`web/`).

From the repo root you can also run:

```bash
pnpm install
pnpm run dev:landing
```

---

## Development (without Docker)

Requires [Bun](https://bun.sh) ≥ 1.0 for the server runtime and [pnpm](https://pnpm.io) ≥ 9 for installs.

```bash
# Start local Postgres
docker run -d -e POSTGRES_PASSWORD=agentlens -e POSTGRES_USER=agentlens \
  -e POSTGRES_DB=agentlens -p 5432:5432 postgres:16-alpine

export DATABASE_URL=postgresql://agentlens:agentlens@localhost:5432/agentlens

# Install deps
pnpm install

# Dev mode - Bun watches src/, Vite serves UI on :4041 with /api proxy
pnpm run dev:server &   # hot-reloads TypeScript automatically
pnpm run dev:web        # Vite HMR

# Or run directly
bun src/cli.ts start
```

> **No build step for the server.** Bun runs `.ts` files natively. Only the React UI
> needs to be built (`pnpm run build:web`) when deploying without Docker.

---

## Roadmap

| Version    | Feature                                                 |
| ---------- | ------------------------------------------------------- |
| **V0.1** ✓ | Claude Code + Cursor timelines · PostgreSQL · Docker    |
| V0.2       | AI session analysis (retry loops, exploration overhead) |
| V0.3       | Codex / Gemini CLI integration                          |
| V0.4       | Session comparison                                      |
| V1         | Team observability (opt-in cloud)                       |

---

_AgentLens v1.0.0_
