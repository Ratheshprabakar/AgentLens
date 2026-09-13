#!/usr/bin/env node
/**
 * AgentLens Claude Code Hook Script
 *
 * This script is called by Claude Code for each hook event:
 *   - PreToolUse
 *   - PostToolUse
 *   - Stop
 *   - Notification
 *
 * It reads the hook payload from stdin, normalizes it, and POSTs to the
 * AgentLens collector running at http://localhost:4040.
 *
 * IMPORTANT: This script must:
 *   1. Exit with code 0 so Claude Code continues normally
 *   2. Not write anything to stdout (only stderr for debug)
 *   3. Complete quickly (< 5 seconds) to avoid blocking Claude Code
 */

import { DEFAULT_PORT } from "../server.js";

const COLLECTOR_URL = `http://127.0.0.1:${DEFAULT_PORT}/api/events`;
const TIMEOUT_MS = 4000;

async function main(): Promise<void> {
  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    // No input — nothing to do
    process.exit(0);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Invalid JSON — ignore silently so Claude Code isn't interrupted
    process.exit(0);
  }

  // POST to collector with a short timeout so we never block Claude Code
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    await fetch(COLLECTOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);
  } catch {
    // Collector not running or timed out — fail silently
    // We never want to interrupt Claude Code
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
