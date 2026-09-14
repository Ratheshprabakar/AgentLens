import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  getSessions,
  deleteSession,
  listTranscripts,
  runImport,
  type Session,
  type TranscriptInfo,
  type ImportStats,
} from "../api.ts";
import {
  formatDuration,
  formatClock,
  shortenPath,
  agentLabel,
  matchesAgent,
  type AgentFilter,
} from "../lib/format.ts";
import {
  pageVariants,
  pageTransition,
  fadeUp,
  listVariants,
  rowVariants,
} from "../lib/motion.ts";
import ShellFooter from "../components/ShellFooter.tsx";
import "./Sessions.css";

const MotionLink = motion.create(Link);

type GroupMode = "day" | "project";

function groupByDay(
  sessions: Session[],
): Array<{ label: string; sessions: Session[] }> {
  const groups = new Map<string, Session[]>();
  const now = new Date();

  for (const s of sessions) {
    const d = new Date(s.startTime);
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    let label: string;
    if (diffDays === 0) label = "Today";
    else if (diffDays === 1) label = "Yesterday";
    else if (diffDays < 7)
      label = d.toLocaleDateString([], { weekday: "long" });
    else
      label = d.toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(s);
  }

  return Array.from(groups.entries()).map(([label, sessions]) => ({
    label,
    sessions,
  }));
}

function projectLabel(cwd?: string): string {
  if (!cwd) return "No project";
  const short = shortenPath(cwd);
  const parts = short.split("/").filter(Boolean);
  if (parts.length <= 2) return short;
  return parts.slice(-2).join("/");
}

/** Group by cwd; most-recent session first within each project; projects by latest activity. */
function groupByProject(
  sessions: Session[],
): Array<{ label: string; sessions: Session[] }> {
  const groups = new Map<string, Session[]>();

  for (const s of sessions) {
    const label = projectLabel(s.cwd);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(s);
  }

  return Array.from(groups.entries())
    .map(([label, list]) => ({
      label,
      sessions: [...list].sort((a, b) => b.startTime - a.startTime),
      latest: Math.max(...list.map((s) => s.startTime)),
    }))
    .sort((a, b) => b.latest - a.latest)
    .map(({ label, sessions }) => ({ label, sessions }));
}

type ActivitySeg = { key: string; n: number; color: string };

function activitySegments(session: Session): ActivitySeg[] {
  const segs: ActivitySeg[] = [
    { key: "rd", n: session.fileReads, color: "var(--ev-read)" },
    { key: "ed", n: session.fileEdits, color: "var(--ev-edit)" },
    { key: "sh", n: session.shellCommands, color: "var(--ev-shell)" },
    { key: "sr", n: session.searches, color: "var(--ev-search)" },
  ];
  if (session.errors > 0) {
    segs.push({ key: "er", n: session.errors, color: "var(--ev-error)" });
  }
  return segs.filter((s) => s.n > 0);
}

/** 1 = quiet … 4 = heavy - relative to the busiest session in the current list. */
function densityLevel(eventCount: number, maxEvents: number): 1 | 2 | 3 | 4 {
  if (maxEvents <= 0 || eventCount <= 0) return 1;
  const r = eventCount / maxEvents;
  if (r >= 0.7) return 4;
  if (r >= 0.35) return 3;
  if (r >= 0.12) return 2;
  return 1;
}

function statusMark(status: Session["status"]): {
  label: string;
  className: string;
} {
  switch (status) {
    case "running":
      return { label: "live", className: "row-status row-status--live" };
    case "failed":
      return { label: "failed", className: "row-status row-status--bad" };
    case "success":
      return { label: "done", className: "row-status row-status--done" };
    default:
      return { label: "-", className: "row-status" };
  }
}

function SessionRow({
  session,
  onDelete,
  density,
  hideCwd,
}: {
  session: Session;
  onDelete: (id: string) => void;
  density: 1 | 2 | 3 | 4;
  hideCwd?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const duration =
    session.duration ??
    (session.endTime
      ? session.endTime - session.startTime
      : Date.now() - session.startTime);
  const status = statusMark(session.status);
  const agentTone =
    session.agent === "cursor"
      ? "cursor"
      : session.agent === "claude-code"
        ? "claude"
        : "other";
  const segs = activitySegments(session);
  const totalSeg = segs.reduce((sum, s) => sum + s.n, 0);
  const stripTitle =
    segs.length === 0
      ? `${session.eventCount} events`
      : [
          ...segs.map((s) => `${s.n} ${s.key}`),
          `${session.eventCount} ev`,
        ].join(" · ");

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirming) onDelete(session.id);
    else {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 2800);
    }
  };

  return (
    <MotionLink
      to={`/sessions/${session.id}`}
      className={`session-row session-row--d${density}`}
      variants={rowVariants}
      whileHover={{ backgroundColor: "rgba(28, 33, 27, 0.85)" }}
      transition={{ duration: 0.12 }}
    >
      <span
        className={`session-row__rail session-row__rail--${agentTone} session-row__rail--d${density}`}
        aria-hidden
      />
      <div className="session-row__main">
        <div className="session-row__title-line">
          <span className="session-row__title truncate">
            {session.task ?? "Untitled session"}
          </span>
          <span className={status.className}>{status.label}</span>
        </div>
        <div className="session-row__meta mono">
          <span
            className={`session-row__agent session-row__agent--${agentTone}`}
          >
            {agentLabel(session.agent)}
          </span>
          <span className="session-row__sep">/</span>
          <span>{formatClock(session.startTime)}</span>
          <span className="session-row__sep">/</span>
          <span>{formatDuration(duration)}</span>
          {!hideCwd && session.cwd && (
            <>
              <span className="session-row__sep">/</span>
              <span className="session-row__cwd truncate">
                {shortenPath(session.cwd)}
              </span>
            </>
          )}
        </div>
      </div>

      <div
        className="session-row__activity"
        title={stripTitle}
        aria-label={stripTitle}
      >
        <div className="activity-strip" aria-hidden>
          {totalSeg === 0 ? (
            <span className="activity-strip__empty" />
          ) : (
            segs.map((s) => (
              <span
                key={s.key}
                className="activity-strip__seg"
                style={{
                  flexGrow: s.n,
                  background: s.color,
                }}
              />
            ))
          )}
        </div>
        <span className="activity-strip__n mono">{session.eventCount}</span>
      </div>

      <button
        type="button"
        className={`session-row__delete ${confirming ? "session-row__delete--confirm" : ""}`}
        onClick={handleDelete}
        aria-label={confirming ? "Confirm delete" : "Delete session"}
      >
        {confirming ? "delete?" : "×"}
      </button>
    </MotionLink>
  );
}

function ImportBar({ onImported }: { onImported: () => void }) {
  const [transcripts, setTranscripts] = useState<TranscriptInfo[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [lastStats, setLastStats] = useState<ImportStats | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setTranscripts((await listTranscripts()).transcripts);
    } catch {
      setTranscripts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!transcripts || transcripts.length === 0) return null;

  const pending = transcripts.filter((t) => !t.alreadyImported);

  const run = async (force: boolean) => {
    setImporting(true);
    try {
      const result = await runImport(force);
      setLastStats(result.stats);
      await load();
      onImported();
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="import-bar">
      <button
        type="button"
        className="import-bar__toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="import-bar__label">
          {pending.length > 0
            ? `${pending.length} transcript${pending.length === 1 ? "" : "s"} ready`
            : `${transcripts.length} transcripts on disk`}
        </span>
        <span className="import-bar__chev mono">{open ? "hide" : "show"}</span>
      </button>

      <div className="import-bar__actions">
        {lastStats && (
          <span className="import-bar__hint mono">
            {lastStats.imported > 0
              ? `+${lastStats.imported} imported`
              : "up to date"}
          </span>
        )}
        {pending.length > 0 && (
          <button
            type="button"
            className="al-btn al-btn--primary"
            disabled={importing}
            onClick={() => void run(false)}
          >
            {importing ? "Importing…" : "Import"}
          </button>
        )}
        <button
          type="button"
          className="al-btn"
          disabled={importing}
          onClick={() => void run(true)}
          title="Re-parse all transcripts"
        >
          Re-sync
        </button>
      </div>

      {open && (
        <div className="import-bar__list">
          {transcripts.slice(0, 16).map((t) => (
            <div
              key={`${t.agent}-${t.sessionId}`}
              className="import-bar__item mono"
            >
              <span className={t.alreadyImported ? "dot dot--on" : "dot"} />
              <span className="import-bar__agent">
                {t.agent === "cursor" ? "cursor" : "claude"}
              </span>
              <span className="import-bar__id">{t.sessionId.slice(0, 8)}</span>
              <span className="import-bar__cwd truncate">
                {shortenPath(t.cwd)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <p className="empty__kicker mono">collector online · no sessions yet</p>
      <h2 className="empty__title">Watch your agents work</h2>
      <p className="empty__body">
        Import Cursor and Claude Code transcripts, or install Claude hooks for
        live capture.
      </p>
      <div className="empty__cmds">
        <code>bun src/cli.ts import</code>
        <code>bun src/cli.ts install</code>
      </div>
    </div>
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [agent, setAgent] = useState<AgentFilter>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("day");
  const [tick, setTick] = useState(Date.now());

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
  }, [load, tick]);

  useEffect(() => {
    if (!sessions.some((s) => s.status === "running")) return;
    const timer = setInterval(() => setTick(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [sessions]);

  const handleDelete = async (id: string) => {
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!matchesAgent(s.agent, agent)) return false;
      if (!q) return true;
      return (
        s.task?.toLowerCase().includes(q) ||
        s.agent.toLowerCase().includes(q) ||
        s.cwd?.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
      );
    });
  }, [sessions, search, agent]);

  const groups = useMemo(
    () =>
      groupMode === "project" ? groupByProject(filtered) : groupByDay(filtered),
    [filtered, groupMode],
  );
  const maxEvents = useMemo(
    () => filtered.reduce((m, s) => Math.max(m, s.eventCount), 0),
    [filtered],
  );
  const running = sessions.filter((s) => s.status === "running").length;
  const cursorN = sessions.filter((s) => s.agent === "cursor").length;
  const claudeN = sessions.filter((s) => s.agent === "claude-code").length;

  return (
    <motion.div
      className="sessions"
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
            {running > 0 && (
              <span className="live mono">
                <span className="live__dot" />
                {running} live
              </span>
            )}
            <button
              type="button"
              className="al-btn al-btn--ghost"
              onClick={() => setTick(Date.now())}
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="sessions__main">
        <motion.div
          className="sessions__hero"
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <h1 className="sessions__heading">Sessions</h1>
          <p className="sessions__sub">
            {sessions.length} captured
            {cursorN > 0 && ` · ${cursorN} Cursor`}
            {claudeN > 0 && ` · ${claudeN} Claude`}
          </p>
        </motion.div>

        <ImportBar onImported={() => setTick(Date.now())} />

        {sessions.length > 0 && (
          <motion.div
            className="toolbar"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.04 }}
          >
            <div
              className="agent-tabs"
              role="tablist"
              aria-label="Filter by agent"
            >
              {(
                [
                  ["all", "All", sessions.length],
                  ["cursor", "Cursor", cursorN],
                  ["claude-code", "Claude", claudeN],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={agent === key}
                  className={`agent-tab ${agent === key ? "agent-tab--on" : ""} agent-tab--${key}`}
                  onClick={() => setAgent(key)}
                >
                  {label}
                  <span className="agent-tab__n mono">{count}</span>
                </button>
              ))}
            </div>

            <div className="al-field toolbar__search">
              <span className="mono" aria-hidden>
                /
              </span>
              <input
                className="al-field__input"
                type="search"
                placeholder="Filter by task, path, id…"
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

            <div
              className="group-tabs"
              role="tablist"
              aria-label="Group sessions"
            >
              {(
                [
                  ["day", "By day"],
                  ["project", "By project"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={groupMode === key}
                  className={`group-tab ${groupMode === key ? "group-tab--on" : ""}`}
                  onClick={() => setGroupMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="state mono">Loading sessions…</div>
        ) : error ? (
          <div className="state state--bad">
            <p>Could not reach the collector.</p>
            <pre className="state__err mono">{error}</pre>
            <button
              type="button"
              className="al-btn al-btn--primary"
              onClick={() => setTick(Date.now())}
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          search || agent !== "all" ? (
            <div className="state">
              <p>No sessions match this filter.</p>
              <button
                type="button"
                className="al-btn"
                onClick={() => {
                  setSearch("");
                  setAgent("all");
                }}
              >
                Reset filters
              </button>
            </div>
          ) : (
            <EmptyState />
          )
        ) : (
          <div className="session-groups">
            {groups.map((g) => (
              <section key={g.label} className="day-group">
                <h2 className="day-group__label mono">{g.label}</h2>
                <motion.div
                  className="session-list"
                  variants={listVariants}
                  initial="hidden"
                  animate="show"
                >
                  {g.sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      onDelete={handleDelete}
                      density={densityLevel(s.eventCount, maxEvents)}
                      hideCwd={groupMode === "project"}
                    />
                  ))}
                </motion.div>
              </section>
            ))}
          </div>
        )}
      </main>

      <ShellFooter />
    </motion.div>
  );
}
