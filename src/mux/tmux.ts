import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";

import { needsAttention, threadRows, type ThreadRow } from "../model/threads.ts";

/** Window option that ties a tmux window to the thread it attaches to. */
const THREAD_OPTION = "@t3tui_thread";
const TITLE_WIDTH = 24;

export interface TmuxSyncOptions {
  readonly session: string;
  /** Command that starts t3tui, e.g. [bun, /path/to/bin.ts]. */
  readonly t3tui: readonly string[];
}

async function tmux(args: readonly string[], allowFailure = false): Promise<string> {
  const proc = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0 && !allowFailure) throw new Error(`tmux ${args[0]} failed: ${stderr.trim()}`);
  return code === 0 ? stdout : "";
}

const shellJoin = (parts: readonly string[]) => parts.map((part) => `'${part.replaceAll("'", `'\\''`)}'`).join(" ");

export function windowName(row: ThreadRow): string {
  const mark = needsAttention(row) && row.status !== "ready" ? "● " : row.status === "working" || row.status === "waiting" ? "" : "✓ ";
  const title = (row.thread.title || "thread").replace(/\s+/g, " ");
  return mark + (title.length > TITLE_WIDTH ? `${title.slice(0, TITLE_WIDTH - 1)}…` : title);
}

/**
 * Makes the tmux session mirror T3 Code: a dashboard window, plus a window per
 * thread that is running or waiting on you. Windows for threads that finish
 * are kept (marked ✓) so nothing you're reading disappears.
 */
export async function syncTmux(snapshot: OrchestrationV2ShellSnapshot, options: TmuxSyncOptions): Promise<{ readonly opened: number }> {
  const { session } = options;
  if (!(await sessionExists(session))) {
    await tmux(["new-session", "-d", "-s", session, "-n", "dashboard", shellJoin(options.t3tui)]);
  }
  const windows = new Map<string, string>();
  for (const line of (await tmux(["list-windows", "-t", `=${session}`, "-F", `#{window_id}\t#{${THREAD_OPTION}}`])).split("\n")) {
    const [windowId, threadId] = line.split("\t");
    if (windowId && threadId) windows.set(threadId, windowId);
  }
  const all = threadRows(snapshot, { settledLimit: 0 });
  // A window per thread that's working or waiting on you.
  const rows = all.filter((row) => row.section === "working" || row.status === "approval" || row.status === "input" || row.status === "request");
  const byId = new Map(all.map((row) => [row.thread.id as string, row]));
  let opened = 0;
  for (const row of rows) {
    if (windows.has(row.thread.id)) continue;
    const windowId = (
      await tmux(["new-window", "-d", "-P", "-F", "#{window_id}", "-t", `=${session}:`, "-n", windowName(row), shellJoin([...options.t3tui, "attach", row.thread.id])])
    ).trim();
    await tmux(["set-option", "-w", "-t", windowId, THREAD_OPTION, row.thread.id]);
    windows.set(row.thread.id, windowId);
    opened++;
  }
  for (const [threadId, windowId] of windows) {
    const row = byId.get(threadId);
    if (row) await tmux(["rename-window", "-t", windowId, windowName(row)], true);
  }
  return { opened };
}

async function sessionExists(session: string): Promise<boolean> {
  const proc = Bun.spawn(["tmux", "has-session", "-t", `=${session}`], { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}
