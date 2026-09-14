#!/usr/bin/env bun
/**
 * Install Claude Code hooks into a mounted host ~/.claude directory.
 * Env: HOST_CLAUDE, COLLECTOR_URL
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const host = process.env.HOST_CLAUDE || "/host-claude";
const settingsPath = join(host, "settings.json");
const collector = process.env.COLLECTOR_URL || "http://localhost:4040/api/events";
const hookCmd = `curl -s -X POST ${collector} -H 'Content-Type: application/json' -d @- 2>/dev/null; true`;
const types = ["PostToolUse", "PreToolUse", "Stop", "Notification"] as const;

type HookMatcher = {
  matcher: string;
  hooks: { type: string; command: string }[];
};

type Settings = {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
};

function hasAgentLens(matchers: HookMatcher[] | undefined): boolean {
  return (matchers ?? []).some((m) =>
    (m.hooks ?? []).some(
      (h) =>
        String(h.command || "").includes("agentlens") ||
        String(h.command || "").includes(collector),
    ),
  );
}

mkdirSync(host, { recursive: true });

let settings: Settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
  } catch {
    settings = {};
  }
}

settings.hooks ??= {};
const installed: string[] = [];

for (const t of types) {
  settings.hooks[t] ??= [];
  if (!hasAgentLens(settings.hooks[t])) {
    settings.hooks[t]!.push({
      matcher: "",
      hooks: [{ type: "command", command: hookCmd }],
    });
    installed.push(t);
  }
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

if (installed.length) {
  console.log(`  [agentlens] Hooks installed: ${installed.join(", ")}`);
} else {
  console.log("  [agentlens] Hooks already present");
}
