import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { getSessions, deleteSession, type Session } from "../api.ts";
import "./Sessions.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function groupSessionsByDay(sessions: Session[]): Array<{ label: string; sessions: Session[] }> {
  const groups = new Map<string, Session[]>();
  const now = new Date();

  for (const s of sessions) {
    const d = new Date(s.startTime);
    let label: string;

    const diffDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) label = "Today";
    else if (diffDays === 1) label = "Yesterday";
    else if (diffDays < 7) label = d.toLocaleDateString([], { weekday: "long" });
    else label = d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(s);
  }

  return Array.from(groups.entries()).map(([label, sessions]) => ({ label, sessions }));
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Session["status"] }) {
  const map = {
    running: { label: "Running", className: "badge badge--running" },
    success: { label: "Success", className: "badge badge--success" },
    failed:  { label: "Failed",  className: "badge badge--error" },
    unknown: { label: "Unknown", className: "badge badge--neutral" },
  };
  const { label, className } = map[status] ?? map.unknown;
  return <span className={className}>{label}</span>;
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({
  session,
  onDelete,
}: {
  session: Session;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const duration =
    session.duration ??
    (session.endTime ? session.endTime - session.startTime : Date.now() - session.startTime);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirming) {
      onDelete(session.id);
    } else {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
    }
  };

  return (
    <Link to={`/sessions/${session.id}`} className="session-card">
      <div className="session-card__header">
        <div className="session-card__title">
          <span className="session-card__task">
            {session.task ?? "Unnamed session"}
          </span>
          <StatusBadge status={session.status} />
        </div>
        <div className="session-card__meta">
          <span className="session-card__agent">{session.agent}</span>
          <span className="session-card__dot">·</span>
          <span>{formatTime(session.startTime)}</span>
          <span className="session-card__dot">·</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="session-card__stats">
        <Stat label="events" value={session.eventCount} />
        <Stat label="reads" value={session.fileReads} />
        <Stat label="edits" value={session.fileEdits} />
        <Stat label="shell" value={session.shellCommands} />
        {session.errors > 0 && (
          <Stat label="errors" value={session.errors} danger />
        )}
      </div>

      <button
        className={`session-card__delete ${confirming ? "session-card__delete--confirming" : ""}`}
        onClick={handleDelete}
        title="Delete session"
        aria-label="Delete session"
      >
        {confirming ? "Confirm" : "×"}
      </button>
    </Link>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <span className={`session-stat ${danger ? "session-stat--danger" : ""}`}>
      <span className="session-stat__value">{value}</span>
      <span className="session-stat__label">{label}</span>
    </span>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">◎</div>
      <div className="empty-state__title">No sessions yet</div>
      <div className="empty-state__body">
        Sessions will appear here as Claude Code agents run.
        <br />
        Make sure the collector is running and hooks are installed.
      </div>
      <div className="empty-state__steps">
        <div className="empty-state__step">
          <code>agentlens install</code>
          <span>Install Claude Code hooks</span>
        </div>
        <div className="empty-state__step">
          <code>agentlens start</code>
          <span>Start the collector</span>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const data = await getSessions();
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, lastRefresh]);

  // Auto-refresh every 5 seconds if any session is running
  useEffect(() => {
    const hasRunning = sessions.some((s) => s.status === "running");
    if (!hasRunning) return;
    const timer = setInterval(() => setLastRefresh(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [sessions]);

  const handleDelete = async (id: string) => {
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // Ignore
    }
  };

  const filtered = search
    ? sessions.filter(
        (s) =>
          s.task?.toLowerCase().includes(search.toLowerCase()) ||
          s.agent.toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  const groups = groupSessionsByDay(filtered);

  const runningCount = sessions.filter((s) => s.status === "running").length;
  const successRate =
    sessions.length > 0
      ? Math.round(
          (sessions.filter((s) => s.status === "success").length / sessions.filter((s) => s.status !== "running").length) *
            100
        )
      : 0;

  return (
    <div className="sessions-page">
      {/* Header */}
      <header className="page-header">
        <div className="page-header__brand">
          <span className="page-header__logo">◉</span>
          <span className="page-header__title">AgentLens</span>
          <span className="page-header__tag">v0.1</span>
        </div>
        <div className="page-header__right">
          {runningCount > 0 && (
            <span className="live-badge">
              <span className="live-badge__dot" />
              {runningCount} running
            </span>
          )}
          <button
            className="btn btn--ghost"
            onClick={() => setLastRefresh(Date.now())}
            title="Refresh"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      <div className="sessions-page__body">
        {/* Summary strip */}
        {sessions.length > 0 && (
          <div className="summary-strip">
            <div className="summary-strip__item">
              <span className="summary-strip__value">{sessions.length}</span>
              <span className="summary-strip__label">total sessions</span>
            </div>
            {sessions.filter((s) => s.status !== "running").length > 0 && (
              <div className="summary-strip__item">
                <span className="summary-strip__value">{successRate}%</span>
                <span className="summary-strip__label">success rate</span>
              </div>
            )}
            {runningCount > 0 && (
              <div className="summary-strip__item">
                <span className="summary-strip__value running-dot">{runningCount}</span>
                <span className="summary-strip__label">running</span>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        {sessions.length > 0 && (
          <div className="search-bar">
            <span className="search-bar__icon">⌕</span>
            <input
              className="search-bar__input"
              type="text"
              placeholder="Search sessions by task or agent…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-bar__clear" onClick={() => setSearch("")}>
                ×
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <span>Loading sessions…</span>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-state__icon">⚠</div>
            <div className="error-state__title">Could not load sessions</div>
            <div className="error-state__body">{error}</div>
            <button className="btn btn--primary" onClick={() => setLastRefresh(Date.now())}>
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          search ? (
            <div className="empty-state">
              <div className="empty-state__icon">⌕</div>
              <div className="empty-state__title">No matching sessions</div>
              <div className="empty-state__body">Try a different search term.</div>
            </div>
          ) : (
            <EmptyState />
          )
        ) : (
          <div className="session-groups">
            {groups.map((group) => (
              <div key={group.label} className="session-group">
                <div className="session-group__label">{group.label}</div>
                <div className="session-list">
                  {group.sessions.map((s) => (
                    <SessionCard key={s.id} session={s} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
