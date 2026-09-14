import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { join } from "path";
import { existsSync } from "fs";

import {
  getAllSessions,
  getSessionById,
  getEventsBySession,
  insertEvent,
  endSession,
  setSessionTask,
  deleteSession,
  initDB,
} from "./db.js";
import { normalizeClaude } from "./normalize.js";
import {
  importTranscripts,
  listTranscripts,
  watchTranscripts,
} from "./importer.js";
import type { AgentEvent } from "./types.js";
import { randomUUID } from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_PORT = 4040;

// ─── Async route wrapper ──────────────────────────────────────────────────────

/** Wraps an async route handler so unhandled promise rejections reach the error middleware. */
function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(opts: { dev?: boolean } = {}): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // ── API routes ─────────────────────────────────────────────────────────────

  const api = express.Router();

  // GET /api/health
  api.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // GET /api/sessions
  api.get(
    "/sessions",
    asyncRoute(async (_req, res) => {
      const sessions = await getAllSessions(200);
      res.json({ sessions });
    }),
  );

  // GET /api/sessions/:id
  api.get(
    "/sessions/:id",
    asyncRoute(async (req, res) => {
      const session = await getSessionById(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const events = await getEventsBySession(req.params.id);
      res.json({ session, events });
    }),
  );

  // DELETE /api/sessions/:id
  api.delete(
    "/sessions/:id",
    asyncRoute(async (req, res) => {
      await deleteSession(req.params.id);
      res.json({ ok: true });
    }),
  );

  /**
   * POST /api/events
   * Three accepted formats:
   *   1. { event: AgentEvent }      - pre-normalized
   *   2. Raw Claude hook payload    - normalized server-side
   *   3. { hook: ClaudeHookInput }  - wrapped Claude hook
   */
  api.post(
    "/events",
    asyncRoute(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const eventsToInsert: AgentEvent[] = [];

      if (body.event) {
        const event = body.event as AgentEvent;
        if (!event.id) event.id = randomUUID();
        eventsToInsert.push(event);
      } else if (body.hook_event_name) {
        // Raw Claude hook (stdin → POST)
        const normalized = normalizeClaude(body);
        eventsToInsert.push(...normalized);

        if (
          body.hook_event_name === "Stop" &&
          typeof body.session_id === "string"
        ) {
          await endSession(body.session_id, "success");
        }
      } else if (body.hook) {
        const normalized = normalizeClaude(body.hook);
        eventsToInsert.push(...normalized);
      }

      for (const event of eventsToInsert) {
        await insertEvent(event);
        if (
          event.content &&
          (event.type === "user_message" || event.type === "session_start")
        ) {
          await setSessionTask(event.sessionId, event.content.slice(0, 500));
        }
      }

      res.json({ ok: true, inserted: eventsToInsert.length });
    }),
  );

  // POST /api/sessions/:id/end
  api.post(
    "/sessions/:id/end",
    asyncRoute(async (req, res) => {
      const { status = "success" } = req.body as { status?: string };
      await endSession(
        req.params.id,
        status as "success" | "failed" | "unknown",
      );
      res.json({ ok: true });
    }),
  );

  // ── Import endpoints ───────────────────────────────────────────────────────

  // GET /api/import/transcripts
  api.get(
    "/import/transcripts",
    asyncRoute(async (_req, res) => {
      const list = await listTranscripts();
      res.json({ transcripts: list });
    }),
  );

  // POST /api/import
  api.post(
    "/import",
    asyncRoute(async (req, res) => {
      const { force = false } = req.body as { force?: boolean };
      const stats = await importTranscripts({ force });
      res.json({ ok: true, stats });
    }),
  );

  app.use("/api", api);

  // ── Static web UI ──────────────────────────────────────────────────────────

  if (!opts.dev) {
    // Bun runs src/cli.ts directly so __dirname is /app/src.
    // Web assets are always at <cwd>/dist/web regardless of runtime.
    const webDir = join(process.cwd(), "dist", "web");
    if (existsSync(webDir)) {
      app.use(express.static(webDir));
      app.get(/^(?!\/api).*/, (_req, res) => {
        res.sendFile(join(webDir, "index.html"));
      });
    } else {
      app.get("/", (_req, res) => {
        res.send(
          `<h2>AgentLens collector is running on port ${DEFAULT_PORT}.</h2>` +
            `<p>Build the web UI first: <code>pnpm run build:web</code></p>`,
        );
      });
    }
  }

  // ── Error handler ──────────────────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[agentlens] unhandled error:", err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ─── Start server ─────────────────────────────────────────────────────────────

export async function startServer(
  opts: { port?: number; dev?: boolean } = {},
): Promise<{
  port: number;
  close: () => void;
}> {
  const port = opts.port ?? DEFAULT_PORT;

  // Initialize database (with retry for Docker cold-start)
  await initDB();

  // Import existing transcripts on startup
  try {
    const stats = await importTranscripts();
    if (stats.imported > 0) {
      console.log(
        `[agentlens] Imported ${stats.imported} historical session(s) from transcripts.`,
      );
    }
  } catch {
    // Not fatal - transcripts may not exist
  }

  const app = createApp({ dev: opts.dev });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0", () => {
      // Start transcript watcher (Claude Code + Cursor, every 5s)
      const stopWatcher = watchTranscripts((sessionId) => {
        console.log(
          `[agentlens] Transcript updated: ${sessionId.slice(0, 8)}…`,
        );
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
