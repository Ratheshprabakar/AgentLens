#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AgentLens — One-command installer
#
# What this script does:
#   1. Installs Claude Code hooks (curl-based — no Node.js dependency on host)
#   2. Starts AgentLens via docker-compose
#   3. Opens the dashboard in your browser
#
# Usage:
#   chmod +x scripts/install.sh && ./scripts/install.sh
#
# To uninstall hooks only:
#   ./scripts/install.sh --uninstall-hooks
# ─────────────────────────────────────────────────────────────────────────────

set -e

AGENTLENS_PORT="${PORT:-4040}"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
COLLECTOR_URL="http://localhost:${AGENTLENS_PORT}/api/events"

# ── Colors ────────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

banner() {
  echo ""
  echo -e "${BOLD}  AgentLens v0.1${RESET}  ${DIM}DevTools for AI coding agents${RESET}"
  echo -e "${DIM}  ─────────────────────────────────────────────${RESET}"
}

# ── Uninstall mode ────────────────────────────────────────────────────────────

if [[ "$1" == "--uninstall-hooks" ]]; then
  banner
  echo -e "\n  Removing Claude Code hooks from ${DIM}${CLAUDE_SETTINGS}${RESET}…"
  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    # Use Python (always available on macOS) to remove the hook entries
    python3 - <<PYEOF
import json, sys

path = "$CLAUDE_SETTINGS"
try:
    with open(path) as f:
        settings = json.load(f)
except:
    sys.exit(0)

hooks = settings.get("hooks", {})
for hook_type in ["PostToolUse", "PreToolUse", "Stop", "Notification"]:
    if hook_type in hooks:
        hooks[hook_type] = [
            m for m in hooks[hook_type]
            if not any("agentlens" in h.get("command", "") for h in m.get("hooks", []))
        ]
        if not hooks[hook_type]:
            del hooks[hook_type]

settings["hooks"] = hooks
with open(path, "w") as f:
    json.dump(settings, f, indent=2)
print("  Hooks removed.")
PYEOF
    echo -e "  ${GREEN}✓${RESET} Hooks removed from ${DIM}${CLAUDE_SETTINGS}${RESET}"
  else
    echo -e "  ${YELLOW}⚠${RESET}  Settings file not found — nothing to remove."
  fi
  echo ""
  exit 0
fi

# ── Main install ──────────────────────────────────────────────────────────────

banner

# ── 1. Check prerequisites ───────────────────────────────────────────────────

echo -e "\n  ${DIM}Checking prerequisites…${RESET}"

if ! command -v docker &>/dev/null; then
  echo -e "\n  ${RED}✗${RESET} Docker not found."
  echo -e "  Install Docker Desktop from ${DIM}https://docker.com/get-started${RESET}"
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Docker found"

if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
  echo -e "\n  ${RED}✗${RESET} docker-compose not found."
  echo -e "  Update Docker Desktop to a version that includes Compose v2."
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} docker-compose found"

if ! command -v curl &>/dev/null; then
  echo -e "\n  ${RED}✗${RESET} curl not found (required for hooks)."
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} curl found"

# ── 2. Install Claude Code hooks ─────────────────────────────────────────────

echo -e "\n  ${DIM}Installing Claude Code hooks…${RESET}"

mkdir -p "$HOME/.claude"

# The hook command: pipe stdin (hook JSON) directly to the AgentLens collector.
# curl exits 0 even if collector is down (2>/dev/null), so Claude Code is never blocked.
HOOK_CMD="curl -s -X POST ${COLLECTOR_URL} -H 'Content-Type: application/json' -d @- 2>/dev/null; true"

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
  echo '{}' > "$CLAUDE_SETTINGS"
fi

python3 - <<PYEOF
import json, sys

path = "$CLAUDE_SETTINGS"
hook_cmd = "$HOOK_CMD"
hook_types = ["PostToolUse", "PreToolUse", "Stop", "Notification"]

def has_agentlens(matchers):
    return any(
        "agentlens" in h.get("command", "")
        for m in (matchers or [])
        for h in m.get("hooks", [])
    )

try:
    with open(path) as f:
        settings = json.load(f)
except:
    settings = {}

settings.setdefault("hooks", {})
installed = []

for hook_type in hook_types:
    settings["hooks"].setdefault(hook_type, [])
    if not has_agentlens(settings["hooks"][hook_type]):
        settings["hooks"][hook_type].append({
            "matcher": "",
            "hooks": [{"type": "command", "command": hook_cmd}]
        })
        installed.append(hook_type)

with open(path, "w") as f:
    json.dump(settings, f, indent=2)

if installed:
    print(f"  Installed hooks: {', '.join(installed)}")
else:
    print("  Hooks already installed.")
PYEOF

echo -e "  ${GREEN}✓${RESET} Claude Code hooks configured"
echo -e "  ${DIM}  Settings: ${CLAUDE_SETTINGS}${RESET}"
echo -e "  ${DIM}  Hook: POST http://localhost:${AGENTLENS_PORT}/api/events${RESET}"

# ── 3. Start docker-compose ───────────────────────────────────────────────────

echo -e "\n  ${DIM}Starting AgentLens containers…${RESET}"

# Use docker compose (v2) if available, fall back to docker-compose (v1)
COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
fi

# Determine the script directory (works whether run from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"
$COMPOSE_CMD up -d --build

echo -e "  ${GREEN}✓${RESET} Containers started"

# ── 4. Wait for app to be ready ───────────────────────────────────────────────

echo -e "\n  ${DIM}Waiting for AgentLens to be ready…${RESET}"

READY=0
for i in $(seq 1 24); do
  if curl -sf "http://localhost:${AGENTLENS_PORT}/api/health" &>/dev/null; then
    READY=1
    break
  fi
  sleep 2
done

if [[ $READY -eq 0 ]]; then
  echo -e "  ${YELLOW}⚠${RESET}  AgentLens didn't respond within 48s."
  echo -e "  ${DIM}  Check logs: docker compose logs -f app${RESET}"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} AgentLens is ready"

# ── 5. Open browser ───────────────────────────────────────────────────────────

DASHBOARD="http://localhost:${AGENTLENS_PORT}"

echo ""
echo -e "${BOLD}  ✓ AgentLens is running!${RESET}"
echo ""
echo -e "  Dashboard:  ${DIM}${DASHBOARD}${RESET}"
echo -e "  API:        ${DIM}${DASHBOARD}/api/sessions${RESET}"
echo -e "  DB:         ${DIM}postgres on agentlens-db container${RESET}"
echo ""
echo -e "  ${DIM}Stop:    docker compose down${RESET}"
echo -e "  ${DIM}Logs:    docker compose logs -f app${RESET}"
echo -e "  ${DIM}Hooks:   ./scripts/install.sh --uninstall-hooks${RESET}"
echo ""

# Open the dashboard
if command -v open &>/dev/null; then
  open "$DASHBOARD"       # macOS
elif command -v xdg-open &>/dev/null; then
  xdg-open "$DASHBOARD"  # Linux
fi
