<p align="center">
  <strong>AgentLens</strong><br/>
  DevTools for AI coding agents
</p>

<p align="center">
  Your coding agent has a timeline. You just couldn’t see it.
</p>

<p align="center">
  <a href="https://tryagentlens.vercel.app">Website</a> ·
  <a href="https://hub.docker.com/r/ratheshprabakar/agentlens">Docker Hub</a> ·
  <a href="#quick-start">Install</a>
</p>

<p align="center">
  <img src="docs/hero.png" alt="AgentLens dashboard - live session timeline" width="920" />
</p>

---

AgentLens turns opaque agent sessions into a **local, scannable timeline** - every prompt, file read, edit, shell command, and search, in order - so you can see where time went and where the agent got stuck.

Runs on your machine. No account. No cloud upload.

## Why

Long agent runs burn time and tokens, then leave you guessing. AgentLens gives you the same clarity DevTools gave the browser: a timeline you can scrub, not a wall of logs.

## Features

- **Live timeline** - Watch the next agent run as it happens
- **Find the loop** - Spot thrash, dead ends, and the step that burned the time
- **Import history** - Rebuild past sessions without replaying them
- **Local by default** - Data stays on your box

## Supported agents

| Agent                                 | Mode            |
| ------------------------------------- | --------------- |
| [Claude Code](https://claude.ai/code) | Live capture    |
| [Cursor](https://cursor.com)          | Import sessions |

More agents coming.

## Quick start

**Requires:** [Docker Desktop](https://www.docker.com/get-started/) and `curl`.

```bash
curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/master/scripts/install.sh | bash
```

One command will:

1. Pull the AgentLens image
2. Start the app (database included)
3. Wire up Claude Code live capture
4. Open the dashboard at **http://localhost:4040**

Port `4040` already in use?

```bash
PORT=4050 curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/master/scripts/install.sh | bash
```

## After install

1. Keep the **agentlens** container running in Docker Desktop (or start it when you need it)
2. Open the dashboard in your browser
3. Use your coding agent as usual - sessions appear on the timeline

You only re-run the install command to update, or if you removed the container.

## How it works

```text
Coding agent  ──hooks──▶  AgentLens (Docker)  ──▶  Local timeline UI
                              │
                              └── embedded database (persisted)
```

Sessions are captured three ways:

| Path               | What it does                                   |
| ------------------ | ---------------------------------------------- |
| **Live hooks**     | Stream events while the agent runs             |
| **Startup import** | Backfill history when the container starts     |
| **Watcher**        | Pick up growing transcript files while running |

## Stop / uninstall

```bash
docker stop agentlens          # pause
docker rm agentlens            # remove container (keeps data)
docker volume rm agentlens-data   # delete stored sessions

# Remove Claude Code hooks only
curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/master/scripts/install.sh | bash -s -- --uninstall-hooks
```

---

<p align="center">
  <a href="https://tryagentlens.vercel.app">tryagentlens.vercel.app</a>
  · Made with love by <a href="https://linkedin.com/in/Ratheshprabakar">Rathesh Prabakar</a>
</p>
