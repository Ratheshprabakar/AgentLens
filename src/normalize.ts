import { randomUUID } from "crypto";
import type {
  AgentEvent,
  EventType,
  ClaudePostToolUseInput,
  ClaudePreToolUseInput,
  ClaudeStopInput,
  ClaudeNotificationInput,
  ClaudeHookInput,
} from "./types.js";

// ─── Tool → EventType mapping ─────────────────────────────────────────────────

/**
 * Maps Claude Code tool names to AgentLens event types.
 * Claude Code uses both old and new naming conventions, so we handle both.
 */
const TOOL_TYPE_MAP: Record<string, EventType> = {
  // File reads
  Read: "file_read",
  ReadFile: "file_read",
  LS: "file_read",
  ListDirectory: "file_read",

  // File edits
  Write: "file_edit",
  WriteFile: "file_edit",
  CreateFile: "file_edit",
  Edit: "file_edit",
  MultiEdit: "file_edit",
  StrReplace: "file_edit",
  NotebookEdit: "file_edit",

  // Shell
  Bash: "shell",
  Shell: "shell",

  // Search
  Glob: "search",
  Find: "search",
  Grep: "search",
  GrepSearch: "search",
  FileSearch: "search",
  Search: "search",
  RipgrepSearch: "search",

  // Web
  WebSearch: "web",
  WebFetch: "web",

  // Subagents
  Task: "subagent",
  Agent: "subagent",

  // Context management
  CompactContext: "context_compaction",
  ContextCompaction: "context_compaction",

  // Ignored / benign
  TodoWrite: "agent_message",
  TodoRead: "agent_message",
};

function toolToEventType(toolName: string): EventType {
  return TOOL_TYPE_MAP[toolName] ?? "tool_call";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse diff stats from Bash/shell output — rough heuristic. */
function parseDiffStats(output?: string): { additions?: number; deletions?: number } {
  if (!output) return {};
  // e.g. "+14 lines, -3 lines" or "14 insertions(+), 3 deletions(-)"
  const addMatch = output.match(/(\d+)\s+insertion/i) ?? output.match(/\+(\d+)/);
  const delMatch = output.match(/(\d+)\s+deletion/i) ?? output.match(/-(\d+)/);
  return {
    additions: addMatch ? parseInt(addMatch[1], 10) : undefined,
    deletions: delMatch ? parseInt(delMatch[1], 10) : undefined,
  };
}

/** Extract exit code from tool_response result string. */
function extractExitCode(response: ClaudePostToolUseInput["tool_response"]): number | undefined {
  if (response.type === "tool_result" || response.type === "result") {
    const result = response.result ?? "";
    // Claude Code often puts exit code in the result as "Exit code: N"
    const match = result.match(/exit\s*code[:\s]+(\d+)/i);
    if (match) return parseInt(match[1], 10);
  }
  return undefined;
}

/** Build output snippet (truncated to 2000 chars for storage). */
function buildOutput(response: ClaudePostToolUseInput["tool_response"]): string | undefined {
  const raw = response.result ?? response.error ?? response.system;
  if (!raw) return undefined;
  return raw.length > 2000 ? raw.slice(0, 2000) + "\n…[truncated]" : raw;
}

/** Detect test results in shell output. */
function detectTestResult(command: string, output: string): { isTest: boolean; success: boolean } {
  const isTest =
    /\b(jest|vitest|pytest|go test|npm test|yarn test|pnpm test|mocha|jasmine|rspec|cargo test|dotnet test)\b/i.test(
      command
    );
  if (!isTest) return { isTest: false, success: true };

  const failed =
    /(\d+\s+failed|FAIL|✕|✗|FAILED|Tests failed|failing)/i.test(output) &&
    !/0\s+failed/i.test(output);

  return { isTest: true, success: !failed };
}

// ─── PostToolUse normalizer ───────────────────────────────────────────────────

export function normalizePostToolUse(input: ClaudePostToolUseInput): AgentEvent {
  const type = toolToEventType(input.tool_name);
  const now = Date.now();
  const output = buildOutput(input.tool_response);
  const success = input.tool_response.type !== "error" && !input.tool_response.error;

  const base: AgentEvent = {
    id: randomUUID(),
    sessionId: input.session_id,
    agent: "claude-code",
    timestamp: now,
    type,
    tool: input.tool_name,
    success,
    metadata: {
      cwd: input.cwd,
      hook_event: input.hook_event_name,
    },
  };

  switch (type) {
    case "file_read": {
      const path = (input.tool_input.path ?? input.tool_input.file_path) as string | undefined;
      const pattern = (input.tool_input.pattern ?? input.tool_input.glob) as string | undefined;
      return {
        ...base,
        file: path,
        query: pattern,
        content: output?.slice(0, 500),
      };
    }

    case "file_edit": {
      const path = (input.tool_input.path ?? input.tool_input.file_path) as string | undefined;
      const newStr = (input.tool_input.new_string ?? input.tool_input.content ?? "") as string;
      const oldStr = (input.tool_input.old_string ?? "") as string;
      const additions = newStr.split("\n").length;
      const deletions = oldStr.split("\n").length - 1;
      return {
        ...base,
        file: path,
        additions: additions > 0 ? additions : undefined,
        deletions: deletions > 0 ? deletions : undefined,
      };
    }

    case "shell": {
      const command = (input.tool_input.command ?? input.tool_input.cmd ?? "") as string;
      const exitCode = extractExitCode(input.tool_response);
      const testResult = output ? detectTestResult(command, output) : null;

      // Upgrade to test_run type if it looks like a test command
      const finalType: EventType = testResult?.isTest ? "test_run" : "shell";
      const finalSuccess = exitCode != null ? exitCode === 0 : (testResult?.success ?? success);

      return {
        ...base,
        type: finalType,
        command: command.slice(0, 500),
        exitCode,
        output: output?.slice(0, 1000),
        success: finalSuccess,
      };
    }

    case "search": {
      const query =
        (input.tool_input.pattern ??
          input.tool_input.query ??
          input.tool_input.glob ??
          input.tool_input.regex) as string | undefined;

      // Count result lines as rough proxy for result count
      const resultCount = output
        ? output.split("\n").filter((l) => l.trim()).length
        : undefined;

      return {
        ...base,
        query: query?.slice(0, 300),
        resultCount,
        output: output?.slice(0, 500),
      };
    }

    case "web": {
      const url = (input.tool_input.url ?? input.tool_input.query) as string | undefined;
      return {
        ...base,
        query: url?.slice(0, 500),
        output: output?.slice(0, 500),
      };
    }

    case "subagent": {
      const taskDesc = (input.tool_input.description ?? input.tool_input.prompt) as string | undefined;
      return {
        ...base,
        content: taskDesc?.slice(0, 500),
      };
    }

    case "error": {
      return {
        ...base,
        content: output?.slice(0, 500),
        success: false,
      };
    }

    default: {
      return {
        ...base,
        output: output?.slice(0, 500),
      };
    }
  }
}

// ─── PreToolUse normalizer (session start detection) ─────────────────────────

/**
 * We emit a synthetic session_start event on the very first PreToolUse
 * for a new session_id. The DB will ignore duplicate inserts.
 */
export function normalizePreToolUse(input: ClaudePreToolUseInput): AgentEvent | null {
  // Only emit session_start for first call — the DB upsertSession handles dedup
  return {
    id: randomUUID(),
    sessionId: input.session_id,
    agent: "claude-code",
    timestamp: Date.now(),
    type: "session_start",
    tool: input.tool_name,
    content: "Session started",
    metadata: {
      cwd: input.cwd,
      first_tool: input.tool_name,
    },
  };
}

// ─── Stop normalizer ──────────────────────────────────────────────────────────

export function normalizeStop(input: ClaudeStopInput): AgentEvent {
  return {
    id: randomUUID(),
    sessionId: input.session_id,
    agent: "claude-code",
    timestamp: Date.now(),
    type: "session_end",
    success: true,
    content: "Session completed",
    metadata: {
      cwd: input.cwd,
    },
  };
}

// ─── Notification normalizer ──────────────────────────────────────────────────

export function normalizeNotification(input: ClaudeNotificationInput): AgentEvent {
  return {
    id: randomUUID(),
    sessionId: input.session_id,
    agent: "claude-code",
    timestamp: Date.now(),
    type: "agent_message",
    content: input.message.slice(0, 1000),
  };
}

// ─── Main entry: parse any Claude hook input ──────────────────────────────────

export function normalizeClaude(raw: unknown): AgentEvent[] {
  const input = raw as ClaudeHookInput;
  const events: AgentEvent[] = [];

  switch (input.hook_event_name) {
    case "PostToolUse": {
      events.push(normalizePostToolUse(input as ClaudePostToolUseInput));
      break;
    }
    case "PreToolUse": {
      const e = normalizePreToolUse(input as ClaudePreToolUseInput);
      if (e) events.push(e);
      break;
    }
    case "Stop": {
      events.push(normalizeStop(input as ClaudeStopInput));
      break;
    }
    case "Notification": {
      events.push(normalizeNotification(input as ClaudeNotificationInput));
      break;
    }
    default: {
      // Unknown hook type — skip
      break;
    }
  }

  return events;
}
