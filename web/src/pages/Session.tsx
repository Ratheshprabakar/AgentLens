import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { getSession, type Session, type AgentEvent } from "../api.ts";
import {
  formatDuration,
  formatOffset,
  shortenPath,
  agentLabel,
} from "../lib/format.ts";
import {
  pageVariants,
  pageTransition,
  fadeUp,
  timelineItemVariants,
  expandVariants,
} from "../lib/motion.ts";
import ShellFooter from "../components/ShellFooter.tsx";
import "./Session.css";

const FILTERS = [
  "All",
  "Prompt",
  "Files",
  "Shell",
  "Search",
  "Tests",
  "Errors",
] as const;
type FilterKey = (typeof FILTERS)[number];

/** Initial visible events - keeps long Cursor sessions scannable. */
const PAGE_SIZE = 60;

function matchesFilter(event: AgentEvent, filter: FilterKey): boolean {
  switch (filter) {
    case "All":
      return true;
    case "Prompt":
      return event.type === "user_message";
    case "Files":
      return event.type === "file_read" || event.type === "file_edit";
    case "Shell":
      return event.type === "shell";
    case "Search":
      return event.type === "search";
    case "Tests":
      return event.type === "test_run";
    case "Errors":
      return event.type === "error" || event.success === false;
    default:
      return true;
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

type EventMeta = { label: string; color: string };

function getEventMeta(event: AgentEvent): EventMeta {
  const t = event.type;
  if (t === "file_read") return { label: "read", color: "var(--ev-read)" };
  if (t === "file_edit") return { label: "edit", color: "var(--ev-edit)" };
  if (t === "shell") return { label: "shell", color: "var(--ev-shell)" };
  if (t === "test_run")
    return {
      label: "test",
      color: event.success === false ? "var(--ev-error)" : "var(--ev-test)",
    };
  if (t === "search") return { label: "search", color: "var(--ev-search)" };
  if (t === "web") return { label: "web", color: "var(--ev-web)" };
  if (t === "error") return { label: "error", color: "var(--ev-error)" };
  if (t === "session_start")
    return { label: "start", color: "var(--paper-faint)" };
  if (t === "session_end") return { label: "end", color: "var(--paper-faint)" };
  if (t === "subagent") return { label: "agent", color: "var(--ev-sub)" };
  if (t === "context_compaction")
    return { label: "compact", color: "var(--paper-faint)" };
  if (t === "agent_message") return { label: "note", color: "var(--ev-note)" };
  if (t === "user_message")
    return { label: "prompt", color: "var(--ev-prompt)" };
  return {
    label: (event.tool ?? "event").toLowerCase(),
    color: "var(--paper-faint)",
  };
}

function EventPrimary({ event }: { event: AgentEvent }) {
  if (event.file) {
    return (
      <span className="ev-primary">
        <span className="ev-primary__path mono">{event.file}</span>
        {(event.additions != null || event.deletions != null) && (
          <span className="ev-diff mono">
            {event.additions != null && (
              <span className="ev-diff__a">+{event.additions}</span>
            )}
            {event.deletions != null && (
              <span className="ev-diff__d">−{event.deletions}</span>
            )}
          </span>
        )}
      </span>
    );
  }
  if (event.command) {
    return (
      <span className="ev-primary">
        <span className="ev-primary__cmd mono">{event.command}</span>
        {event.exitCode != null && (
          <span
            className={`ev-exit mono ${event.exitCode === 0 ? "ev-exit--ok" : "ev-exit--bad"}`}
          >
            {event.exitCode}
          </span>
        )}
      </span>
    );
  }
  if (event.query) {
    return (
      <span className="ev-primary">
        <span className="ev-primary__q">“{event.query}”</span>
        {event.resultCount != null && (
          <span className="ev-meta mono">{event.resultCount}</span>
        )}
      </span>
    );
  }
  if (event.content) {
    return (
      <span className="ev-primary">
        <span className="ev-primary__text">{event.content}</span>
      </span>
    );
  }
  return <span className="ev-primary ev-primary--empty">-</span>;
}

function EventDetail({ event }: { event: AgentEvent }) {
  // Content already appears in the row for prompts/notes - don't duplicate it.
  const contentInRow = isContentPrimary(event);
  const showContent =
    !!event.content &&
    !contentInRow &&
    event.type !== "session_start" &&
    event.type !== "session_end";
  const meta = usefulMetadata(event.metadata);
  if (!event.output && !showContent && !meta) {
    return null;
  }
  return (
    <motion.div
      className="ev-detail"
      variants={expandVariants}
      initial="collapsed"
      animate="open"
      exit="collapsed"
    >
      {event.output && (
        <div className="ev-detail__block">
          <div className="ev-detail__label mono">stdout</div>
          <pre className="ev-detail__pre">{event.output}</pre>
        </div>
      )}
      {showContent && (
        <div className="ev-detail__block">
          <div className="ev-detail__label mono">content</div>
          <pre className="ev-detail__pre">{event.content}</pre>
        </div>
      )}
      {meta && (
        <div className="ev-detail__block">
          <div className="ev-detail__label mono">meta</div>
          <pre className="ev-detail__pre">{JSON.stringify(meta, null, 2)}</pre>
        </div>
      )}
    </motion.div>
  );
}

/** True when the row's primary line is already the event content (prompt / note). */
function isContentPrimary(event: AgentEvent): boolean {
  return !event.file && !event.command && !event.query && !!event.content;
}

/** Drop import bookkeeping that isn't useful in the timeline UI. */
function usefulMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const cleaned = { ...metadata };
  delete cleaned.source;
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function eventHasExpandableDetail(event: AgentEvent): boolean {
  if (event.output) return true;
  if (usefulMetadata(event.metadata)) return true;
  // Long prompt/note: expand only unclamps the row text (no duplicate panel)
  if (isContentPrimary(event) && (event.content?.length ?? 0) > 140)
    return true;
  if (
    event.content &&
    !isContentPrimary(event) &&
    event.type !== "session_start" &&
    event.type !== "session_end"
  ) {
    return true;
  }
  return false;
}

function EventRow({
  event,
  baseTime,
  expanded,
  onToggle,
}: {
  event: AgentEvent;
  baseTime: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = getEventMeta(event);
  const hasDetail = eventHasExpandableDetail(event);
  const failed = event.success === false || event.type === "error";

  return (
    <motion.div
      className={[
        "ev",
        expanded ? "ev--open" : "",
        failed ? "ev--bad" : "",
        hasDetail ? "ev--clickable" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      variants={timelineItemVariants}
      initial="hidden"
      animate="show"
      layout="position"
      onClick={hasDetail ? onToggle : undefined}
      onKeyDown={
        hasDetail
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
      role={hasDetail ? "button" : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      aria-expanded={hasDetail ? expanded : undefined}
    >
      <div className="ev__gutter mono">
        {formatOffset(baseTime, event.timestamp)}
      </div>
      <div className="ev__track">
        <span
          className="ev__node"
          style={{ borderColor: meta.color, background: meta.color }}
        />
      </div>
      <div className="ev__body">
        <div className="ev__line">
          <span className="ev__type mono" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="ev__primary">
            <EventPrimary event={event} />
          </span>
          {event.duration != null && (
            <span className="ev__dur mono">
              {formatDuration(event.duration)}
            </span>
          )}
        </div>
        <AnimatePresence initial={false}>
          {expanded && hasDetail && <EventDetail key="detail" event={event} />}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("All");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Notes (agent_message) off by default - opt in via “Show notes”. */
  const [showNotes, setShowNotes] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setExpanded(new Set());
  }, [id, filter, search, showNotes]);

  useEffect(() => {
    if (session?.status !== "running") return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [session?.status, load]);

  const baseTime = events[0]?.timestamp ?? Date.now();

  const filtered = useMemo(() => {
    let list = events.filter((e) => matchesFilter(e, filter));
    if (!showNotes) list = list.filter((e) => e.type !== "agent_message");
    if (search) list = list.filter((e) => eventMatchesSearch(e, search));
    return list;
  }, [events, filter, search, showNotes]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const remaining = Math.max(0, filtered.length - visible.length);
  const noteCount = useMemo(
    () => events.filter((e) => e.type === "agent_message").length,
    [events],
  );

  const loadMore = (count = PAGE_SIZE) => {
    setVisibleCount((n) => Math.min(filtered.length, n + count));
  };

  const toggle = (eid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eid)) next.delete(eid);
      else next.add(eid);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="session session--center">
        <p className="mono">Loading timeline…</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="session session--center">
        <p>Session not found</p>
        <pre className="mono session__err">{error}</pre>
        <button type="button" className="al-btn" onClick={() => navigate("/")}>
          Back to sessions
        </button>
      </div>
    );
  }

  const duration =
    session.duration ??
    (session.endTime
      ? session.endTime - session.startTime
      : Date.now() - session.startTime);

  const agentClass =
    session.agent === "cursor"
      ? "agent-chip--cursor"
      : session.agent === "claude-code"
        ? "agent-chip--claude"
        : "";

  return (
    <motion.div
      className="session"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={pageTransition}
    >
      <header className="shell-top">
        <div className="shell-top__inner">
          <Link to="/" className="brand" aria-label="AgentLens home">
            <span className="brand__mark" aria-hidden />
            <div className="brand__text">
              <span className="brand__name">AgentLens</span>
              <span className="brand__tag mono">
                devtools for coding agents
              </span>
            </div>
          </Link>

          <div className="shell-top__right">
            {session.status === "running" && (
              <span className="live mono">
                <span className="live__dot" />
                live
              </span>
            )}
            <button
              type="button"
              className="al-btn al-btn--ghost"
              onClick={() => void load()}
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="session__body">
        <motion.header
          className="session-hero"
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <div className="session-hero__eyebrow">
            <span className={`agent-chip mono ${agentClass}`}>
              {agentLabel(session.agent)}
            </span>
            <span className="mono session-hero__id">
              {session.id.slice(0, 8)}
            </span>
          </div>

          <div className="session-hero__title-row">
            <h1 className="session-hero__title">
              {session.task ?? "Untitled session"}
            </h1>
            <Link to="/" className="session-hero__back mono">
              ← Sessions
            </Link>
          </div>

          <div className="session-hero__meta mono">
            <span>{formatDuration(duration)}</span>
            <span className="session-hero__sep">·</span>
            <span>{new Date(session.startTime).toLocaleString()}</span>
            {session.model && (
              <>
                <span className="session-hero__sep">·</span>
                <span>{session.model}</span>
              </>
            )}
            {session.cwd && (
              <>
                <span className="session-hero__sep">·</span>
                <span className="truncate">{shortenPath(session.cwd)}</span>
              </>
            )}
          </div>

          <div className="session-stats">
            <Stat label="events" value={session.eventCount} />
            <Stat label="reads" value={session.fileReads} />
            <Stat label="edits" value={session.fileEdits} />
            <Stat label="shell" value={session.shellCommands} />
            <Stat label="search" value={session.searches} />
            {session.errors > 0 && (
              <Stat label="errors" value={session.errors} danger />
            )}
          </div>
        </motion.header>

        <motion.div
          className="timeline-panel"
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.05 }}
        >
          <div className="timeline-bar">
            <div className="filter-row" role="tablist">
              {FILTERS.map((f) => {
                const count =
                  f === "All"
                    ? events.filter(
                        (e) => showNotes || e.type !== "agent_message",
                      ).length
                    : events.filter(
                        (e) =>
                          matchesFilter(e, f) &&
                          (showNotes || e.type !== "agent_message"),
                      ).length;
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    className={`filter-link ${filter === f ? "filter-link--on" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                    <span className="mono filter-link__n">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="timeline-bar__tools">
              {filter === "All" && noteCount > 0 && (
                <label className="notes-toggle mono">
                  <input
                    type="checkbox"
                    checked={showNotes}
                    onChange={(e) => setShowNotes(e.target.checked)}
                  />
                  Show notes
                </label>
              )}
              <div className="al-field timeline-bar__search">
                <span className="mono" aria-hidden>
                  /
                </span>
                <input
                  className="al-field__input"
                  type="search"
                  placeholder="Search file, command, output…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="al-field__clear"
                    onClick={() => setSearch("")}
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="timeline-status mono">
            <span>
              {visible.length}
              {remaining > 0 ? ` of ${filtered.length}` : ""} events
              {filtered.length !== events.length && ` · ${events.length} total`}
            </span>
          </div>

          <div className="timeline-scroll">
            <div className="timeline">
              {filtered.length === 0 ? (
                <p className="timeline-empty">No events match.</p>
              ) : (
                visible.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    baseTime={baseTime}
                    expanded={expanded.has(event.id)}
                    onToggle={() => toggle(event.id)}
                  />
                ))
              )}
            </div>

            {remaining > 0 && (
              <div className="timeline-more">
                <button
                  type="button"
                  className="al-btn al-btn--primary"
                  onClick={() => loadMore()}
                >
                  Load more · {Math.min(PAGE_SIZE, remaining)} of {remaining}
                </button>
                {remaining > PAGE_SIZE && (
                  <button
                    type="button"
                    className="al-btn"
                    onClick={() => setVisibleCount(filtered.length)}
                  >
                    Show all {filtered.length}
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      <ShellFooter />
    </motion.div>
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
    <div className={`sstat ${danger ? "sstat--bad" : ""}`}>
      <span className="sstat__n mono">{value}</span>
      <span className="sstat__l">{label}</span>
    </div>
  );
}
