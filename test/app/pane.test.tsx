import { afterEach, describe, expect, test } from "bun:test";

import { fakeSession, renderApp, v2ThreadId } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

const terminal = { threadId: v2ThreadId, terminalId: "term-1", cwd: "/workspace/project", worktreePath: null, status: "running", pid: 42, exitCode: null, exitSignal: null, hasRunningSubprocess: false, label: "", updatedAt: "2026-06-20T00:00:00.000Z" };
const snapshot = { type: "snapshot", threadId: v2ThreadId, terminalId: "term-1", createdAt: "2026-06-20T00:00:00.000Z", snapshot: { history: "earlier output\r\nuser@host:~$ " } };
const withTerminal = (events: readonly unknown[] = [snapshot]) => fakeSession({ terminals: [terminal], terminalEvents: events });

describe("terminal pane", () => {
  test("ctrl+j opens the thread's terminal in the pane, with its scrollback, and takes every key", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("Terminal · Terminal 1");
    expect(app.frame()).toContain("user@host:~$");
    expect(app.calls("attachTerminal")).toHaveLength(1);
    expect(app.hints()).toBe("ctrl+\\ leave pane");
    await app.press("q");
    await app.press("escape");
    expect(app.calls("writeTerminal").map((call) => call.args[2])).toEqual(["q", "\x1b"]);
    // q went to the shell rather than quitting.
    expect(app.frame()).toContain("user@host:~$");
  });

  test("ctrl+\\ leaves the pane and comes back to it; a click focuses it too", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    await app.press("\\", { ctrl: true });
    expect(app.hints()).toStartWith("ctrl+\\ pane · j/k threads");
    await app.press("j");
    expect(app.calls("writeTerminal")).toHaveLength(0);
    await app.press("\\", { ctrl: true });
    expect(app.hints()).toBe("ctrl+\\ leave pane");
    await app.press("\\", { ctrl: true });
    const shell = app.find("user@host");
    await app.click(shell.x, shell.y);
    expect(app.hints()).toBe("ctrl+\\ leave pane");
  });

  test("it takes the details column's place, and the conversation's when the window is narrow", async () => {
    const wide = await open({ width: 200, session: withTerminal() });
    await wide.press("j", { ctrl: true });
    const title = wide.find("Terminal · Terminal 1");
    expect(title.x).toBeGreaterThan(200 - 38 - 1);
    expect(wide.frame()).not.toContain("/workspace/project ·");
    wide.destroy();
    const narrow = await open({ width: 100, session: withTerminal() });
    await narrow.press("j", { ctrl: true });
    expect(narrow.find("Terminal · Terminal 1").x).toBeLessThan(50);
  });

  test("the pane closes when the terminal does", async () => {
    const app = await open({ session: withTerminal([snapshot, { type: "closed", threadId: v2ThreadId, terminalId: "term-1", createdAt: "2026-06-20T00:00:00.000Z" }]) });
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("Terminal · Terminal 1");
    expect(app.hints()).toBe("Terminal closed");
  });

  test("the T picker can still attach full screen", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("T");
    expect(app.frame()).toContain("Attach full screen");
  });

  test("ctrl+g writes the message in $EDITOR in the pane, and what's saved comes back", async () => {
    const previous = { visual: process.env.VISUAL, editor: process.env.EDITOR };
    delete process.env.VISUAL;
    // Run as `$EDITOR "$1"`: this one waits a moment, overwrites the file and exits.
    process.env.EDITOR = "sleep 0.5; printf 'from the editor' >";
    try {
      const app = await open();
      await app.press("i");
      await app.type("draft");
      await app.press("g", { ctrl: true });
      expect(app.frame()).toContain("Message · save and quit");
      expect(app.hints()).toBe("ctrl+\\ leave pane");
      for (let tries = 0; tries < 40 && app.frame().includes("Message · save and quit"); tries++) await app.settle(50);
      expect(app.frame()).not.toContain("Message · save and quit");
      expect(app.frame()).toContain("from the editor");
      expect(app.hints()).toStartWith("enter send");
    } finally {
      if (previous.visual !== undefined) process.env.VISUAL = previous.visual;
      if (previous.editor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = previous.editor;
    }
  });
});

describe("editing a changed file", () => {
  const vcs = {
    status: "live",
    local: { isRepo: true, hasPrimaryRemote: true, isDefaultRef: true, refName: "main", hasWorkingTreeChanges: true, workingTree: { files: [{ path: "README.md", insertions: 2, deletions: 1 }], insertions: 2, deletions: 1 } },
    remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null },
  };

  test("o on a file in Changes, or its ▸ Edit, opens it in the pane when it's on this machine", async () => {
    const app = await open({ width: 200, session: fakeSession({ vcs }) });
    await app.press("l");
    expect(app.hints()).toContain("o edit file");
    expect(app.frame()).toContain("▸ Edit o");
    await app.press("o");
    // The fixture's workspace isn't on this machine.
    expect(app.hints()).toBe("README.md isn't on this machine.");
  });
});
