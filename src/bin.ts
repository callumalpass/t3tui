#!/usr/bin/env bun
import type { OrchestrationV2ShellSnapshot, ThreadId } from "@t3tools/contracts";

import { migrateConfigDir } from "./client/auth.ts";
import { T3Session } from "./client/session.ts";
import { isCompiled, upgrade, VERSION } from "./upgrade.ts";
import { findThread, lastActivity, relativeTime, rowTime, shortId, statusLabel, threadRows } from "./model/threads.ts";

const USAGE = `t3tui: a terminal client for T3 Code

usage:
  t3tui                     dashboard: every thread, live
  t3tui attach <thread>     one thread, full screen (id, short id from \`list\`, or title text)
  t3tui list [--json]       print threads and exit
  t3tui tmux [--watch] [--session <name>]
                            mirror active threads into tmux windows (default session: t3tui)
  t3tui upgrade             replace this binary with the latest release
  t3tui version
  t3tui help

env:
  T3TUI_SERVER  server origin (default: the local server from ~/.t3)
  T3TUI_TOKEN   bearer token for a remote server (local servers mint one via \`t3\`)`;

async function main(argv: string[]) {
  migrateConfigDir();
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
      return runUi();
    case "attach": {
      const needle = rest.join(" ").trim();
      if (!needle) return fail("usage: t3tui attach <thread>");
      return runUi(needle);
    }
    case "list":
    case "ls":
      return list(rest.includes("--json"));
    case "tmux":
      return tmuxCommand(rest);
    case "upgrade":
      return upgrade();
    case "version":
    case "--version":
    case "-v":
      console.log(`t3tui ${VERSION}`);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      return fail(`unknown command: ${command}\n\n${USAGE}`);
  }
}

/** For one-off commands: fails on the first failed attempt rather than retrying, as the UI does. */
async function connectedSession(): Promise<{ session: T3Session; snapshot: OrchestrationV2ShellSnapshot }> {
  const session = new T3Session();
  await session.start();
  const snapshot = await new Promise<OrchestrationV2ShellSnapshot>((resolve, reject) => {
    const off = session.onShell((shell) => {
      if (shell.status.type === "reconnecting") {
        queueMicrotask(() => off());
        void session.stop();
        reject(new Error(shell.status.message));
      } else if (shell.status.type === "live" && shell.snapshot) {
        queueMicrotask(() => off());
        resolve(shell.snapshot);
      }
    });
  });
  return { session, snapshot };
}

async function list(json: boolean) {
  const { session, snapshot } = await connectedSession();
  const rows = threadRows(snapshot, { settledLimit: 20 });
  if (json) {
    console.log(JSON.stringify(rows.map((row) => ({ id: row.thread.id, title: row.thread.title, project: row.projectName, section: row.section, status: row.status, unread: row.unread, updatedAt: new Date(lastActivity(row.thread)).toISOString() })), null, 2));
  } else {
    for (const row of rows) {
      const status = statusLabel(row)?.text ?? relativeTime(rowTime(row.thread));
      console.log(`${shortId(row.thread.id)}  ${row.section.padEnd(8)}  ${status.padEnd(12)}  ${row.projectName.padEnd(20).slice(0, 20)}  ${row.thread.title}`);
    }
  }
  await session.stop();
}

async function tmuxCommand(args: string[]) {
  const { syncTmux } = await import("./mux/tmux.ts");
  const sessionFlag = args.indexOf("--session");
  const name = sessionFlag >= 0 ? args[sessionFlag + 1] : "t3tui";
  if (!name) return fail("usage: t3tui tmux [--watch] [--session <name>]");
  // A compiled binary is t3tui by itself; otherwise it's Bun running this file.
  const options = { session: name, t3tui: isCompiled() ? [process.execPath] : [process.execPath, import.meta.path] };
  const { session, snapshot } = await connectedSession();
  const { opened } = await syncTmux(snapshot, options);
  console.log(`tmux session "${name}" is in sync (${opened} new window${opened === 1 ? "" : "s"}). Attach with: tmux attach -t ${name}`);
  if (!args.includes("--watch")) return session.stop();
  // Coalesce bursts of shell updates into one sync at a time.
  let pending = false;
  let syncing = false;
  const sync = async () => {
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    try {
      const latest = session.getShell().snapshot;
      if (latest) {
        const result = await syncTmux(latest, options);
        if (result.opened > 0) console.log(`opened ${result.opened} window${result.opened === 1 ? "" : "s"}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        void sync();
      }
    }
  };
  // A dropped connection retries by itself; sync runs again once the shell is back.
  session.onShell(() => void sync());
  await new Promise(() => {});
}

async function runUi(attachNeedle?: string) {
  let session: T3Session;
  let attachThreadId: ThreadId | undefined;
  if (!attachNeedle) {
    // The UI opens at once and shows the connection, retrying until the server is there.
    session = new T3Session();
    void session.start();
  } else {
    const connected = await connectedSession();
    session = connected.session;
    const thread = findThread(connected.snapshot, attachNeedle);
    if (!thread) {
      await session.stop();
      return fail(`No thread matches "${attachNeedle}".`);
    }
    attachThreadId = thread.id;
  }
  // Load the renderer only for the UI so `list` stays fast and works without a TTY.
  // Sequential on purpose: importing core and react concurrently trips a module init cycle.
  const { createCliRenderer } = await import("@opentui/core");
  const { createRoot } = await import("@opentui/react");
  const { createElement } = await import("react");
  const { App } = await import("./ui/App.tsx");
  const { loadConfig } = await import("./config.ts");
  const config = await loadConfig();
  const { loadLayout } = await import("./layout.ts");
  const layout = await loadLayout();
  // The kitty keyboard protocol lets terminals that support it send shift+enter, for newlines.
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, useKittyKeyboard: {} });
  // OpenTUI answers SIGHUP and SIGTERM by tearing the screen down without exiting, and the
  // session's socket would keep a closed terminal's t3tui running for good.
  // The terminal is restored once `closed` settles, after the destroy event.
  renderer.once("destroy", () => {
    void Promise.allSettled([Promise.race([session.stop(), Bun.sleep(1000)]), renderer.closed]).finally(() => process.exit(0));
  });
  // Bun collects so lazily that a streaming thread takes t3tui past 500 MB of garbage. A full
  // collection pauses for up to ~150 ms, so it waits for a few seconds without keys or clicks.
  let lastInput = Date.now();
  process.stdin.on("data", () => {
    lastInput = Date.now();
  });
  setInterval(() => {
    if (Date.now() - lastInput > 5_000) Bun.gc(true);
  }, 30_000).unref();
  const { applyTheme } = await import("./ui/theme.ts");
  // Terminals that don't say what their background is get the dark palette.
  applyTheme(config.theme === "auto" ? ((await renderer.waitForThemeMode(300)) ?? "dark") : config.theme);
  createRoot(renderer).render(createElement(App, { session, config, layout, ...(attachThreadId ? { attachThreadId } : {}) }));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main(process.argv.slice(2)).catch((error) => fail(error instanceof Error ? error.message : String(error)));
