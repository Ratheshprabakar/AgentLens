#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AgentLens - One-command installer (industry-standard curl | bash)
#
# What this script does:
#   1. Installs Claude Code hooks on the host
#   2. Pulls the AgentLens image and starts it (DB + dashboard inside)
#   3. Opens the dashboard in your browser
#
# Usage (repo is public - served from GitHub raw):
#   curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/main/scripts/install.sh | bash
#
# To uninstall hooks only:
#   curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/main/scripts/install.sh | bash -s -- --uninstall-hooks
# ─────────────────────────────────────────────────────────────────────────────

set -e

AGENTLENS_PORT="${PORT:-4040}"
IMAGE="${AGENTLENS_IMAGE:-ratheshprabakar/agentlens:latest}"
CONTAINER_NAME="${AGENTLENS_NAME:-agentlens}"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
COLLECTOR_URL="http://localhost:${AGENTLENS_PORT}/api/events"
# Public install URL (GitHub raw while repo is public).
INSTALL_URL="${AGENTLENS_INSTALL_URL:-https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/main/scripts/install.sh}"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

banner() {
  echo ""
  echo -e "${BOLD}  AgentLens v1.0${RESET}  ${DIM}DevTools for AI coding agents${RESET}"
  echo -e "${DIM}  ─────────────────────────────────────────────${RESET}"
}

# ── Uninstall mode ────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--uninstall-hooks" ]]; then
  banner
  echo -e "\n  Removing Claude Code hooks from ${DIM}${CLAUDE_SETTINGS}${RESET}…"
  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    python3 - <<PYEOF
import json, sys

path = "$CLAUDE_SETTINGS"
try:
    with open(path) as f:
        settings = json.load(f)
except Exception:
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
    echo -e "  ${YELLOW}⚠${RESET}  Settings file not found - nothing to remove."
  fi
  echo ""
  exit 0
fi

# ── Main install ──────────────────────────────────────────────────────────────

banner

echo -e "\n  ${DIM}Checking prerequisites…${RESET}"

if ! command -v docker &>/dev/null; then
  echo -e "\n  ${RED}✗${RESET} Docker not found."
  echo -e "  Install Docker Desktop from ${DIM}https://docker.com/get-started${RESET}"
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Docker found"

if ! docker info &>/dev/null; then
  echo -e "\n  ${RED}✗${RESET} Docker is installed but not running."
  echo -e "  Start Docker Desktop and try again."
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Docker is running"

if ! command -v curl &>/dev/null; then
  echo -e "\n  ${RED}✗${RESET} curl not found (required for hooks)."
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} curl found"

# ── 2. Install Claude Code hooks on the host ─────────────────────────────────

echo -e "\n  ${DIM}Installing Claude Code hooks…${RESET}"

mkdir -p "$HOME/.claude/projects"
mkdir -p "$HOME/.cursor/projects"

HOOK_CMD="curl -s -X POST ${COLLECTOR_URL} -H 'Content-Type: application/json' -d @- 2>/dev/null; true"

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
  echo '{}' > "$CLAUDE_SETTINGS"
fi

python3 - <<PYEOF
import json

path = "$CLAUDE_SETTINGS"
hook_cmd = "$HOOK_CMD"
hook_types = ["PostToolUse", "PreToolUse", "Stop", "Notification"]

def has_agentlens(matchers):
    return any(
        "agentlens" in h.get("command", "") or "localhost:${AGENTLENS_PORT}/api/events" in h.get("command", "")
        for m in (matchers or [])
        for h in m.get("hooks", [])
    )

try:
    with open(path) as f:
        settings = json.load(f)
except Exception:
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
echo -e "  ${DIM}  Hook: POST ${COLLECTOR_URL}${RESET}"

# ── 3. Start AgentLens (single image) ────────────────────────────────────────

echo -e "\n  ${DIM}Starting AgentLens…${RESET}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-/tmp}")" 2>/dev/null && pwd || echo "/tmp")"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -f "$PROJECT_DIR/src/cli.ts" ]] && [[ -f "$PROJECT_DIR/docker-compose.yml" ]] \
  && [[ "${BASH_SOURCE[0]:-}" == *"/scripts/install.sh" ]]; then
  # Developer mode: build from local source via compose
  echo -e "  ${DIM}(developer mode - building from source)${RESET}"
  COMPOSE_CMD="docker compose"
  if ! docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  fi
  cd "$PROJECT_DIR"
  PORT="$AGENTLENS_PORT" $COMPOSE_CMD up -d --build
  echo -e "  ${GREEN}✓${RESET} Containers started"
else
  # End-user mode: pull + run single image (volumes handled here - user never types them)
  echo -e "  ${DIM}(pulling ${IMAGE})${RESET}"
  docker pull "$IMAGE"

  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo -e "  ${DIM}Removing existing container ${CONTAINER_NAME}…${RESET}"
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi

  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "${AGENTLENS_PORT}:4040" \
    -e "PORT=4040" \
    -e "AGENTLENS_HOST_PORT=${AGENTLENS_PORT}" \
    -v agentlens-data:/var/lib/postgresql/data \
    -v "${HOME}/.claude:/host-claude" \
    -v "${HOME}/.claude/projects:/claude-projects:ro" \
    -v "${HOME}/.cursor/projects:/cursor-projects:ro" \
    "$IMAGE" >/dev/null

  echo -e "  ${GREEN}✓${RESET} Container started"
fi

# ── 4. Wait for app to be ready ───────────────────────────────────────────────

echo -e "\n  ${DIM}Waiting for AgentLens to be ready…${RESET}"

READY=0
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:${AGENTLENS_PORT}/api/health" &>/dev/null; then
    READY=1
    break
  fi
  sleep 2
done

if [[ $READY -eq 0 ]]; then
  echo -e "  ${YELLOW}⚠${RESET}  AgentLens didn't respond within 60s."
  echo -e "  ${DIM}  Check logs: docker logs -f ${CONTAINER_NAME}${RESET}"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} AgentLens is ready"

# ── 5. Open browser ───────────────────────────────────────────────────────────

DASHBOARD="http://localhost:${AGENTLENS_PORT}"

echo ""
echo -e "${BOLD}  ✓ AgentLens is running!${RESET}"
echo ""
echo -e "  Dashboard:  ${DIM}${DASHBOARD}${RESET}"
echo -e "  Image:      ${DIM}${IMAGE}${RESET}"
echo ""
echo -e "  ${DIM}Stop:    docker stop ${CONTAINER_NAME}${RESET}"
echo -e "  ${DIM}Logs:    docker logs -f ${CONTAINER_NAME}${RESET}"
echo -e "  ${DIM}Hooks:   curl -sSL ${INSTALL_URL} | bash -s -- --uninstall-hooks${RESET}"
echo ""

if command -v open &>/dev/null; then
  open "$DASHBOARD"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$DASHBOARD"
fi
