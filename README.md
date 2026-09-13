# AgentLens

**DevTools for AI coding agents.**

AgentLens records every observable action in a Claude Code session and turns it into an interactive timeline — so you can see exactly what your AI coding agent did, why a session took so long, and where it got stuck.

## Quick start

```bash
# 1. Install dependencies & build
npm install && npm run build

# 2. Install Claude Code hooks
node dist/cli.js install

# 3. Start the collector and open the dashboard
node dist/cli.js start
```

The dashboard opens at **http://localhost:4040**.

Now run Claude Code as usual. Each session is automatically recorded and appears in the dashboard.

## CLI commands

| Command | Description |
|---|---|
| `agentlens start` | Start collector + open dashboard |
| `agentlens install` | Install Claude Code hooks |
| `agentlens uninstall` | Remove hooks |
| `agentlens status` | Show hook status |

## How it works

```
Claude Code
    │
    ▼ hooks (PreToolUse / PostToolUse / Stop)
AgentLens Hook Script
    │  (reads JSON from stdin, POSTs to collector)
    ▼
AgentLens Collector  (localhost:4040)
    │
    ▼
SQLite  (~/.agentlens/agentlens.db)
    │
    ▼
React Timeline UI
```

The hook script (`agentlens-hook`) is called by Claude Code for every tool use. It runs in < 100 ms and never blocks Claude Code — if the collector is not running, the event is silently dropped.

## Common Event Model

Every Claude Code tool call is normalized to an `AgentEvent`:

```typescript
type AgentEvent = {
  id: string;
  sessionId: string;
  agent: "claude-code" | string;
  timestamp: number;
  type: "session_start" | "file_read" | "file_edit" | "shell" |
        "test_run" | "search" | "web" | "error" | "subagent" | ...;
  file?: string;
  command?: string;
  query?: string;
  exitCode?: number;
  additions?: number;
  deletions?: number;
  success?: boolean;
  // ...
};
```

## Development

```bash
# Run server in watch mode (no static file serving)
npm run dev:server

# Run Vite dev server for UI (proxies /api to :4040)
npm run dev:web
```

## Data

Sessions are stored at `~/.agentlens/agentlens.db` (SQLite). Nothing leaves your machine unless you explicitly enable cloud sync (coming in V1).

## Roadmap

| Version | Feature |
|---|---|
| **V0.1** ✓ | Claude Code timeline — this release |
| V0.2 | AI session analysis (retry loops, exploration overhead) |
| V0.3 | Cursor integration |
| V0.4 | Session comparison |
| V1 | Team observability (opt-in cloud) |

---

*AgentLens v0.1 — Concept / Validation*
