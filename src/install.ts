/**
 * Claude Code hook installer.
 *
 * Installs AgentLens hooks into ~/.claude/settings.json so Claude Code
 * automatically sends events to the AgentLens collector.
 */

import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HookEntry {
  type: "command";
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookMatcher[];
    PostToolUse?: HookMatcher[];
    Stop?: HookMatcher[];
    Notification?: HookMatcher[];
  };
  [key: string]: unknown;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

/** The hook command - uses `agentlens-hook` binary if in PATH, else absolute path. */
function hookCommand(): string {
  // Try to resolve the absolute path to the hook script
  // When installed globally, `agentlens-hook` will be in PATH
  // During development, point to the compiled file
  const devPath = join(homedir(), ".agentlens", "hook.js");
  if (existsSync(devPath)) {
    return `node "${devPath}"`;
  }
  return "agentlens-hook";
}

// ─── Read / write settings ────────────────────────────────────────────────────

function readSettings(): ClaudeSettings {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeSettings(settings: ClaudeSettings): void {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

// ─── Installer ────────────────────────────────────────────────────────────────

const HOOK_COMMENT = "agentlens";

function hasAgentLensHook(matchers: HookMatcher[] | undefined): boolean {
  return (matchers ?? []).some((m) =>
    m.hooks.some(
      (h) =>
        h.command.includes(HOOK_COMMENT) || h.command.includes("agentlens"),
    ),
  );
}

function makeHookMatcher(cmd: string): HookMatcher {
  return {
    matcher: "",
    hooks: [{ type: "command", command: cmd }],
  };
}

export function installHooks(): {
  alreadyInstalled: boolean;
  settingsPath: string;
} {
  const cmd = hookCommand();
  const settings = readSettings();

  settings.hooks ??= {};

  const alreadyInstalled =
    hasAgentLensHook(settings.hooks.PostToolUse) &&
    hasAgentLensHook(settings.hooks.Stop);

  if (alreadyInstalled) {
    return { alreadyInstalled: true, settingsPath: SETTINGS_PATH };
  }

  // PostToolUse - captures every tool invocation
  if (!hasAgentLensHook(settings.hooks.PostToolUse)) {
    settings.hooks.PostToolUse ??= [];
    settings.hooks.PostToolUse.push(makeHookMatcher(cmd));
  }

  // PreToolUse - used for session start detection
  if (!hasAgentLensHook(settings.hooks.PreToolUse)) {
    settings.hooks.PreToolUse ??= [];
    settings.hooks.PreToolUse.push(makeHookMatcher(cmd));
  }

  // Stop - marks session end
  if (!hasAgentLensHook(settings.hooks.Stop)) {
    settings.hooks.Stop ??= [];
    settings.hooks.Stop.push(makeHookMatcher(cmd));
  }

  // Notification - captures agent notifications
  if (!hasAgentLensHook(settings.hooks.Notification)) {
    settings.hooks.Notification ??= [];
    settings.hooks.Notification.push(makeHookMatcher(cmd));
  }

  writeSettings(settings);
  return { alreadyInstalled: false, settingsPath: SETTINGS_PATH };
}

export function uninstallHooks(): { settingsPath: string } {
  const settings = readSettings();
  if (!settings.hooks) return { settingsPath: SETTINGS_PATH };

  const remove = (matchers: HookMatcher[] | undefined): HookMatcher[] =>
    (matchers ?? [])
      .map((m) => ({
        ...m,
        hooks: m.hooks.filter((h) => !h.command.includes("agentlens")),
      }))
      .filter((m) => m.hooks.length > 0);

  settings.hooks.PostToolUse = remove(settings.hooks.PostToolUse);
  settings.hooks.PreToolUse = remove(settings.hooks.PreToolUse);
  settings.hooks.Stop = remove(settings.hooks.Stop);
  settings.hooks.Notification = remove(settings.hooks.Notification);

  writeSettings(settings);
  return { settingsPath: SETTINGS_PATH };
}

export function getHookStatus(): {
  postToolUse: boolean;
  preToolUse: boolean;
  stop: boolean;
  notification: boolean;
  settingsPath: string;
} {
  const settings = readSettings();
  return {
    postToolUse: hasAgentLensHook(settings.hooks?.PostToolUse),
    preToolUse: hasAgentLensHook(settings.hooks?.PreToolUse),
    stop: hasAgentLensHook(settings.hooks?.Stop),
    notification: hasAgentLensHook(settings.hooks?.Notification),
    settingsPath: SETTINGS_PATH,
  };
}
