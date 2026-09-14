export function formatDuration(ms?: number): string {
  if (ms == null || ms < 0) return "-";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  if (min < 60) return `${min}m ${sec.toString().padStart(2, "0")}s`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function formatOffset(baseMs: number, ts: number): string {
  const diffSec = Math.max(0, Math.floor((ts - baseMs) / 1000));
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export function agentLabel(agent: string): string {
  if (agent === "claude-code") return "Claude";
  if (agent === "cursor") return "Cursor";
  return agent;
}

export type AgentFilter = "all" | "cursor" | "claude-code";

export function matchesAgent(agent: string, filter: AgentFilter): boolean {
  if (filter === "all") return true;
  return agent === filter;
}
