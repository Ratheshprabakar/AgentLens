/**
 * AgentLens Transcript Importer
 *
 * Reads Claude Code's JSONL transcript files from ~/.claude/projects/
 * and backfills sessions into the local AgentLens database.
 *
 * Claude Code writes one .jsonl file per session to:
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
 *
 * Each line is a JSON message in Anthropic Messages API format, wrapped
 * with metadata (uuid, timestamp, type, sessionId, cwd …).
 */

import { readFileSync, readdirSync, statSync, watchFile, unwatchFile } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import {
  insertEvent,
  upsertSession,
  endSession,
  setSessionTask,
  getSessionById,
  getAllSessions,
} from "./db.js";
import type { AgentEvent, EventType, AgentName } from "./types.js";

// ─── Paths ────────────────────────────────────────────────────────────────────

export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

// ─── Claude Code JSONL types ──────────────────────────────────────────────────

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: string; [key: string]: unknown };

interface ClaudeEntry {
  /** "user" | "human" | "assistant" | "system" | "result" | "summary" */
  type?: string;
  /** Nested message object (common format) */
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  /** Flat content (alternative format) */
  content?: string | ContentBlock[];
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  /** Result cost info */
  costUSD?: number;
  durationMs?: number;
  model?: string;
  /** "success" | "error" | "interrupted" */
  result?: string;
  isError?: boolean;
  subtype?: string;
  [key: string]: unknown;
}

// ─── Import result ────────────────────────────────────────────────────────────

export interface ImportStats {
  scanned: number;
  imported: number;
  skipped: number;
  errors: number;
  sessions: Array<{ id: string; task?: string; events: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode a Claude project directory name back to a filesystem path.
 * Claude uses the project's absolute path with '/' replaced by '-'.
 * e.g., "-Users-rathesh-projects-myapp" → "/Users/rathesh/projects/myapp"
 */
function decodeCwd(dirName: string): string {
  // Remove leading dash, replace remaining dashes with slashes
  // This is a best-effort heuristic — paths with actual dashes are ambiguous
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

/** Parse an ISO timestamp to milliseconds; fall back to Date.now() */
function parseTs(ts?: string): number {
  if (!ts) return Date.now();
  const ms = Date.parse(ts);
  return isNaN(ms) ? Date.now() : ms;
}

/** Safely extract string content from a content block or string */
function contentToString(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}

/** Extract all tool_use blocks from a content array */
function extractToolUses(content: string | ContentBlock[] | undefined): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  if (!content || typeof content === "string") return [];
  return content
    .filter((b) => b.type === "tool_use")
    .map((b) => {
      const block = b as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
      return { id: block.id ?? randomUUID(), name: block.name ?? "unknown", input: block.input ?? {} };
    });
}

/** Extract all tool_result blocks from a content array */
function extractToolResults(content: string | ContentBlock[] | undefined): Map<
  string,
  { content: string; isError: boolean }
> {
  const results = new Map<string, { content: string; isError: boolean }>();
  if (!content || typeof content === "string") return results;

  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const r = block as { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean };
    const text = typeof r.content === "string"
      ? r.content
      : contentToString(r.content as ContentBlock[]);
    results.set(r.tool_use_id, { content: text.slice(0, 2000), isError: r.is_error ?? false });
  }
  return results;
}

// ─── Tool → EventType ─────────────────────────────────────────────────────────

const TOOL_TYPE_MAP: Record<string, EventType> = {
  Read: "file_read", ReadFile: "file_read", LS: "file_read", ListDirectory: "file_read",
  Write: "file_edit", WriteFile: "file_edit", CreateFile: "file_edit",
  Edit: "file_edit", MultiEdit: "file_edit", StrReplace: "file_edit", NotebookEdit: "file_edit",
  Bash: "shell", Shell: "shell",
  Glob: "search", Find: "search", Grep: "search", GrepSearch: "search",
  FileSearch: "search", Search: "search", RipgrepSearch: "search",
  WebSearch: "web", WebFetch: "web",
  Task: "subagent", Agent: "subagent",
  TodoWrite: "agent_message", TodoRead: "agent_message",
};

function toolToEventType(name: string): EventType {
  return TOOL_TYPE_MAP[name] ?? "tool_call";
}

/** Build an AgentEvent from a transcript tool_use + optional tool_result */
function toolCallToEvent(
  sessionId: string,
  agent: AgentName,
  tool: { id: string; name: string; input: Record<string, unknown> },
  result: { content: string; isError: boolean } | undefined,
  timestamp: number
): AgentEvent {
  const type = toolToEventType(tool.name);
  const success = !result?.isError;
  const output = result?.content;

  const base: AgentEvent = {
    id: randomUUID(),
    sessionId,
    agent,
    timestamp,
    type,
    tool: tool.name,
    success,
    metadata: {},
  };

  switch (type) {
    case "file_read": {
      const path = (tool.input.path ?? tool.input.file_path) as string | undefined;
      return { ...base, file: path, output: output?.slice(0, 500) };
    }

    case "file_edit": {
      const path = (tool.input.path ?? tool.input.file_path) as string | undefined;
      const newStr = ((tool.input.new_string ?? tool.input.content ?? "") as string);
      const oldStr = ((tool.input.old_string ?? "") as string);
      const additions = newStr ? newStr.split("\n").length : undefined;
      const deletions = oldStr ? Math.max(0, oldStr.split("\n").length - 1) : undefined;
      return { ...base, file: path, additions, deletions };
    }

    case "shell": {
      const command = (tool.input.command ?? tool.input.cmd ?? "") as string;
      const isTest =
        /\b(jest|vitest|pytest|go test|npm test|yarn test|pnpm test|mocha|jasmine|rspec|cargo test)\b/i.test(
          command
        );
      const finalType: EventType = isTest ? "test_run" : "shell";

      let exitCode: number | undefined;
      if (output) {
        const m = output.match(/exit\s*code[:\s]+(\d+)/i);
        if (m) exitCode = parseInt(m[1], 10);
      }

      return {
        ...base,
        type: finalType,
        command: command.slice(0, 500),
        exitCode,
        output: output?.slice(0, 1000),
        success: exitCode != null ? exitCode === 0 : success,
      };
    }

    case "search": {
      const query = (
        tool.input.pattern ?? tool.input.query ?? tool.input.glob ?? tool.input.regex
      ) as string | undefined;
      const resultCount = output ? output.split("\n").filter((l) => l.trim()).length : undefined;
      return { ...base, query: query?.slice(0, 300), resultCount, output: output?.slice(0, 500) };
    }

    case "web": {
      const url = (tool.input.url ?? tool.input.query) as string | undefined;
      return { ...base, query: url?.slice(0, 500), output: output?.slice(0, 500) };
    }

    case "subagent": {
      const taskDesc = (tool.input.description ?? tool.input.prompt) as string | undefined;
      return { ...base, content: taskDesc?.slice(0, 500) };
    }

    default:
      return { ...base, output: output?.slice(0, 500) };
  }
}

// ─── Parse a single JSONL file ────────────────────────────────────────────────

interface ParsedSession {
  sessionId: string;
  cwd?: string;
  task?: string;
  model?: string;
  startTime: number;
  endTime?: number;
  status: "success" | "failed" | "unknown";
  events: AgentEvent[];
}

export function parseTranscript(filePath: string, encodedProjectDir: string): ParsedSession | null {
  const sessionId = basename(filePath, ".jsonl");
  const cwd = decodeCwd(encodedProjectDir);
  const agent: AgentName = "claude-code";

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;

  const entries: ClaudeEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as ClaudeEntry);
    } catch {
      // Skip malformed lines
    }
  }

  if (entries.length === 0) return null;

  // ── Extract metadata ─────────────────────────────────────────────────────

  let task: string | undefined;
  let model: string | undefined;
  let startTime = Date.now();
  let endTime: number | undefined;
  let status: "success" | "failed" | "unknown" = "unknown";

  // First timestamp determines session start
  const firstTs = entries[0]?.timestamp;
  if (firstTs) startTime = parseTs(firstTs);

  // Last result entry determines end state
  const resultEntry = entries.find(
    (e) => e.type === "result" || (e.subtype === "final_answer")
  );
  if (resultEntry) {
    endTime = parseTs(resultEntry.timestamp);
    status = resultEntry.isError || resultEntry.result === "error" ? "failed" : "success";
  } else {
    // If last entry has a timestamp, use it as end time
    const lastTs = entries[entries.length - 1]?.timestamp;
    if (lastTs) endTime = parseTs(lastTs);
  }

  // Detect model from any assistant entry
  for (const e of entries) {
    const m = e.model ?? e.message?.model;
    if (m) { model = String(m); break; }
  }

  // ── Build tool call → result pairs ───────────────────────────────────────
  // We iterate entries and build a pending map of tool_use_id → tool_use data.
  // When we find a tool_result we pair it up.

  const events: AgentEvent[] = [];
  const pendingToolCalls = new Map<string, {
    tool: { id: string; name: string; input: Record<string, unknown> };
    timestamp: number;
  }>();

  // Session start marker
  events.push({
    id: randomUUID(),
    sessionId,
    agent,
    timestamp: startTime,
    type: "session_start",
    content: "Session started (imported from transcript)",
  });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const ts = parseTs(entry.timestamp);

    // Get content from either the wrapper format or flat format
    const msgContent = entry.message?.content ?? entry.content;
    const role = entry.type ?? entry.message?.role;

    // ── User / Human messages ────────────────────────────────────────────
    if (role === "user" || role === "human") {
      if (typeof msgContent === "string" && msgContent.trim()) {
        // First substantive user message = task
        if (!task) {
          task = msgContent.slice(0, 500);
        }
      } else if (Array.isArray(msgContent)) {
        // Check for tool results
        const results = extractToolResults(msgContent);
        for (const [toolUseId, result] of results) {
          const pending = pendingToolCalls.get(toolUseId);
          if (pending) {
            events.push(
              toolCallToEvent(sessionId, agent, pending.tool, result, pending.timestamp)
            );
            pendingToolCalls.delete(toolUseId);
          }
        }

        // Also check if this is a plain user message (array with text blocks)
        const text = contentToString(msgContent);
        if (text.trim() && !task) {
          task = text.slice(0, 500);
        }
      }
    }

    // ── Assistant messages ───────────────────────────────────────────────
    if (role === "assistant") {
      const toolUses = extractToolUses(msgContent);
      for (const tu of toolUses) {
        pendingToolCalls.set(tu.id, { tool: tu, timestamp: ts });
      }
    }

    // ── Result / Summary messages ────────────────────────────────────────
    if (entry.type === "result" || entry.subtype === "final_answer") {
      const text = typeof entry.result === "string" ? entry.result : contentToString(msgContent);
      if (text) {
        events.push({
          id: randomUUID(),
          sessionId,
          agent,
          timestamp: ts,
          type: "agent_message",
          content: text.slice(0, 1000),
        });
      }
    }
  }

  // Flush any remaining tool calls that had no result (rare edge case)
  for (const [, pending] of pendingToolCalls) {
    events.push(
      toolCallToEvent(sessionId, agent, pending.tool, undefined, pending.timestamp)
    );
  }

  // Session end marker
  if (endTime) {
    events.push({
      id: randomUUID(),
      sessionId,
      agent,
      timestamp: endTime,
      type: "session_end",
      success: status !== "failed",
      content: `Session ended (${status})`,
    });
  }

  return { sessionId, cwd, task, model, startTime, endTime, status, events };
}

// ─── Import all transcripts ───────────────────────────────────────────────────

export function importTranscripts(opts: {
  force?: boolean; // re-import even if session already in DB
  onProgress?: (msg: string) => void;
} = {}): ImportStats {
  const stats: ImportStats = { scanned: 0, imported: 0, skipped: 0, errors: 0, sessions: [] };

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    // ~/.claude/projects doesn't exist — Claude Code not installed or never run
    return stats;
  }

  for (const projectDir of projectDirs) {
    const projectPath = join(CLAUDE_PROJECTS_DIR, projectDir);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      stats.scanned++;
      const filePath = join(projectPath, file);
      const sessionId = basename(file, ".jsonl");

      // Skip if already in DB (unless forced)
      if (!opts.force && getSessionById(sessionId)) {
        stats.skipped++;
        continue;
      }

      try {
        const parsed = parseTranscript(filePath, projectDir);
        if (!parsed) {
          stats.skipped++;
          continue;
        }

        // Write session
        upsertSession({
          id: parsed.sessionId,
          agent: "claude-code",
          model: parsed.model,
          task: parsed.task,
          cwd: parsed.cwd,
          startTime: parsed.startTime,
        });

        if (parsed.task) setSessionTask(parsed.sessionId, parsed.task);

        // Write events
        for (const event of parsed.events) {
          try {
            insertEvent(event);
          } catch {
            // Duplicate or malformed — skip individual events
          }
        }

        // Mark session end
        if (parsed.endTime) {
          endSession(parsed.sessionId, parsed.status);
        }

        stats.imported++;
        stats.sessions.push({
          id: parsed.sessionId,
          task: parsed.task,
          events: parsed.events.length,
        });

        opts.onProgress?.(
          `Imported session ${parsed.sessionId.slice(0, 8)}… (${parsed.events.length} events)`
        );
      } catch (err) {
        stats.errors++;
        opts.onProgress?.(`Error importing ${file}: ${String(err)}`);
      }
    }
  }

  return stats;
}

// ─── Watch mode ───────────────────────────────────────────────────────────────

/** Files we are actively watching (path → last mtime) */
const watchedFiles = new Map<string, number>();

/**
 * Watch ~/.claude/projects/ for new or updated JSONL files.
 * Calls onChange whenever a new session is imported.
 *
 * Returns an unsubscribe function.
 */
export function watchTranscripts(onChange: (sessionId: string) => void): () => void {
  let running = true;

  // Poll every 5 seconds — fs.watch on macOS directories misses nested changes
  const tick = () => {
    if (!running) return;

    let projectDirs: string[];
    try {
      projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
    } catch {
      return;
    }

    for (const projectDir of projectDirs) {
      const projectPath = join(CLAUDE_PROJECTS_DIR, projectDir);
      let files: string[];
      try {
        files = readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = join(projectPath, file);
        let mtime: number;
        try {
          mtime = statSync(filePath).mtimeMs;
        } catch {
          continue;
        }

        const lastMtime = watchedFiles.get(filePath);

        // New file, or file was updated
        if (lastMtime === undefined || mtime > lastMtime) {
          watchedFiles.set(filePath, mtime);

          const sessionId = basename(file, ".jsonl");
          const existing = getSessionById(sessionId);

          // Only re-import if new OR the session is still marked running
          if (!existing || existing.status === "running") {
            try {
              const parsed = parseTranscript(filePath, projectDir);
              if (!parsed) continue;

              upsertSession({
                id: parsed.sessionId,
                agent: "claude-code",
                model: parsed.model,
                task: parsed.task,
                cwd: parsed.cwd,
                startTime: parsed.startTime,
              });

              if (parsed.task) setSessionTask(parsed.sessionId, parsed.task);

              for (const event of parsed.events) {
                try { insertEvent(event); } catch { /* deduplicate */ }
              }

              if (parsed.endTime) {
                endSession(parsed.sessionId, parsed.status);
              }

              onChange(parsed.sessionId);
            } catch {
              // Ignore per-file errors in watch mode
            }
          }
        }
      }
    }
  };

  // Initial scan
  tick();

  // Poll every 5 s
  const timer = setInterval(tick, 5000);

  return () => {
    running = false;
    clearInterval(timer);
  };
}

// ─── List available transcripts ───────────────────────────────────────────────

export interface TranscriptInfo {
  sessionId: string;
  projectDir: string;
  cwd: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: number;
  alreadyImported: boolean;
}

export function listTranscripts(): TranscriptInfo[] {
  const results: TranscriptInfo[] = [];

  // Get all already-imported session IDs
  const importedIds = new Set(getAllSessions(10000).map((s) => s.id));

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return results;
  }

  for (const projectDir of projectDirs) {
    const projectPath = join(CLAUDE_PROJECTS_DIR, projectDir);
    try {
      if (!statSync(projectPath).isDirectory()) continue;
    } catch {
      continue;
    }

    let files: string[];
    try {
      files = readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(projectPath, file);
      try {
        const s = statSync(filePath);
        const sessionId = basename(file, ".jsonl");
        results.push({
          sessionId,
          projectDir,
          cwd: decodeCwd(projectDir),
          filePath,
          sizeBytes: s.size,
          modifiedAt: s.mtimeMs,
          alreadyImported: importedIds.has(sessionId),
        });
      } catch {
        continue;
      }
    }
  }

  return results.sort((a, b) => b.modifiedAt - a.modifiedAt);
}
