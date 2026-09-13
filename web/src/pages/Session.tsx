import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getSession, type Session, type AgentEvent } from "../api.ts";
import "./Session.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_FILTERS = ["All", "Files", "Shell", "Search", "Tests", "Errors"] as const;
type FilterKey = typeof EVENT_FILTERS[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min === 0 ? `${sec}s` : `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function formatRelativeTime(baseMs: number, ts: number): string {
  const diffMs = ts - baseMs;
  const diffSec = Math.floor(diffMs / 1000);
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function matchesFilter(event: AgentEvent, filter: FilterKey): boolean {
  switch (filter) {
    case "All":    return true;
    case "Files":  return event.type === "file_read" || event.type === "file_edit";
    case "Shell":  return event.type === "shell";
    case "Search": return event.type === "search";
    case "Tests":  return event.type === "test_run";
    case "Errors": return event.type === "error" || event.success === false;
    default:       return true;
  }
}

function eventMatchesSearch(event: AgentEvent, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    (event.file?.toLowerCase().includes(lower) ?? false) ||
    (event.command?.toLowerCase().includes(lower) ?? false) ||
    (event.query?.toLowerCase().includes(lower) ?? false) ||
    (event.content?.toLowerCase().includes(lower) ?? false) ||
    (event.tool?.toLowerCase().includes(lower) ?? false) ||
    (event.output?.toLowerCase().includes(lower) ?? false)
  );
}

// ─── Event type metadata ──────────────────────────────────────────────────────

type EventMeta = {
  icon: string;
  label: string;
  color: string;
};

function getEventMeta(event: AgentEvent): EventMeta {
  const t = event.type;

  if (t === "file_read")        return { icon: "◈", label: "Read",    color: "var(--event-file-read)" };
  if (t === "file_edit")        return { icon: "✎", label: "Edit",    color: "var(--event-file-edit)" };
  if (t === "shell")            return { icon: "$", label: "Shell",   color: "var(--event-shell)" };
  if (t === "test_run")         return { icon: "▷", label: "Test",    color: event.success === false ? "var(--error)" : "var(--success)" };
  if (t === "search")           return { icon: "⌕", label: "Search",  color: "var(--event-search)" };
  if (t === "web")              return { icon: "↗", label: "Web",     color: "var(--event-web)" };
  if (t === "error")            return { icon: "⚠", label: "Error",   color: "var(--event-error)" };
  if (t === "session_start")    return { icon: "●", label: "Start",   color: "var(--event-session)" };
  if (t === "session_end")      return { icon: "◼", label: "End",     color: "var(--event-session)" };
  if (t === "subagent")         return { icon: "⊕", label: "Agent",   color: "var(--event-subagent)" };
  if (t === "context_compaction") return { icon: "⊖", label: "Compact", color: "var(--text-tertiary)" };
  if (t === "agent_message")    return { icon: "◦", label: "Note",    color: "var(--event-agent)" };
  if (t === "user_message")     return { icon: "◉", label: "Prompt",  color: "var(--accent)" };
  return                               { icon: "·", label: event.tool ?? "Event", color: "var(--text-tertiary)" };
}

// ─── Event primary description ────────────────────────────────────────────────

function EventPrimary({ event }: { event: AgentEvent }): JSX.Element {
  if (event.file) {
    return (
      <span className="event-primary">
        <span className="event-primary__path">{event.file}</span>
        {(event.additions != null || event.deletions != null) && (
          <span className="event-diff-stats">
            {event.additions != null && (
              <span className="event-diff-stats__add">+{event.additions}</span>
            )}
            {event.deletions != null && (
              <span className="event-diff-stats__del">−{event.deletions}</span>
            )}
          </span>
        )}
      </span>
    );
  }

  if (event.command) {
    return (
      <span className="event-primary">
        <span className="event-primary__command">{event.command}</span>
        {event.exitCode != null && (
          <span className={`event-exit-code ${event.exitCode === 0 ? "event-exit-code--ok" : "event-exit-code--err"}`}>
            exit {event.exitCode}
          </span>
        )}
      </span>
    );
  }

  if (event.query) {
    return (
      <span className="event-primary">
        <span className="event-primary__query">"{event.query}"</span>
        {event.resultCount != null && (
          <span className="event-result-count">{event.resultCount} results</span>
        )}
      </span>
    );
  }

  if (event.content) {
    return (
      <span className="event-primary">
        <span className="event-primary__content">{event.content}</span>
      </span>
    );
  }

  return <span className="event-primary event-primary--none">—</span>;
}

// ─── Event detail panel ───────────────────────────────────────────────────────

function EventDetail({ event }: { event: AgentEvent }): JSX.Element {
  if (!event.output && !event.content && !event.metadata) {
    return <div className="event-detail event-detail--empty">No additional details.</div>;
  }

  return (
    <div className="event-detail">
      {event.output && (
        <div className="event-detail__section">
          <div className="event-detail__label">Output</div>
          <pre className="event-detail__pre">{event.output}</pre>
        </div>
      )}
      {event.content && event.type !== "session_start" && event.type !== "session_end" && (
        <div className="event-detail__section">
          <div className="event-detail__label">Content</div>
          <pre className="event-detail__pre">{event.content}</pre>
        </div>
      )}
      {event.metadata && Object.keys(event.metadata).length > 0 && (
        <div className="event-detail__section">
          <div className="event-detail__label">Metadata</div>
          <pre className="event-detail__pre">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Timeline event row ───────────────────────────────────────────────────────

function EventRow({
  event,
  baseTime,
  isExpanded,
  onToggle,
}: {
  event: AgentEvent;
  baseTime: number;
  isExpanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const meta = getEventMeta(event);
  const hasDetail = !!(event.output || (event.content && event.type !== "session_start" && event.type !== "session_end") || event.metadata);
  const isFailure = event.success === false || event.type === "error";

  return (
    <div
      className={[
        "event-row",
        isExpanded ? "event-row--expanded" : "",
        isFailure ? "event-row--failure" : "",
        hasDetail ? "event-row--clickable" : "",
      ].filter(Boolean).join(" ")}
      onClick={hasDetail ? onToggle : undefined}
      role={hasDetail ? "button" : undefined}
      aria-expanded={hasDetail ? isExpanded : undefined}
    >
      {/* Timeline connector */}
      <div className="event-row__track">
        <div className="event-row__connector" />
        <div
          className="event-row__icon"
          style={{ color: meta.color }}
          title={meta.label}
        >
          {meta.icon}
        </div>
      </div>

      {/* Content */}
      <div className="event-row__content">
        <div className="event-row__header">
          <span className="event-row__time">{formatRelativeTime(baseTime, event.timestamp)}</span>
          <span className="event-row__type" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="event-row__primary">
            <EventPrimary event={event} />
          </span>
          {event.duration != null && (
            <span className="event-row__duration">{formatDuration(event.duration)}</span>
          )}
          {hasDetail && (
            <span className="event-row__expand-hint">{isExpanded ? "▲" : "▼"}</span>
          )}
        </div>

        {isExpanded && hasDetail && <EventDetail event={event} />}
      </div>
    </div>
  );
}

// ─── Session header ───────────────────────────────────────────────────────────

function SessionHeader({ session }: { session: Session }): JSX.Element {
  const duration =
    session.duration ??
    (session.endTime
      ? session.endTime - session.startTime
      : Date.now() - session.startTime);

  const statusClass = {
    running: "session-header__status--running",
    success: "session-header__status--success",
    failed: "session-header__status--error",
    unknown: "session-header__status--neutral",
  }[session.status];

  const statusLabel = {
    running: "Running",
    success: "Success",
    failed: "Failed",
    unknown: "Unknown",
  }[session.status];

  return (
    <div className="session-header">
      <div className="session-header__top">
        <h1 className="session-header__task">
          {session.task ?? "Unnamed session"}
        </h1>
        <span className={`session-header__status ${statusClass}`}>{statusLabel}</span>
      </div>

      <div className="session-header__meta">
        <span>{session.agent}</span>
        {session.model && <><span className="meta-sep">·</span><span>{session.model}</span></>}
        <span className="meta-sep">·</span>
        <span>{formatDuration(duration)}</span>
        <span className="meta-sep">·</span>
        <span>{new Date(session.startTime).toLocaleString()}</span>
        {session.cwd && (
          <><span className="meta-sep">·</span><code className="session-header__cwd">{session.cwd}</code></>
        )}
      </div>

      <div className="session-header__stats">
        <SessionStat label="events" value={session.eventCount} />
        <SessionStat label="file reads" value={session.fileReads} />
        <SessionStat label="file edits" value={session.fileEdits} />
        <SessionStat label="shell" value={session.shellCommands} />
        <SessionStat label="searches" value={session.searches} />
        {session.errors > 0 && (
          <SessionStat label="errors" value={session.errors} danger />
        )}
      </div>
    </div>
  );
}

function SessionStat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}): JSX.Element {
  return (
    <div className={`session-stat-block ${danger ? "session-stat-block--danger" : ""}`}>
      <span className="session-stat-block__value">{value}</span>
      <span className="session-stat-block__label">{label}</span>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function Timeline({
  events,
  baseTime,
}: {
  events: AgentEvent[];
  baseTime: number;
}): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (events.length === 0) {
    return (
      <div className="timeline-empty">No events match the current filter.</div>
    );
  }

  return (
    <div className="timeline">
      {events.map((event) => (
        <EventRow
          key={event.id}
          event={event}
          baseTime={baseTime}
          isExpanded={expandedIds.has(event.id)}
          onToggle={() => toggle(event.id)}
        />
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SessionPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("All");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getSession(id);
      setSession(data.session);
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh while running
  useEffect(() => {
    if (session?.status !== "running") return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [session?.status, load]);

  const baseTime = events[0]?.timestamp ?? Date.now();

  const filteredEvents = useMemo(() => {
    let result = events.filter((e) => matchesFilter(e, filter));
    if (search) result = result.filter((e) => eventMatchesSearch(e, search));
    return result;
  }, [events, filter, search]);

  if (loading) {
    return (
      <div className="session-page session-page--loading">
        <div className="spinner" />
        <span>Loading session…</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="session-page session-page--error">
        <div className="error-state">
          <div className="error-state__icon">⚠</div>
          <div className="error-state__title">Session not found</div>
          <div className="error-state__body">{error ?? "The session may have been deleted."}</div>
          <button className="btn btn--ghost" onClick={() => navigate("/")}>
            ← Back to sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-page">
      {/* Top nav */}
      <header className="session-nav">
        <Link to="/" className="session-nav__back">
          ← Sessions
        </Link>
        <div className="session-nav__brand">
          <span className="session-nav__logo">◉</span>
          <span className="session-nav__title">AgentLens</span>
        </div>
        <button
          className="btn btn--ghost"
          onClick={() => void load()}
          title="Refresh"
        >
          ↻
        </button>
      </header>

      <div className="session-page__body">
        {/* Session header */}
        <SessionHeader session={session} />

        <div className="timeline-controls">
          {/* Filter tabs */}
          <div className="filter-tabs">
            {EVENT_FILTERS.map((f) => (
              <button
                key={f}
                className={`filter-tab ${filter === f ? "filter-tab--active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
                {f !== "All" && (
                  <span className="filter-tab__count">
                    {events.filter((e) => matchesFilter(e, f)).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="timeline-search">
            <span className="timeline-search__icon">⌕</span>
            <input
              className="timeline-search__input"
              type="text"
              placeholder="Search timeline…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="timeline-search__clear" onClick={() => setSearch("")}>
                ×
              </button>
            )}
          </div>
        </div>

        {/* Match count */}
        {(filter !== "All" || search) && (
          <div className="timeline-count">
            {filteredEvents.length} of {events.length} events
          </div>
        )}

        {/* Timeline */}
        <Timeline events={filteredEvents} baseTime={baseTime} />
      </div>
    </div>
  );
}
