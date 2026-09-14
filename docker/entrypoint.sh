#!/bin/sh
# AgentLens container entrypoint
# - Starts embedded Postgres unless DATABASE_URL points at an external host
# - Installs Claude Code hooks when /host-claude is mounted
# - Starts the AgentLens collector + dashboard

set -e

PORT="${PORT:-4040}"
AGENTLENS_HOST_PORT="${AGENTLENS_HOST_PORT:-$PORT}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
EMBEDDED_PG=0

log() {
  echo "  [agentlens] $*"
}

# Returns 0 if we should start embedded Postgres
use_embedded_pg() {
  if [ -z "${DATABASE_URL:-}" ]; then
    return 0
  fi
  case "$DATABASE_URL" in
    *@postgres:*)
      return 1
      ;;
    *@127.0.0.1:*|*@localhost:*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

start_embedded_pg() {
  EMBEDDED_PG=1
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"

  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    log "Initializing embedded Postgres…"
    su-exec postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=trust >/dev/null
    {
      echo "listen_addresses = '127.0.0.1'"
      echo "unix_socket_directories = '/var/run/postgresql'"
    } >> "$PGDATA/postgresql.conf"
  fi

  mkdir -p /var/run/postgresql
  chown -R postgres:postgres /var/run/postgresql

  log "Starting embedded Postgres…"
  su-exec postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1" -w start >/dev/null

  if ! su-exec postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='agentlens'" | grep -q 1; then
    su-exec postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER agentlens WITH PASSWORD 'agentlens';" >/dev/null
  fi
  if ! su-exec postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='agentlens'" | grep -q 1; then
    su-exec postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE agentlens OWNER agentlens;" >/dev/null
  fi

  export DATABASE_URL="postgresql://agentlens:agentlens@127.0.0.1:5432/agentlens"
  log "Embedded Postgres ready"
}

stop_embedded_pg() {
  if [ "$EMBEDDED_PG" = "1" ]; then
    log "Stopping embedded Postgres…"
    su-exec postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  fi
}

install_host_hooks() {
  HOST_CLAUDE="${HOST_CLAUDE_DIR:-/host-claude}"

  # Only when the host bind-mounted ~/.claude (directory absent in the image)
  if [ ! -d "$HOST_CLAUDE" ]; then
    log "No /host-claude mount - skipping Claude Code hooks (dashboard still works)"
    return 0
  fi

  # Prefer mount detection so an accidental empty dir does not get treated as host config
  if [ -f /proc/self/mountinfo ] && ! grep -q " ${HOST_CLAUDE} " /proc/self/mountinfo 2>/dev/null; then
    log "No /host-claude mount - skipping Claude Code hooks (dashboard still works)"
    return 0
  fi

  if ! touch "$HOST_CLAUDE/.agentlens-write-test" 2>/dev/null; then
    log "Cannot write to /host-claude - skipping hooks"
    return 0
  fi
  rm -f "$HOST_CLAUDE/.agentlens-write-test"

  log "Installing Claude Code hooks into host settings…"
  HOST_CLAUDE="$HOST_CLAUDE" \
    COLLECTOR_URL="http://localhost:${AGENTLENS_HOST_PORT}/api/events" \
    bun /app/docker/install-hooks.ts
}

# ── main ──────────────────────────────────────────────────────────────────────

log "Starting AgentLens…"

if use_embedded_pg; then
  start_embedded_pg
else
  log "Using external database (DATABASE_URL set)"
fi

install_host_hooks

APP_PID=""
term() {
  if [ -n "$APP_PID" ]; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  stop_embedded_pg
  exit 0
}
trap term TERM INT

export PORT
export DATABASE_URL
export CLAUDE_PROJECTS_DIR="${CLAUDE_PROJECTS_DIR:-/claude-projects}"
export CURSOR_PROJECTS_DIR="${CURSOR_PROJECTS_DIR:-/cursor-projects}"

bun src/cli.ts start --no-open --port "$PORT" &
APP_PID=$!

log "Dashboard: http://localhost:${AGENTLENS_HOST_PORT}"
log "Collector listening on :${PORT}"

wait "$APP_PID"
status=$?
stop_embedded_pg
exit "$status"
