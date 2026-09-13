import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

import {
  getAllSessions,
  getSessionById,
  getEventsBySession,
  insertEvent,
  endSession,
  setSessionTask,
  deleteSession,
} from "./db.js";
import { normalizeClaude } from "./normalize.js";
import { importTranscripts, listTranscripts, watchTranscripts } from "./importer.js";
import type { AgentEvent, IngestPayload } from "./types.js";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_PORT = 4040;

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(opts: { dev?: boolean } = {}): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // ── API routes ─────────────────────────────────────────────────────────────

  const api = express.Router();

  // GET /api/health
  api.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // GET /api/sessions
  api.get("/sessions", (_req: Request, res: Response) => {
    try {
      const sessions = getAllSessions(200);
      res.json({ sessions });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/sessions/:id
  api.get("/sessions/:id", (req: Request, res: Response) => {
    try {
      const session = getSessionById(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const events = getEventsBySession(req.params.id);
      res.json({ session, events });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/sessions/:id
  api.delete("/sessions/:id", (req: Request, res: Response) => {
    try {
      deleteSession(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/events
   * Accepts two formats:
   *   1. { event: AgentEvent }          — pre-normalized AgentLens event
   *   2. { hook: ClaudeHookInput }      — raw Claude Code hook payload
   *   3. Raw Claude hook payload (no wrapper) — sent directly by hook scripts
   */
  api.post("/events", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const eventsToInsert: AgentEvent[] = [];

      if (body.event) {
        // Format 1: pre-normalized
        const event = body.event as AgentEvent;
        if (!event.id) event.id = randomUUID();
        eventsToInsert.push(event);
      } else if (body.hook_event_name) {
        // Format 3: raw Claude hook (no wrapper)
        const normalized = normalizeClaude(body);
        eventsToInsert.push(...normalized);

        // Handle session end marker
        if (body.hook_event_name === "Stop" && typeof body.session_id === "string") {
          endSession(body.session_id, "success");
        }
      } else if (body.hook) {
        // Format 2: wrapped Claude hook
        const normalized = normalizeClaude(body.hook);
        eventsToInsert.push(...normalized);
      }

      for (const event of eventsToInsert) {
        insertEvent(event);

        // If this is a user_message or the first event, try to extract the task
        if (event.content && (event.type === "user_message" || event.type === "session_start")) {
          setSessionTask(event.sessionId, event.content.slice(0, 500));
        }
      }

      res.json({ ok: true, inserted: eventsToInsert.length });
    } catch (err) {
      console.error("[agentlens] ingest error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Import endpoints ────────────────────────────────────────────────────

  /**
   * GET /api/import/transcripts
   * Lists available Claude Code transcript files.
   */
  api.get("/import/transcripts", (_req: Request, res: Response) => {
    try {
      const list = listTranscripts();
      res.json({ transcripts: list });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/import
   * Import (or re-import) all Claude Code transcripts.
   * Body: { force?: boolean }
   */
  api.post("/import", (req: Request, res: Response) => {
    try {
      const { force = false } = req.body as { force?: boolean };
      const stats = importTranscripts({ force });
      res.json({ ok: true, stats });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/sessions/:id/end
   * Allows the hook to mark a session as ended.
   */
  api.post("/sessions/:id/end", (req: Request, res: Response) => {
    try {
      const { status = "success" } = req.body as { status?: string };
      endSession(req.params.id, status as "success" | "failed" | "unknown");
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.use("/api", api);

  // ── Static web UI ──────────────────────────────────────────────────────────

  if (!opts.dev) {
    // In production, serve the pre-built Vite output
    const webDir = join(__dirname, "web");
    if (existsSync(webDir)) {
      app.use(express.static(webDir));
      // SPA fallback — any non-API route serves index.html
      app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
        res.sendFile(join(webDir, "index.html"));
      });
    } else {
      app.get("/", (_req: Request, res: Response) => {
        res.send(
          `<h2>AgentLens collector is running on port ${DEFAULT_PORT}.</h2>` +
            `<p>Web UI not found at <code>${webDir}</code>. Run <code>npm run build</code> to build it.</p>`
        );
      });
    }
  }

  // ── Error handler ──────────────────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[agentlens] unhandled error:", err);
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ─── Start server ─────────────────────────────────────────────────────────────

export async function startServer(opts: { port?: number; dev?: boolean } = {}): Promise<{ port: number; close: () => void }> {
  const port = opts.port ?? DEFAULT_PORT;
  const app = createApp({ dev: opts.dev });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      // Start transcript watcher so sessions captured without hooks also appear
      const stopWatcher = watchTranscripts(() => {
        // Session updated — clients will pick it up on next poll
      });

      resolve({
        port,
        close: () => {
          stopWatcher();
          server.close();
        },
      });
    });
    server.on("error", reject);
  });
}
