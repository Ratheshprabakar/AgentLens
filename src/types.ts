// ─── Core Event Model ────────────────────────────────────────────────────────

export type EventType =
  | "session_start"
  | "session_end"
  | "user_message"
  | "agent_message"
  | "file_read"
  | "file_edit"
  | "shell"
  | "search"
  | "web"
  | "test_run"
  | "error"
  | "subagent"
  | "context_compaction"
  | "tool_call"; // catch-all for unknown tools

export type SessionStatus = "running" | "success" | "failed" | "unknown";

export type AgentName = "claude-code" | "cursor" | "codex" | "gemini-cli" | string;

/**
 * Normalized event — the single unit of observability across all agent adapters.
 * Every adapter (Claude Code, Cursor, …) converts its native events into this schema.
 */
export interface AgentEvent {
  /** UUID for this event */
  id: string;
  /** Session this event belongs to */
  sessionId: string;
  /** Which agent produced this event */
  agent: AgentName;
  /** Unix timestamp (ms) when this event occurred */
  timestamp: number;
  /** Semantic event type */
  type: EventType;

  // ── Tool / Shell ──
  /** Original tool name (e.g. "Bash", "Write", "Grep") */
  tool?: string;
  /** Shell command string */
  command?: string;
  /** Shell exit code */
  exitCode?: number;
  /** Output snippet (stdout/stderr, truncated) */
  output?: string;

  // ── File ──
  /** Affected file path */
  file?: string;
  /** Lines added */
  additions?: number;
  /** Lines removed */
  deletions?: number;

  // ── Search ──
  /** Search query string */
  query?: string;
  /** Number of results returned */
  resultCount?: number;

  // ── Timing ──
  /** Duration of this event in milliseconds */
  duration?: number;

  // ── Outcome ──
  /** Whether the operation succeeded */
  success?: boolean;

  // ── Content ──
  /** Short human-readable description or message content */
  content?: string;

  // ── Metadata ──
  /** Agent-specific extra data (stringified JSON in DB) */
  metadata?: Record<string, unknown>;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  agent: AgentName;
  model?: string;
  /** First prompt / task description */
  task?: string;
  /** Working directory */
  cwd?: string;
  startTime: number;
  endTime?: number;
  status: SessionStatus;
  /** Cached counts (updated on each ingest) */
  eventCount: number;
  fileReads: number;
  fileEdits: number;
  shellCommands: number;
  searches: number;
  errors: number;
}

export interface SessionSummary extends Session {
  duration?: number; // endTime - startTime
}

// ─── HTTP API payloads ────────────────────────────────────────────────────────

/** Payload sent by the Claude Code hook to POST /api/events */
export interface IngestPayload {
  event: Omit<AgentEvent, "id">;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

export interface SessionDetailResponse {
  session: SessionSummary;
  events: AgentEvent[];
}

// ─── Claude Code Hook Input ───────────────────────────────────────────────────

/** JSON that Claude Code sends to a PostToolUse hook via stdin */
export interface ClaudePostToolUseInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: {
    type: string;
    result?: string;
    error?: string;
    system?: string;
  };
}

/** JSON that Claude Code sends to a PreToolUse hook via stdin */
export interface ClaudePreToolUseInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/** JSON that Claude Code sends to a Stop hook via stdin */
export interface ClaudeStopInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name: "Stop";
  stop_hook_active: boolean;
}

/** JSON that Claude Code sends to a Notification hook via stdin */
export interface ClaudeNotificationInput {
  session_id: string;
  hook_event_name: "Notification";
  message: string;
}

export type ClaudeHookInput =
  | ClaudePostToolUseInput
  | ClaudePreToolUseInput
  | ClaudeStopInput
  | ClaudeNotificationInput;
