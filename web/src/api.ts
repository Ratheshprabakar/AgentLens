/**
 * AgentLens API client.
 * Matches the server routes defined in src/server.ts.
 */

export interface AgentEvent {
  id: string;
  sessionId: string;
  agent: string;
  timestamp: number;
  type: string;
  tool?: string;
  command?: string;
  exitCode?: number;
  output?: string;
  file?: string;
  additions?: number;
  deletions?: number;
  query?: string;
  resultCount?: number;
  duration?: number;
  success?: boolean;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface Session {
  id: string;
  agent: string;
  model?: string;
  task?: string;
  cwd?: string;
  startTime: number;
  endTime?: number;
  status: "running" | "success" | "failed" | "unknown";
  eventCount: number;
  fileReads: number;
  fileEdits: number;
  shellCommands: number;
  searches: number;
  errors: number;
  duration?: number;
}

const BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getSessions(): Promise<{ sessions: Session[] }> {
  return apiFetch<{ sessions: Session[] }>("/sessions");
}

export async function getSession(id: string): Promise<{ session: Session; events: AgentEvent[] }> {
  return apiFetch<{ session: Session; events: AgentEvent[] }>(`/sessions/${id}`);
}

export async function deleteSession(id: string): Promise<void> {
  await apiFetch(`/sessions/${id}`, { method: "DELETE" });
}

export async function getHealth(): Promise<{ status: string }> {
  return apiFetch<{ status: string }>("/health");
}

// ─── Import API ───────────────────────────────────────────────────────────────

export interface TranscriptInfo {
  sessionId: string;
  projectDir: string;
  cwd: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: number;
  alreadyImported: boolean;
  agent?: "claude-code" | "cursor";
}

export interface ImportStats {
  scanned: number;
  imported: number;
  skipped: number;
  errors: number;
  sessions: Array<{ id: string; task?: string; events: number }>;
}

export async function listTranscripts(): Promise<{ transcripts: TranscriptInfo[] }> {
  return apiFetch<{ transcripts: TranscriptInfo[] }>("/import/transcripts");
}

export async function runImport(force = false): Promise<{ ok: boolean; stats: ImportStats }> {
  return apiFetch<{ ok: boolean; stats: ImportStats }>("/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
}
