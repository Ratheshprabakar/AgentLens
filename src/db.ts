/**
 * AgentLens local database layer.
 * Uses the built-in node:sqlite module (available since Node 22.5).
 * No native compilation required.
 */

import { DatabaseSync, StatementSync } from "node:sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";
import type { AgentEvent, Session, SessionStatus, SessionSummary } from "./types.js";

// ─── Database path ────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), ".agentlens");
export const DB_PATH = join(DATA_DIR, "agentlens.db");

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT    PRIMARY KEY,
    agent       TEXT    NOT NULL DEFAULT 'claude-code',
    model       TEXT,
    task        TEXT,
    cwd         TEXT,
    start_time  INTEGER NOT NULL,
    end_time    INTEGER,
    status      TEXT    NOT NULL DEFAULT 'running',
    event_count INTEGER NOT NULL DEFAULT 0,
    file_reads  INTEGER NOT NULL DEFAULT 0,
    file_edits  INTEGER NOT NULL DEFAULT 0,
    shell_cmds  INTEGER NOT NULL DEFAULT 0,
    searches    INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS events (
    id           TEXT    PRIMARY KEY,
    session_id   TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent        TEXT    NOT NULL DEFAULT 'claude-code',
    timestamp    INTEGER NOT NULL,
    type         TEXT    NOT NULL,
    tool         TEXT,
    command      TEXT,
    exit_code    INTEGER,
    output       TEXT,
    file         TEXT,
    additions    INTEGER,
    deletions    INTEGER,
    query        TEXT,
    result_count INTEGER,
    duration     INTEGER,
    success      INTEGER,
    content      TEXT,
    metadata     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_start    ON sessions(start_time DESC);
`;

// ─── DB singleton ─────────────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;

export function getDB(): DatabaseSync {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec(SCHEMA);
  return _db;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  agent: string;
  model: string | null;
  task: string | null;
  cwd: string | null;
  start_time: number;
  end_time: number | null;
  status: string;
  event_count: number;
  file_reads: number;
  file_edits: number;
  shell_cmds: number;
  searches: number;
  errors: number;
}

interface EventRow {
  id: string;
  session_id: string;
  agent: string;
  timestamp: number;
  type: string;
  tool: string | null;
  command: string | null;
  exit_code: number | null;
  output: string | null;
  file: string | null;
  additions: number | null;
  deletions: number | null;
  query: string | null;
  result_count: number | null;
  duration: number | null;
  success: number | null;
  content: string | null;
  metadata: string | null;
}

// ─── Converters ───────────────────────────────────────────────────────────────

function rowToSession(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    agent: row.agent,
    model: row.model ?? undefined,
    task: row.task ?? undefined,
    cwd: row.cwd ?? undefined,
    startTime: row.start_time,
    endTime: row.end_time ?? undefined,
    status: row.status as SessionStatus,
    eventCount: row.event_count,
    fileReads: row.file_reads,
    fileEdits: row.file_edits,
    shellCommands: row.shell_cmds,
    searches: row.searches,
    errors: row.errors,
    duration: row.end_time != null ? row.end_time - row.start_time : undefined,
  };
}

function rowToEvent(row: EventRow): AgentEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    agent: row.agent,
    timestamp: row.timestamp,
    type: row.type as AgentEvent["type"],
    tool: row.tool ?? undefined,
    command: row.command ?? undefined,
    exitCode: row.exit_code ?? undefined,
    output: row.output ?? undefined,
    file: row.file ?? undefined,
    additions: row.additions ?? undefined,
    deletions: row.deletions ?? undefined,
    query: row.query ?? undefined,
    resultCount: row.result_count ?? undefined,
    duration: row.duration ?? undefined,
    success: row.success != null ? Boolean(row.success) : undefined,
    content: row.content ?? undefined,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
  };
}

// ─── Statement cache ──────────────────────────────────────────────────────────
// Caching prepared statements avoids re-parsing on every call.

const stmtCache = new Map<string, StatementSync>();

function stmt(sql: string): StatementSync {
  let s = stmtCache.get(sql);
  if (!s) {
    s = getDB().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

// ─── Session operations ───────────────────────────────────────────────────────

export function upsertSession(
  partial: Partial<Session> & { id: string; startTime: number }
): void {
  stmt(`
    INSERT INTO sessions (id, agent, model, task, cwd, start_time, status)
    VALUES (?, ?, ?, ?, ?, ?, 'running')
    ON CONFLICT(id) DO NOTHING
  `).run(
    partial.id,
    partial.agent ?? "claude-code",
    partial.model ?? null,
    partial.task ?? null,
    partial.cwd ?? null,
    partial.startTime
  );
}

export function endSession(id: string, status: SessionStatus): void {
  stmt(`UPDATE sessions SET end_time = ?, status = ? WHERE id = ?`).run(
    Date.now(),
    status,
    id
  );
}

export function updateSessionCounts(sessionId: string, type: string): void {
  const countField = (() => {
    switch (type) {
      case "file_read": return "file_reads";
      case "file_edit": return "file_edits";
      case "shell":
      case "test_run": return "shell_cmds";
      case "search":   return "searches";
      case "error":    return "errors";
      default:         return null;
    }
  })();

  if (countField) {
    // Can't cache these dynamically-named queries — use exec via getDB
    getDB().exec(
      `UPDATE sessions SET event_count = event_count + 1, ${countField} = ${countField} + 1 WHERE id = '${sessionId.replace(/'/g, "''")}'`
    );
  } else {
    stmt(`UPDATE sessions SET event_count = event_count + 1 WHERE id = ?`).run(sessionId);
  }
}

export function setSessionTask(sessionId: string, task: string): void {
  stmt(`UPDATE sessions SET task = ? WHERE id = ? AND task IS NULL`).run(task, sessionId);
}

export function getAllSessions(limit = 200): SessionSummary[] {
  const rows = stmt(`SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?`)
    .all(limit) as unknown as SessionRow[];
  return rows.map(rowToSession);
}

export function getSessionById(id: string): SessionSummary | undefined {
  const row = stmt(`SELECT * FROM sessions WHERE id = ?`).get(id) as unknown as SessionRow | undefined;
  return row ? rowToSession(row) : undefined;
}

export function deleteSession(id: string): void {
  stmt(`DELETE FROM sessions WHERE id = ?`).run(id);
}

// ─── Event operations ─────────────────────────────────────────────────────────

export function insertEvent(event: AgentEvent): void {
  // Ensure session row exists first
  upsertSession({ id: event.sessionId, agent: event.agent, startTime: event.timestamp });

  stmt(`
    INSERT OR IGNORE INTO events
      (id, session_id, agent, timestamp, type, tool, command, exit_code, output,
       file, additions, deletions, query, result_count, duration, success, content, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.sessionId,
    event.agent,
    event.timestamp,
    event.type,
    event.tool ?? null,
    event.command ?? null,
    event.exitCode ?? null,
    event.output ?? null,
    event.file ?? null,
    event.additions ?? null,
    event.deletions ?? null,
    event.query ?? null,
    event.resultCount ?? null,
    event.duration ?? null,
    event.success != null ? (event.success ? 1 : 0) : null,
    event.content ?? null,
    event.metadata ? JSON.stringify(event.metadata) : null
  );

  updateSessionCounts(event.sessionId, event.type);
}

export function getEventsBySession(sessionId: string): AgentEvent[] {
  const rows = stmt(
    `SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`
  ).all(sessionId) as unknown as EventRow[];
  return rows.map(rowToEvent);
}
