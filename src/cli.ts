#!/usr/bin/env node
/**
 * AgentLens CLI
 *
 * Commands:
 *   agentlens start          — Start the collector server and open the UI
 *   agentlens install        — Install Claude Code hooks
 *   agentlens uninstall      — Remove Claude Code hooks
 *   agentlens status         — Show hook installation status
 */

import { Command } from "commander";
import chalk from "chalk";
import { startServer, DEFAULT_PORT } from "./server.js";
import { installHooks, uninstallHooks, getHookStatus } from "./install.js";

const program = new Command();

program
  .name("agentlens")
  .description("DevTools for AI coding agents")
  .version("0.1.0");

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command("start")
  .description("Start the AgentLens collector and open the dashboard")
  .option("-p, --port <port>", "Port to listen on", String(DEFAULT_PORT))
  .option("--dev", "Development mode (no static file serving)", false)
  .option("--no-open", "Do not open the browser automatically")
  .action(async (opts: { port: string; dev: boolean; open: boolean }) => {
    const port = parseInt(opts.port, 10);

    printBanner();

    try {
      await startServer({ port, dev: opts.dev });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.log(
          chalk.yellow(`\n  Port ${port} is already in use.`) +
            chalk.dim("\n  AgentLens collector may already be running.\n")
        );
        console.log(
          chalk.dim("  Dashboard: ") + chalk.cyan(`http://localhost:${port}`)
        );
      } else {
        console.error(chalk.red("\n  Failed to start server:"), err);
        process.exit(1);
      }
    }

    const url = `http://localhost:${port}`;
    console.log(chalk.green("  ✓ Collector started"));
    console.log(chalk.dim("  Dashboard: ") + chalk.cyan(url));
    console.log(chalk.dim("  Events:    ") + chalk.cyan(`${url}/api/events`));
    console.log(chalk.dim("  DB:        ") + chalk.dim("~/.agentlens/agentlens.db"));
    console.log();

    // Open browser
    if (opts.open) {
      try {
        const { default: open } = await import("open");
        await open(url);
      } catch {
        // Ignore — browser open is optional
      }
    }

    // Check hook installation
    const status = getHookStatus();
    if (!status.postToolUse) {
      console.log(
        chalk.yellow("  ⚠ Claude Code hooks are not installed.") +
          chalk.dim("\n    Run: ") +
          chalk.cyan("agentlens install") +
          chalk.dim(" to enable automatic session recording.\n")
      );
    } else {
      console.log(chalk.green("  ✓ Claude Code hooks are installed") + "\n");
    }

    console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

    // Keep process alive
    process.on("SIGINT", () => {
      console.log(chalk.dim("\n  AgentLens stopped.\n"));
      process.exit(0);
    });
  });

// ─── install ──────────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install AgentLens hooks into Claude Code (~/.claude/settings.json)")
  .action(() => {
    printBanner();
    console.log(chalk.dim("  Installing Claude Code hooks...\n"));

    const { alreadyInstalled, settingsPath } = installHooks();

    if (alreadyInstalled) {
      console.log(chalk.yellow("  ✓ Hooks already installed"));
    } else {
      console.log(chalk.green("  ✓ Hooks installed successfully"));
    }

    console.log(chalk.dim(`  Settings: ${settingsPath}\n`));
    console.log(
      chalk.dim("  Now start the collector with: ") + chalk.cyan("agentlens start")
    );
    console.log();
  });

// ─── uninstall ────────────────────────────────────────────────────────────────

program
  .command("uninstall")
  .description("Remove AgentLens hooks from Claude Code")
  .action(() => {
    printBanner();
    const { settingsPath } = uninstallHooks();
    console.log(chalk.green("  ✓ Hooks removed"));
    console.log(chalk.dim(`  Settings: ${settingsPath}\n`));
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show AgentLens hook installation status")
  .action(() => {
    printBanner();
    const s = getHookStatus();
    const tick = (v: boolean) => (v ? chalk.green("✓") : chalk.red("✗"));

    console.log(`  ${tick(s.postToolUse)} PostToolUse hook`);
    console.log(`  ${tick(s.preToolUse)} PreToolUse hook`);
    console.log(`  ${tick(s.stop)} Stop hook`);
    console.log(`  ${tick(s.notification)} Notification hook`);
    console.log(chalk.dim(`\n  Settings: ${s.settingsPath}\n`));

    if (!s.postToolUse) {
      console.log(
        chalk.dim("  Run: ") + chalk.cyan("agentlens install") + chalk.dim(" to set up hooks.")
      );
      console.log();
    }
  });

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log();
  console.log(
    chalk.bold("  AgentLens") +
      chalk.dim(" v0.1") +
      "  " +
      chalk.dim("DevTools for AI coding agents")
  );
  console.log(chalk.dim("  ─────────────────────────────────────────────"));
}

program.parse();
