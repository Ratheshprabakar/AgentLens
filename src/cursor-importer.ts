/**
 * Cursor Agent Transcript Importer
 *
 * Reads Cursor agent JSONL transcripts from:
 *   ~/.cursor/projects/<encoded-project>/agent-transcripts/<uuid>/<uuid>.jsonl
 *
 * Format (per line):
 *   { "role": "user"|"assistant", "message": { "content": [text|tool_use blocks] } }
 *   { "type": "turn_ended", "status": "success" }
 *
 * Note: Cursor transcripts typically omit tool results; we still record tool_use
 * calls so the timeline shows what the agent attempted.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import {
  insertEvent,
  upsertSession,
  endSession,
  setSessionTask,
  getSessionById,
  getAllSessions,
} from "./db.js";
import type { AgentEvent, EventType, AgentName } from "./types.js";

export interface CursorImportStats {
  scanned: number;
  imported: number;
  skipped: number;
  errors: number;
  sessions: Array<{ id: string; task?: string; events: number }>;
}

export interface CursorTranscriptInfo {
  sessionId: string;
  projectDir: string;
  cwd: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: number;
  alreadyImported: boolean;
  agent: "cursor";
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export const CURSOR_PROJECTS_DIR =
  process.env.CURSOR_PROJECTS_DIR ?? join(homedir(), ".cursor", "projects");

const AGENT: AgentName = "cursor";

// ─── Types ────────────────────────────────────────────────────────────────────

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id?: string;
      name: string;
      input?: Record<string, unknown>;
    }
  | { type: string; [key: string]: unknown };

interface CursorEntry {
  role?: "user" | "assistant" | string;
  type?: string;
  status?: string;
  message?: {
    content?: string | ContentBlock[];
  };
  [key: string]: unknown;
}

interface ParsedCursorSession {
  sessionId: string;
  cwd?: string;
  task?: string;
  startTime: number;
  endTime?: number;
  status: "success" | "failed" | "unknown" | "running";
  events: AgentEvent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort decode: Users-foo-bar → /Users/foo/bar */
export function decodeCursorProjectDir(dirName: string): string {
  if (!dirName) return "";
  const withSlashes = dirName.replace(/-/g, "/");
  return withSlashes.startsWith("/") ? withSlashes : `/${withSlashes}`;
}

function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 32);
}

function contentToString(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter(
      (b) =>
        b.type === "text" && typeof (b as { text?: string }).text === "string",
    )
    .map((b) => (b as { text: string }).text)
    .join("\n");
}

function extractUserQuery(text: string): string {
  const queryMatch = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (queryMatch) return queryMatch[1].trim();
  // Strip timestamp / system wrappers if present
  return text
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "")
    .replace(/<\/?user_query>/gi, "")
    .trim();
}

/**
 * Short session title for the UI - mirrors Cursor's chat name when possible.
 * Falls back to a compact first-line / name+subtitle heuristic (not the full paste).
 */
export function deriveSessionTitle(query: string): string {
  const lines = query
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^version\s*:/i.test(l) &&
        !/^status\s*:/i.test(l) &&
        !/^-{3,}$/.test(l),
    );

  if (lines.length === 0) return "Untitled session";

  const first = lines[0];
  const titleLike = lines.find(
    (l, i) =>
      i > 0 &&
      l.length <= 80 &&
      /proposal|plan|implement|fix|refactor|add |remove |analys[ea]|build|bug|feature|review/i.test(
        l,
      ),
  );

  if (first.length <= 40 && titleLike) {
    const combined = `${first}: ${titleLike}`;
    return combined.length <= 80 ? combined : `${combined.slice(0, 77)}…`;
  }

  if (
    first.length <= 40 &&
    lines[1] &&
    lines[1].length <= 55 &&
    !/[.!?]$/.test(lines[1])
  ) {
    const combined = `${first} - ${lines[1]}`;
    return combined.length <= 80 ? combined : first;
  }

  if (first.length <= 80) return first;

  const sentence = first.match(/^[\s\S]{10,77}?[.!?](?=\s|$)/);
  if (sentence) return sentence[0].trim();
  return `${first.slice(0, 77).trimEnd()}…`;
}

/** Resolve Cursor chat name from composer headers DB, else derive from first prompt. */
function resolveSessionTitle(
  sessionId: string,
  query: string | undefined,
  titles: Map<string, string>,
): string | undefined {
  const named = titles.get(sessionId)?.trim();
  if (named) return named.slice(0, 120);
  if (!query) return undefined;
  return deriveSessionTitle(query);
}

/**
 * Read Cursor's sidebar chat names from globalStorage/state.vscdb
 * (composer.composerHeaders → allComposers[].name).
 */
export function loadCursorComposerTitles(): Map<string, string> {
  const map = new Map<string, string>();
  const dbPath =
    process.env.CURSOR_STATE_DB ??
    [
      join(
        homedir(),
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
      join(
        homedir(),
        ".config",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
      join(
        homedir(),
        "AppData",
        "Roaming",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    ].find((p) => existsSync(p));

  if (!dbPath) return map;

  try {
    // bun:sqlite - available when running under Bun
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite") as {
      Database: new (
        path: string,
        opts?: { readonly?: boolean },
      ) => {
        query: (sql: string) => {
          get: (...params: string[]) => { value: string } | null;
        };
        close: () => void;
      };
    };
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT value FROM ItemTable WHERE key = ?")
        .get("composer.composerHeaders");
      if (!row?.value) return map;
      const data = JSON.parse(row.value) as {
        allComposers?: Array<{ composerId?: string; name?: string }>;
      };
      for (const c of data.allComposers ?? []) {
        if (c.composerId && c.name?.trim()) {
          map.set(c.composerId, c.name.trim());
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // Titles unavailable - deriveSessionTitle will be used instead
  }

  return map;
}

function extractTimestamp(text: string, fallback: number): number {
  const m = text.match(/<timestamp>\s*([^<]+?)\s*<\/timestamp>/i);
  if (!m) return Math.floor(fallback);
  const ms = Date.parse(m[1].trim());
  return Number.isNaN(ms) ? Math.floor(fallback) : Math.floor(ms);
}

/** Ensure timestamps are integer ms (pg BIGINT rejects floats from mtimeMs). */
function ts(n: number): number {
  return Math.floor(n);
}

const TOOL_TYPE_MAP: Record<string, EventType> = {
  Read: "file_read",
  ReadFile: "file_read",
  Write: "file_edit",
  StrReplace: "file_edit",
  Delete: "file_edit",
  EditNotebook: "file_edit",
  Shell: "shell",
  Bash: "shell",
  Grep: "search",
  Glob: "search",
  SemanticSearch: "search",
  WebSearch: "web",
  WebFetch: "web",
  Task: "subagent",
  Await: "tool_call",
  TodoWrite: "agent_message",
  AskQuestion: "agent_message",
  SwitchMode: "agent_message",
  CallMcpTool: "tool_call",
  GenerateImage: "tool_call",
};

function toolToEventType(name: string): EventType {
  return TOOL_TYPE_MAP[name] ?? "tool_call";
}

function toolUseToEvent(
  sessionId: string,
  tool: { id?: string; name: string; input?: Record<string, unknown> },
  timestamp: number,
  index: number,
): AgentEvent {
  const input = tool.input ?? {};
  const type = toolToEventType(tool.name);
  const id = stableId(
    sessionId,
    "tool",
    String(index),
    tool.name,
    JSON.stringify(input).slice(0, 200),
  );

  const base: AgentEvent = {
    id,
    sessionId,
    agent: AGENT,
    timestamp,
    type,
    tool: tool.name,
  };

  switch (type) {
    case "file_read":
      return {
        ...base,
        file: (input.path ?? input.target_file ?? input.file_path) as
          | string
          | undefined,
      };
    case "file_edit": {
      const newStr = String(input.new_string ?? input.contents ?? "");
      const oldStr = String(input.old_string ?? "");
      return {
        ...base,
        file: (input.path ?? input.target_file ?? input.file_path) as
          | string
          | undefined,
        additions: newStr ? newStr.split("\n").length : undefined,
        deletions: oldStr
          ? Math.max(0, oldStr.split("\n").length - 1)
          : undefined,
      };
    }
    case "shell": {
      const command = String(input.command ?? "");
      const isTest =
        /\b(jest|vitest|pytest|go test|npm test|yarn test|pnpm test|mocha|cargo test)\b/i.test(
          command,
        );
      return {
        ...base,
        type: isTest ? "test_run" : "shell",
        command: command.slice(0, 500),
        content:
          typeof input.description === "string"
            ? input.description.slice(0, 200)
            : undefined,
      };
    }
    case "search":
      return {
        ...base,
        query:
          String(input.pattern ?? input.query ?? input.glob ?? "").slice(
            0,
            300,
          ) || undefined,
        file: typeof input.path === "string" ? input.path : undefined,
      };
    case "web":
      return {
        ...base,
        query:
          String(input.url ?? input.search_term ?? input.query ?? "").slice(
            0,
            500,
          ) || undefined,
      };
    case "subagent":
      return {
        ...base,
        content:
          String(input.description ?? input.prompt ?? "").slice(0, 500) ||
          undefined,
      };
    case "agent_message":
      return {
        ...base,
        content: String(
          input.merge !== undefined
            ? `todos update`
            : (input.title ?? input.prompt ?? tool.name),
        ).slice(0, 500),
      };
    default:
      return {
        ...base,
        content:
          typeof input.description === "string"
            ? input.description.slice(0, 300)
            : undefined,
      };
  }
}

// ─── Discover transcript files ────────────────────────────────────────────────

export interface CursorTranscriptFile {
  sessionId: string;
  projectDir: string;
  cwd: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: number;
}

function collectCursorTranscriptFiles(
  root = CURSOR_PROJECTS_DIR,
): CursorTranscriptFile[] {
  const results: CursorTranscriptFile[] = [];
  if (!existsSync(root)) return results;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return results;
  }

  for (const projectDir of projectDirs) {
    const transcriptsRoot = join(root, projectDir, "agent-transcripts");
    if (!existsSync(transcriptsRoot)) continue;

    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(transcriptsRoot);
    } catch {
      continue;
    }

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(transcriptsRoot, sessionDir);
      try {
        if (!statSync(sessionPath).isDirectory()) continue;
      } catch {
        continue;
      }

      // Main session file: <uuid>/<uuid>.jsonl (skip subagents/)
      const mainFile = join(sessionPath, `${sessionDir}.jsonl`);
      if (existsSync(mainFile)) {
        try {
          const s = statSync(mainFile);
          results.push({
            sessionId: sessionDir,
            projectDir,
            cwd: decodeCursorProjectDir(projectDir),
            filePath: mainFile,
            sizeBytes: s.size,
            modifiedAt: Math.floor(s.mtimeMs),
          });
        } catch {
          /* skip */
        }
      }
    }
  }

  return results.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseCursorTranscript(
  filePath: string,
  projectDir: string,
  sessionId = basename(filePath, ".jsonl"),
  composerTitles: Map<string, string> = new Map(),
): ParsedCursorSession | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const entries: CursorEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as CursorEntry);
    } catch {
      /* skip malformed */
    }
  }
  if (entries.length === 0) return null;

  const cwd = decodeCursorProjectDir(projectDir);
  let fileMtime = Date.now();
  try {
    fileMtime = ts(statSync(filePath).mtimeMs);
  } catch {
    /* ignore */
  }

  let task: string | undefined;
  let firstQuery: string | undefined;
  let startTime = fileMtime;
  let endTime: number | undefined;
  let status: ParsedCursorSession["status"] = "running";
  let clock = fileMtime;
  let foundStart = false;

  const events: AgentEvent[] = [];
  let eventIndex = 0;

  // First pass: find earliest timestamp from user messages
  for (const entry of entries) {
    if (entry.role !== "user") continue;
    const text = contentToString(entry.message?.content);
    if (!text) continue;
    const parsedTs = extractTimestamp(text, NaN);
    if (!Number.isNaN(parsedTs)) {
      if (!foundStart || parsedTs < startTime) {
        startTime = parsedTs;
        foundStart = true;
      }
    }
  }
  if (!foundStart) startTime = fileMtime;
  clock = startTime;

  events.push({
    id: stableId(sessionId, "session_start"),
    sessionId,
    agent: AGENT,
    timestamp: ts(startTime),
    type: "session_start",
    content: "Session started (imported from Cursor transcript)",
  });

  for (const entry of entries) {
    // Turn boundary
    if (entry.type === "turn_ended") {
      const turnStatus =
        entry.status === "success"
          ? "success"
          : entry.status === "error"
            ? "failed"
            : "unknown";
      status = turnStatus === "unknown" ? status : turnStatus;
      clock = ts(clock + 50);
      continue;
    }

    const content = entry.message?.content;
    const text = contentToString(content);

    if (entry.role === "user") {
      const userTs = extractTimestamp(text, clock);
      clock = ts(Math.max(clock, userTs) + 1);
      const query = extractUserQuery(text);
      if (query) {
        if (!firstQuery) firstQuery = query;
        events.push({
          id: stableId(
            sessionId,
            "user",
            String(eventIndex++),
            query.slice(0, 80),
          ),
          sessionId,
          agent: AGENT,
          timestamp: ts(userTs),
          type: "user_message",
          content: query.slice(0, 1000),
        });
      }
      continue;
    }

    if (entry.role === "assistant") {
      clock = ts(clock + 10);
      const assistantTs = clock;

      if (text.trim()) {
        // Prefer short thinking / reply snippets for timeline readability
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 400);
        if (snippet.length > 20) {
          events.push({
            id: stableId(
              sessionId,
              "assistant",
              String(eventIndex++),
              snippet.slice(0, 80),
            ),
            sessionId,
            agent: AGENT,
            timestamp: ts(assistantTs),
            type: "agent_message",
            content: snippet,
          });
        }
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type !== "tool_use") continue;
          const tool = block as {
            type: "tool_use";
            id?: string;
            name: string;
            input?: Record<string, unknown>;
          };
          clock = ts(clock + 5);
          events.push(toolUseToEvent(sessionId, tool, clock, eventIndex++));
        }
      }
    }
  }

  // If the last turn ended successfully (or file hasn't changed recently), mark ended
  const lastTurn = [...entries].reverse().find((e) => e.type === "turn_ended");
  if (lastTurn) {
    endTime = ts(clock + 10);
    status =
      lastTurn.status === "success"
        ? "success"
        : lastTurn.status === "error"
          ? "failed"
          : "unknown";
    events.push({
      id: stableId(sessionId, "session_end"),
      sessionId,
      agent: AGENT,
      timestamp: endTime,
      type: "session_end",
      success: status !== "failed",
      content: `Session ended (${status})`,
    });
  } else {
    // No turn_ended - treat as running if modified recently, else unknown
    const ageMs = Date.now() - fileMtime;
    status = ageMs < 15 * 60 * 1000 ? "running" : "unknown";
    endTime = status === "running" ? undefined : fileMtime;
    if (endTime) {
      events.push({
        id: stableId(sessionId, "session_end"),
        sessionId,
        agent: AGENT,
        timestamp: ts(endTime),
        type: "session_end",
        success: true,
        content: "Session ended (imported)",
      });
    }
  }

  task = resolveSessionTitle(sessionId, firstQuery, composerTitles);

  return {
    sessionId,
    cwd,
    task,
    startTime: ts(startTime),
    endTime,
    status,
    events,
  };
}

// ─── Import / list / watch ────────────────────────────────────────────────────

async function persistParsed(
  parsed: ParsedCursorSession,
  force: boolean,
): Promise<boolean> {
  if (!force) {
    const existing = await getSessionById(parsed.sessionId);
    if (existing) return false;
  }

  await upsertSession({
    id: parsed.sessionId,
    agent: AGENT,
    task: parsed.task,
    cwd: parsed.cwd,
    startTime: parsed.startTime,
  });

  // Always refresh title from Cursor name / derived short title
  if (parsed.task)
    await setSessionTask(parsed.sessionId, parsed.task, { overwrite: true });

  for (const event of parsed.events) {
    try {
      await insertEvent(event);
    } catch {
      /* duplicate */
    }
  }

  if (parsed.endTime && parsed.status !== "running") {
    await endSession(parsed.sessionId, parsed.status);
  }

  return true;
}

export async function importCursorTranscripts(
  opts: {
    force?: boolean;
    onProgress?: (msg: string) => void;
  } = {},
): Promise<CursorImportStats> {
  const stats: CursorImportStats = {
    scanned: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    sessions: [],
  };
  const files = collectCursorTranscriptFiles();
  const composerTitles = loadCursorComposerTitles();

  for (const file of files) {
    stats.scanned++;

    if (!opts.force) {
      const existing = await getSessionById(file.sessionId);
      if (existing) {
        // Still refresh title if Cursor now has a better name
        const named = composerTitles.get(file.sessionId);
        if (named) {
          await setSessionTask(file.sessionId, named.slice(0, 120), {
            overwrite: true,
          });
        }
        stats.skipped++;
        continue;
      }
    }

    try {
      const parsed = parseCursorTranscript(
        file.filePath,
        file.projectDir,
        file.sessionId,
        composerTitles,
      );
      if (!parsed) {
        stats.skipped++;
        continue;
      }

      const imported = await persistParsed(parsed, opts.force ?? false);
      if (!imported) {
        stats.skipped++;
        continue;
      }

      stats.imported++;
      stats.sessions.push({
        id: parsed.sessionId,
        task: parsed.task,
        events: parsed.events.length,
      });
      opts.onProgress?.(
        `Cursor ${parsed.sessionId.slice(0, 8)}… "${(parsed.task ?? "").slice(0, 40)}" (${parsed.events.length} events)`,
      );
    } catch (err) {
      stats.errors++;
      opts.onProgress?.(
        `Error importing Cursor ${file.sessionId}: ${String(err)}`,
      );
    }
  }

  return stats;
}

export async function listCursorTranscripts(): Promise<CursorTranscriptInfo[]> {
  const importedIds = new Set((await getAllSessions(10000)).map((s) => s.id));
  return collectCursorTranscriptFiles().map((f) => ({
    sessionId: f.sessionId,
    projectDir: f.projectDir,
    cwd: f.cwd,
    filePath: f.filePath,
    sizeBytes: f.sizeBytes,
    modifiedAt: f.modifiedAt,
    alreadyImported: importedIds.has(f.sessionId),
    agent: "cursor" as const,
  }));
}

const cursorWatched = new Map<string, number>();

export function watchCursorTranscripts(
  onChange: (sessionId: string) => void,
): () => void {
  let running = true;

  const tick = async () => {
    if (!running) return;
    const files = collectCursorTranscriptFiles();
    const composerTitles = loadCursorComposerTitles();

    for (const file of files) {
      const last = cursorWatched.get(file.filePath);
      if (last !== undefined && file.modifiedAt <= last) continue;
      cursorWatched.set(file.filePath, file.modifiedAt);

      try {
        const existing = await getSessionById(file.sessionId);
        // Re-import if new or still running (live session growing)
        if (existing && existing.status !== "running" && last !== undefined) {
          const named = composerTitles.get(file.sessionId);
          if (named)
            await setSessionTask(file.sessionId, named.slice(0, 120), {
              overwrite: true,
            });
          continue;
        }

        const parsed = parseCursorTranscript(
          file.filePath,
          file.projectDir,
          file.sessionId,
          composerTitles,
        );
        if (!parsed) continue;

        await upsertSession({
          id: parsed.sessionId,
          agent: AGENT,
          task: parsed.task,
          cwd: parsed.cwd,
          startTime: parsed.startTime,
        });
        if (parsed.task)
          await setSessionTask(parsed.sessionId, parsed.task, {
            overwrite: true,
          });
        for (const event of parsed.events) {
          try {
            await insertEvent(event);
          } catch {
            /* dedupe */
          }
        }
        if (parsed.endTime && parsed.status !== "running") {
          await endSession(parsed.sessionId, parsed.status);
        }
        onChange(parsed.sessionId);
      } catch {
        /* ignore watch errors */
      }
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), 5000);
  return () => {
    running = false;
    clearInterval(timer);
  };
}
