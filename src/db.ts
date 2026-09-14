/**
 * AgentLens database layer - PostgreSQL via node-postgres (pg).
 *
 * Connection is configured via the DATABASE_URL environment variable:
 *   postgresql://user:password@host:5432/agentlens
 *
 * Falls back to a SQLite-compatible URL for local dev without Docker
 * (not used - PostgreSQL is always required in Docker).
 */

import { Pool, type PoolClient } from "pg";
import type {
  AgentEvent,
  Session,
  SessionStatus,
  SessionSummary,
} from "./types.js";

// ─── Connection pool ──────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://agentlens:agentlens@localhost:5432/agentlens";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on("error", (err) => {
      console.error("[agentlens] pg pool error:", err.message);
    });
  }
  return _pool;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT    PRIMARY KEY,
    agent       TEXT    NOT NULL DEFAULT 'claude-code',
    model       TEXT,
    task        TEXT,
    cwd         TEXT,
    start_time  BIGINT  NOT NULL,
    end_time    BIGINT,
    status      TEXT    NOT NULL DEFAULT 'running',
    event_count INTEGER NOT NULL DEFAULT 0,
    file_reads  INTEGER NOT NULL DEFAULT 0,
    file_edits  INTEGER NOT NULL DEFAULT 0,
    shell_cmds  INTEGER NOT NULL DEFAULT 0,
    searches    INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS events (
    id           TEXT     PRIMARY KEY,
    session_id   TEXT     NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent        TEXT     NOT NULL DEFAULT 'claude-code',
    timestamp    BIGINT   NOT NULL,
    type         TEXT     NOT NULL,
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
    success      BOOLEAN,
    content      TEXT,
    metadata     JSONB
  );

  CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_start    ON sessions(start_time DESC);
`;

/**
 * Run the schema migrations. Called once on startup - idempotent.
 * Retries for up to 30 seconds to handle PostgreSQL cold-start in Docker.
 */
export async function initDB(retries = 12, delayMs = 2500): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const pool = getPool();
      await pool.query(SCHEMA_SQL);
      console.log("[agentlens] Database ready.");
      return;
    } catch (err) {
      if (attempt === retries) {
        console.error(
          "[agentlens] Database init failed:",
          (err as Error).message,
        );
        throw err;
      }
      console.log(
        `[agentlens] Waiting for PostgreSQL… (attempt ${attempt}/${retries})`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// ─── Row → domain types ───────────────────────────────────────────────────────

// pg returns column names in lowercase - matches our snake_case schema
interface SessionRow {
  id: string;
  agent: string;
  model: string | null;
  task: string | null;
  cwd: string | null;
  start_time: string; // pg returns BIGINT as string
  end_time: string | null;
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
  timestamp: string; // BIGINT → string from pg
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
  success: boolean | null;
  content: string | null;
  metadata: Record<string, unknown> | null; // JSONB - pg parses it automatically
}

function rowToSession(row: SessionRow): SessionSummary {
  const startTime = Number(row.start_time);
  const endTime = row.end_time != null ? Number(row.end_time) : undefined;
  return {
    id: row.id,
    agent: row.agent,
    model: row.model ?? undefined,
    task: row.task ?? undefined,
    cwd: row.cwd ?? undefined,
    startTime,
    endTime,
    status: row.status as SessionStatus,
    eventCount: row.event_count,
    fileReads: row.file_reads,
    fileEdits: row.file_edits,
    shellCommands: row.shell_cmds,
    searches: row.searches,
    errors: row.errors,
    duration: endTime != null ? endTime - startTime : undefined,
  };
}

function rowToEvent(row: EventRow): AgentEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    agent: row.agent,
    timestamp: Number(row.timestamp),
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
    success: row.success ?? undefined,
    content: row.content ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

// ─── Session operations ───────────────────────────────────────────────────────

export async function upsertSession(
  partial: Partial<Session> & { id: string; startTime: number },
): Promise<void> {
  await getPool().query(
    `INSERT INTO sessions (id, agent, model, task, cwd, start_time, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'running')
     ON CONFLICT (id) DO NOTHING`,
    [
      partial.id,
      partial.agent ?? "claude-code",
      partial.model ?? null,
      partial.task ?? null,
      partial.cwd ?? null,
      partial.startTime,
    ],
  );
}

export async function endSession(
  id: string,
  status: SessionStatus,
): Promise<void> {
  await getPool().query(
    `UPDATE sessions SET end_time = $1, status = $2 WHERE id = $3`,
    [Date.now(), status, id],
  );
}

export async function updateSessionCounts(
  sessionId: string,
  type: string,
): Promise<void> {
  // Use a single CASE-based UPDATE - safe, no dynamic SQL
  await getPool().query(
    `UPDATE sessions SET
       event_count = event_count + 1,
       file_reads  = file_reads  + CASE WHEN $1 = 'file_read'              THEN 1 ELSE 0 END,
       file_edits  = file_edits  + CASE WHEN $1 = 'file_edit'              THEN 1 ELSE 0 END,
       shell_cmds  = shell_cmds  + CASE WHEN $1 IN ('shell', 'test_run')   THEN 1 ELSE 0 END,
       searches    = searches    + CASE WHEN $1 = 'search'                 THEN 1 ELSE 0 END,
       errors      = errors      + CASE WHEN $1 = 'error'                  THEN 1 ELSE 0 END
     WHERE id = $2`,
    [type, sessionId],
  );
}

export async function setSessionTask(
  sessionId: string,
  task: string,
  opts: { overwrite?: boolean } = {},
): Promise<void> {
  if (opts.overwrite) {
    await getPool().query(`UPDATE sessions SET task = $1 WHERE id = $2`, [
      task,
      sessionId,
    ]);
  } else {
    await getPool().query(
      `UPDATE sessions SET task = $1 WHERE id = $2 AND (task IS NULL OR task = '')`,
      [task, sessionId],
    );
  }
}

export async function getAllSessions(limit = 200): Promise<SessionSummary[]> {
  const result = await getPool().query<SessionRow>(
    `SELECT * FROM sessions ORDER BY start_time DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map(rowToSession);
}

export async function getSessionById(
  id: string,
): Promise<SessionSummary | undefined> {
  const result = await getPool().query<SessionRow>(
    `SELECT * FROM sessions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? rowToSession(result.rows[0]) : undefined;
}

export async function deleteSession(id: string): Promise<void> {
  await getPool().query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

// ─── Event operations ─────────────────────────────────────────────────────────

/**
 * Insert a single event and increment the parent session counters.
 * Uses a transaction so counts are always consistent.
 */
export async function insertEvent(event: AgentEvent): Promise<void> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure session row exists first
    await client.query(
      `INSERT INTO sessions (id, agent, start_time, status)
       VALUES ($1, $2, $3, 'running')
       ON CONFLICT (id) DO NOTHING`,
      [event.sessionId, event.agent, event.timestamp],
    );

    // Insert event (ignore duplicates)
    const inserted = await client.query(
      `INSERT INTO events
         (id, session_id, agent, timestamp, type, tool, command, exit_code, output,
          file, additions, deletions, query, result_count, duration, success, content, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
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
        event.success ?? null,
        event.content ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      ],
    );

    // Only bump counters when a new row was actually inserted
    if (inserted.rowCount && inserted.rowCount > 0) {
      await client.query(
        `UPDATE sessions SET
           event_count = event_count + 1,
           file_reads  = file_reads  + CASE WHEN $1 = 'file_read'            THEN 1 ELSE 0 END,
           file_edits  = file_edits  + CASE WHEN $1 = 'file_edit'            THEN 1 ELSE 0 END,
           shell_cmds  = shell_cmds  + CASE WHEN $1 IN ('shell', 'test_run') THEN 1 ELSE 0 END,
           searches    = searches    + CASE WHEN $1 = 'search'               THEN 1 ELSE 0 END,
           errors      = errors      + CASE WHEN $1 = 'error'                THEN 1 ELSE 0 END
         WHERE id = $2`,
        [event.type, event.sessionId],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getEventsBySession(
  sessionId: string,
): Promise<AgentEvent[]> {
  const result = await getPool().query<EventRow>(
    `SELECT * FROM events WHERE session_id = $1 ORDER BY timestamp ASC`,
    [sessionId],
  );
  return result.rows.map(rowToEvent);
}
