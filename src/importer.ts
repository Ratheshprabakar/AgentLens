/**
 * AgentLens Transcript Importer
 *
 * Reads Claude Code's JSONL transcript files from the Claude projects directory
 * (default: ~/.claude/projects/, or /claude-projects when running in Docker)
 * and backfills sessions into the database.
 *
 * Claude Code writes one .jsonl per session:
 *   <projects-dir>/<encoded-project-path>/<session-uuid>.jsonl
 */

import { readFileSync, readdirSync, statSync } from "fs";
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

/**
 * In Docker, ~/.claude/projects is mounted as /claude-projects.
 * The CLAUDE_PROJECTS_DIR env var overrides the default.
 */
export const CLAUDE_PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR ??
  join(homedir(), ".claude", "projects");

// ─── Claude Code JSONL types ──────────────────────────────────────────────────

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: string; [key: string]: unknown };

interface ClaudeEntry {
  type?: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  content?: string | ContentBlock[];
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  costUSD?: number;
  durationMs?: number;
  model?: string;
  result?: string;
  isError?: boolean;
  [key: string]: unknown;
}

// ─── Import stats ─────────────────────────────────────────────────────────────

export interface ImportStats {
  scanned: number;
  imported: number;
  skipped: number;
  errors: number;
  sessions: Array<{ id: string; task?: string; events: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeCwd(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

function parseTs(ts?: string): number {
  if (!ts) return Date.now();
  const ms = Date.parse(ts);
  return isNaN(ms) ? Date.now() : ms;
}

function contentToString(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}

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

function extractToolResults(content: string | ContentBlock[] | undefined): Map<string, { content: string; isError: boolean }> {
  const results = new Map<string, { content: string; isError: boolean }>();
  if (!content || typeof content === "string") return results;
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const r = block as { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean };
    const text = typeof r.content === "string" ? r.content : contentToString(r.content as ContentBlock[]);
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
    case "file_read":
      return {
        ...base,
        file: (tool.input.path ?? tool.input.file_path) as string | undefined,
        output: output?.slice(0, 500),
      };

    case "file_edit": {
      const newStr = (tool.input.new_string ?? tool.input.content ?? "") as string;
      const oldStr = (tool.input.old_string ?? "") as string;
      return {
        ...base,
        file: (tool.input.path ?? tool.input.file_path) as string | undefined,
        additions: newStr ? newStr.split("\n").length : undefined,
        deletions: oldStr ? Math.max(0, oldStr.split("\n").length - 1) : undefined,
      };
    }

    case "shell": {
      const command = (tool.input.command ?? tool.input.cmd ?? "") as string;
      const isTest = /\b(jest|vitest|pytest|go test|npm test|yarn test|pnpm test|mocha|jasmine|rspec|cargo test)\b/i.test(command);
      let exitCode: number | undefined;
      if (output) {
        const m = output.match(/exit\s*code[:\s]+(\d+)/i);
        if (m) exitCode = parseInt(m[1], 10);
      }
      return {
        ...base,
        type: isTest ? "test_run" : "shell",
        command: command.slice(0, 500),
        exitCode,
        output: output?.slice(0, 1000),
        success: exitCode != null ? exitCode === 0 : success,
      };
    }

    case "search": {
      const query = (tool.input.pattern ?? tool.input.query ?? tool.input.glob ?? tool.input.regex) as string | undefined;
      const resultCount = output ? output.split("\n").filter((l) => l.trim()).length : undefined;
      return { ...base, query: query?.slice(0, 300), resultCount, output: output?.slice(0, 500) };
    }

    case "web":
      return { ...base, query: ((tool.input.url ?? tool.input.query) as string | undefined)?.slice(0, 500), output: output?.slice(0, 500) };

    case "subagent":
      return { ...base, content: ((tool.input.description ?? tool.input.prompt) as string | undefined)?.slice(0, 500) };

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

  const entries: ClaudeEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as ClaudeEntry);
    } catch {
      // Skip malformed lines
    }
  }
  if (entries.length === 0) return null;

  let task: string | undefined;
  let model: string | undefined;
  let startTime = Date.now();
  let endTime: number | undefined;
  let status: "success" | "failed" | "unknown" = "unknown";

  if (entries[0]?.timestamp) startTime = parseTs(entries[0].timestamp);

  const resultEntry = entries.find((e) => e.type === "result" || e.subtype === "final_answer");
  if (resultEntry) {
    endTime = parseTs(resultEntry.timestamp);
    status = resultEntry.isError || resultEntry.result === "error" ? "failed" : "success";
  } else {
    const lastTs = entries[entries.length - 1]?.timestamp;
    if (lastTs) endTime = parseTs(lastTs);
  }

  for (const e of entries) {
    const m = e.model ?? e.message?.model;
    if (m) { model = String(m); break; }
  }

  const events: AgentEvent[] = [];
  const pendingToolCalls = new Map<string, { tool: { id: string; name: string; input: Record<string, unknown> }; timestamp: number }>();

  events.push({
    id: randomUUID(),
    sessionId,
    agent,
    timestamp: startTime,
    type: "session_start",
    content: "Session started (imported from transcript)",
  });

  for (const entry of entries) {
    const ts = parseTs(entry.timestamp);
    const msgContent = entry.message?.content ?? entry.content;
    const role = entry.type ?? entry.message?.role;

    if (role === "user" || role === "human") {
      if (typeof msgContent === "string" && msgContent.trim()) {
        if (!task) task = msgContent.slice(0, 500);
      } else if (Array.isArray(msgContent)) {
        const results = extractToolResults(msgContent);
        for (const [toolUseId, result] of results) {
          const pending = pendingToolCalls.get(toolUseId);
          if (pending) {
            events.push(toolCallToEvent(sessionId, agent, pending.tool, result, pending.timestamp));
            pendingToolCalls.delete(toolUseId);
          }
        }
        const text = contentToString(msgContent);
        if (text.trim() && !task) task = text.slice(0, 500);
      }
    }

    if (role === "assistant") {
      for (const tu of extractToolUses(msgContent)) {
        pendingToolCalls.set(tu.id, { tool: tu, timestamp: ts });
      }
    }

    if (entry.type === "result" || entry.subtype === "final_answer") {
      const text = typeof entry.result === "string" ? entry.result : contentToString(msgContent);
      if (text) {
        events.push({ id: randomUUID(), sessionId, agent, timestamp: ts, type: "agent_message", content: text.slice(0, 1000) });
      }
    }
  }

  // Flush unmatched tool calls
  for (const [, pending] of pendingToolCalls) {
    events.push(toolCallToEvent(sessionId, agent, pending.tool, undefined, pending.timestamp));
  }

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

export async function importTranscripts(opts: {
  force?: boolean;
  onProgress?: (msg: string) => void;
} = {}): Promise<ImportStats> {
  const stats: ImportStats = { scanned: 0, imported: 0, skipped: 0, errors: 0, sessions: [] };

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return stats; // ~/.claude/projects doesn't exist
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
      stats.scanned++;
      const filePath = join(projectPath, file);
      const sessionId = basename(file, ".jsonl");

      // Skip already-imported sessions unless forced
      if (!opts.force) {
        const existing = await getSessionById(sessionId);
        if (existing) {
          stats.skipped++;
          continue;
        }
      }

      try {
        const parsed = parseTranscript(filePath, projectDir);
        if (!parsed) {
          stats.skipped++;
          continue;
        }

        await upsertSession({
          id: parsed.sessionId,
          agent: "claude-code",
          model: parsed.model,
          task: parsed.task,
          cwd: parsed.cwd,
          startTime: parsed.startTime,
        });

        if (parsed.task) await setSessionTask(parsed.sessionId, parsed.task);

        for (const event of parsed.events) {
          try {
            await insertEvent(event);
          } catch {
            // Duplicate or malformed — skip
          }
        }

        if (parsed.endTime) {
          await endSession(parsed.sessionId, parsed.status);
        }

        stats.imported++;
        stats.sessions.push({ id: parsed.sessionId, task: parsed.task, events: parsed.events.length });
        opts.onProgress?.(`Imported ${parsed.sessionId.slice(0, 8)}… (${parsed.events.length} events)`);
      } catch (err) {
        stats.errors++;
        opts.onProgress?.(`Error importing ${file}: ${String(err)}`);
      }
    }
  }

  return stats;
}

// ─── Watch mode ───────────────────────────────────────────────────────────────

const watchedFiles = new Map<string, number>();

export function watchTranscripts(onChange: (sessionId: string) => void): () => void {
  let running = true;

  const tick = async () => {
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
        if (!statSync(projectPath).isDirectory()) continue;
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
        if (lastMtime !== undefined && mtime <= lastMtime) continue;

        watchedFiles.set(filePath, mtime);
        const sessionId = basename(file, ".jsonl");

        try {
          const existing = await getSessionById(sessionId);
          if (existing && existing.status !== "running") continue;

          const parsed = parseTranscript(filePath, projectDir);
          if (!parsed) continue;

          await upsertSession({
            id: parsed.sessionId,
            agent: "claude-code",
            model: parsed.model,
            task: parsed.task,
            cwd: parsed.cwd,
            startTime: parsed.startTime,
          });

          if (parsed.task) await setSessionTask(parsed.sessionId, parsed.task);
          for (const event of parsed.events) {
            try { await insertEvent(event); } catch { /* deduplicate */ }
          }
          if (parsed.endTime) await endSession(parsed.sessionId, parsed.status);

          onChange(parsed.sessionId);
        } catch {
          // Ignore per-file errors in watch mode
        }
      }
    }
  };

  // Initial scan then poll every 5 s
  void tick();
  const timer = setInterval(() => void tick(), 5000);

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

export async function listTranscripts(): Promise<TranscriptInfo[]> {
  const results: TranscriptInfo[] = [];
  const importedIds = new Set((await getAllSessions(10000)).map((s) => s.id));

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
