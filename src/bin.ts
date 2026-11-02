#!/usr/bin/env bun
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";

import { T3Session } from "./client/session.ts";
import { findThread, lastActivity, relativeTime, rowTime, shortId, statusLabel, threadRows } from "./model/threads.ts";

const USAGE = `tui3: a terminal client for T3 Code

usage:
  tui3                      dashboard: every thread, live
  tui3 attach <thread>      one thread, full screen (id, short id from \`list\`, or title text)
  tui3 list [--json]        print threads and exit
  tui3 tmux [--watch] [--session <name>]
                            mirror active threads into tmux windows (default session: tui3)
  tui3 help

env:
  TUI3_SERVER   server origin (default: the local server from ~/.t3)
  TUI3_TOKEN    bearer token for a remote server (local servers mint one via \`t3\`)`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
      return runUi();
    case "attach": {
      const needle = rest.join(" ").trim();
      if (!needle) return fail("usage: tui3 attach <thread>");
      return runUi(needle);
    }
    case "list":
    case "ls":
      return list(rest.includes("--json"));
    case "tmux":
      return tmuxCommand(rest);
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      return fail(`unknown command: ${command}\n\n${USAGE}`);
  }
}

async function connectedSession(): Promise<{ session: T3Session; snapshot: OrchestrationV2ShellSnapshot }> {
  const session = new T3Session();
  await session.start();
  const snapshot = await new Promise<OrchestrationV2ShellSnapshot>((resolve, reject) => {
    const off = session.onShell((shell) => {
      if (shell.status.type === "error") {
        queueMicrotask(() => off());
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
  const name = sessionFlag >= 0 ? args[sessionFlag + 1] : "tui3";
  if (!name) return fail("usage: tui3 tmux [--watch] [--session <name>]");
  const options = { session: name, tui3: [process.execPath, import.meta.path] };
  const { session, snapshot } = await connectedSession();
  const { opened } = await syncTmux(snapshot, options);
  console.log(`tmux session "${name}" is in sync (${opened} new window${opened === 1 ? "" : "s"}). Attach with: tmux attach -t ${name}`);
  if (!args.includes("--watch")) return session.stop();
  // Coalesce bursts of shell updates into one sync at a time.
  let pending = false;
  let syncing = false;
  const sync = async () => {
    if (syncing) return void (pending = true);
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
  session.onShell((shell) => {
    if (shell.status.type === "error") fail(shell.status.message);
    void sync();
  });
  await new Promise(() => {});
}

async function runUi(attachNeedle?: string) {
  const { session, snapshot } = await connectedSession();
  let attachThreadId;
  if (attachNeedle) {
    const thread = findThread(snapshot, attachNeedle);
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
  // The kitty keyboard protocol lets terminals that support it send shift+enter, for newlines.
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, useKittyKeyboard: {} });
  createRoot(renderer).render(createElement(App, { session, config, ...(attachThreadId ? { attachThreadId } : {}) }));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main(process.argv.slice(2)).catch((error) => fail(error instanceof Error ? error.message : String(error)));
