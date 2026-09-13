# AgentLens

**DevTools for AI coding agents.**

AgentLens records every observable action in a Claude Code session and turns it into an interactive timeline — so you can see exactly what your AI coding agent did, why it took so long, and where it got stuck.

---

## Quick start — Docker (recommended)

One command to install and run everything:

```bash
chmod +x scripts/install.sh && ./scripts/install.sh
```

This will:
1. Install Claude Code hooks (using `curl` — no extra dependencies)
2. Start PostgreSQL + AgentLens in Docker
3. Open `http://localhost:4040` in your browser

**Requirements:** Docker Desktop, `curl`

### Manual Docker start

```bash
docker-compose up -d
```

Then open `http://localhost:4040`.

### Stop

```bash
docker-compose down          # stop containers, keep data
docker-compose down -v       # stop and delete database
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

| Method | When | Works even if collector was off? |
|---|---|---|
| **Real-time hooks** | Every tool call while `docker-compose up` is running | No |
| **Startup import** | Every time the container starts | ✅ Yes — backfills all history |
| **Transcript watcher** | Every 5 s while container is running | ✅ Yes — picks up active sessions |

---

## Configuration

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4040` | Host port for the dashboard |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code transcript directory |
| `DATABASE_URL` | (internal) | PostgreSQL connection string |

---

## Hooks

The install script adds this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "curl -s -X POST http://localhost:4040/api/events ..."}]
    }]
  }
}
```

**The hook is a plain `curl` call** — no Node.js binary on the host. If the container is down, `curl` silently exits 0 and Claude Code continues normally.

Remove hooks:
```bash
./scripts/install.sh --uninstall-hooks
```

---

## Development (without Docker)

```bash
# Start local Postgres (or set DATABASE_URL to any Postgres)
docker run -d -e POSTGRES_PASSWORD=agentlens -e POSTGRES_USER=agentlens \
  -e POSTGRES_DB=agentlens -p 5432:5432 postgres:16-alpine

# Install deps and build
npm install

# Dev mode (server watches src/, Vite serves UI on :4041 with /api proxy)
npm run dev:server &
npm run dev:web

# Or run the built output
npm run build && node dist/cli.js start
```

---

## Roadmap

| Version | Feature |
|---|---|
| **V0.1** ✓ | Claude Code timeline · PostgreSQL · Docker |
| V0.2 | AI session analysis (retry loops, exploration overhead) |
| V0.3 | Cursor integration |
| V0.4 | Session comparison |
| V1 | Team observability (opt-in cloud) |

---

*AgentLens v0.1 — Concept / Validation*
