import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadLayout } from "../../src/layout.ts";
import { withReply } from "./fixtures.ts";
import { fakeSession, renderApp, v2ShellSnapshot, v2ThreadId } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

const terminal = { threadId: v2ThreadId, terminalId: "term-1", cwd: "/workspace/project", worktreePath: null, status: "running", pid: 42, exitCode: null, exitSignal: null, hasRunningSubprocess: false, label: "", updatedAt: "2026-06-20T00:00:00.000Z" };
const snapshot = { type: "snapshot", threadId: v2ThreadId, terminalId: "term-1", createdAt: "2026-06-20T00:00:00.000Z", snapshot: { history: "earlier output\r\nuser@host:~$ " } };
const withTerminal = (events: readonly unknown[] = [snapshot]) => fakeSession({ terminals: [terminal], terminalEvents: events, projection: withReply("The reply above the drawer.", false) });

describe("terminal drawer", () => {
  test("ctrl+j opens the thread's terminal in a drawer below the conversation, with its scrollback, and it takes every key", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("Terminal 1  +");
    expect(app.frame()).toContain("user@host:~$");
    expect(app.calls("attachTerminal")).toHaveLength(1);
    expect(app.hints()).toBe("ctrl+\\ leave pane");
    // Between the conversation and the composer, the conversation's full width.
    const tab = app.find("Terminal 1  +");
    expect(tab.y).toBeGreaterThan(app.find("The reply above").y);
    expect(tab.y).toBeLessThan(app.find("Press i to type").y);
    expect(tab.x).toBeLessThan(app.find("Press i to type").x);
    await app.press("q");
    await app.press("escape");
    expect(app.calls("writeTerminal").map((call) => call.args[2])).toEqual(["q", "\x1b"]);
    // q went to the shell rather than quitting.
    expect(app.frame()).toContain("user@host:~$");
  });

  test("ctrl+\\ leaves the drawer and comes back to it; a click focuses it too", async () => {
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

  test("ctrl+j hides the drawer again, from it or from the conversation, and brings back the same terminal", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("user@host");
    expect(app.hints()).toStartWith("j/k threads");
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("user@host");
    await app.press("\\", { ctrl: true });
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("user@host");
    expect(app.calls("writeTerminal")).toHaveLength(0);
  });

  test("each terminal is a tab: a click, alt+1…9, or the T picker switches; + opens another", async () => {
    const second = { ...terminal, terminalId: "term-2" };
    const app = await open({ session: fakeSession({ terminals: [terminal, second], terminalEvents: [snapshot] }) });
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("Terminal 1  Terminal 2  +");
    const attached = () => app.calls("attachTerminal").map((call) => (call.args[0] as { terminalId: string }).terminalId);
    expect(attached()).toEqual(["term-1"]);
    await app.press("2", { meta: true });
    expect(attached()).toEqual(["term-1", "term-2"]);
    // From the conversation too, while the drawer shows.
    await app.press("\\", { ctrl: true });
    await app.press("1", { meta: true });
    expect(attached()).toEqual(["term-1", "term-2", "term-1"]);
    const tab = app.find("Terminal 2");
    await app.click(tab.x, tab.y);
    expect(attached()).toEqual(["term-1", "term-2", "term-1", "term-2"]);
    await app.press("T");
    await app.press("return");
    expect(attached().at(-1)).toBe("term-1");
    const plus = app.find("Terminal 2  +");
    await app.click(plus.x + "Terminal 2  ".length, plus.y);
    expect(app.calls("openTerminal")).toHaveLength(1);
    expect(app.frame()).toContain("Terminal 1  Terminal 2  Terminal 3  +");
    expect(attached().at(-1)).toBe("term-3");
  });

  test("a terminal that closes takes its tab away, and the last one the drawer", async () => {
    const closed = { type: "closed", threadId: v2ThreadId, terminalId: "term-1", createdAt: "2026-06-20T00:00:00.000Z" };
    const app = await open({ session: withTerminal([snapshot, closed]) });
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("Terminal 1  +");
    expect(app.hints()).toBe("Terminal closed");
  });

  test("dragging the drawer's edge resizes it and keeps the height; right-click resets it", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    await app.press("\\", { ctrl: true });
    const tabs = () => app.find("Terminal 1  +").y;
    const before = tabs();
    const edge = app.find("━");
    await app.mockMouse.drag(edge.x + 5, edge.y, edge.x + 5, edge.y - 4);
    await app.settle(100);
    expect(tabs()).toBe(before - 4);
    expect((await loadLayout()).drawerHeight).toBeGreaterThan(0);
    await app.click(edge.x + 5, edge.y - 4, 2);
    expect(tabs()).toBe(before);
    expect((await loadLayout()).drawerHeight).toBeNull();
  });

  test("on a short window the drawer takes the conversation's place", async () => {
    const app = await open({ height: 22, session: withTerminal() });
    expect(app.frame()).toContain("The reply above");
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("user@host:~$");
    expect(app.frame()).not.toContain("The reply above");
    expect(app.frame()).toContain("Press i to type");
  });

  test("Move terminal to the side puts terminals in the right column's Terminal tab, and stays", async () => {
    const app = await open({ width: 200, session: withTerminal() });
    await app.press("k", { ctrl: true });
    await app.type("move terminal to the side");
    await app.press("return");
    expect((await loadLayout()).terminalPlacement).toBe("side");
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("Details  Terminal");
    const tab = app.find("Terminal 1  +");
    expect(tab.x).toBeGreaterThan(200 - 38 - 1);
    expect(app.hints()).toBe("ctrl+\\ leave pane");
    // { and } step through the column's tabs from the conversation.
    await app.press("\\", { ctrl: true });
    await app.press("{");
    expect(app.frame()).not.toContain("user@host");
    expect(app.frame()).toContain("/workspace/project");
    await app.press("}");
    expect(app.frame()).toContain("user@host");
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("Details  Terminal");
  });

  test("the T picker can still attach full screen", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("T");
    expect(app.frame()).toContain("Attach full screen");
  });

  test("ctrl+g writes the message in $EDITOR in the composer's place, and what's saved comes back", async () => {
    const previous = { visual: process.env.VISUAL, editor: process.env.EDITOR };
    delete process.env.VISUAL;
    // Run as `$EDITOR "$1"`: this one waits a moment, overwrites the file and exits.
    process.env.EDITOR = "sleep 0.5; printf 'from the editor' >";
    try {
      const app = await open();
      await app.press("i");
      await app.type("draft");
      const composer = app.find("draft");
      await app.press("g", { ctrl: true });
      expect(app.frame()).toContain("Message · save and quit");
      expect(app.frame()).not.toContain("draft");
      expect(app.find("Message · save and quit").x).toBeLessThan(composer.x);
      expect(app.hints()).toBe("ctrl+\\ leave pane");
      for (let tries = 0; tries < 40 && app.frame().includes("Message · save and quit"); tries++) await app.settle(50);
      expect(app.frame()).not.toContain("Message · save and quit");
      expect(app.frame()).toContain("from the editor");
      expect(app.hints()).toStartWith("enter send");
    } finally {
      restoreEditor(previous);
    }
  });
});

const restoreEditor = (previous: { visual: string | undefined; editor: string | undefined }) => {
  if (previous.visual !== undefined) process.env.VISUAL = previous.visual;
  if (previous.editor === undefined) delete process.env.EDITOR;
  else process.env.EDITOR = previous.editor;
};

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

  test("a file on this machine opens in the column's Editor tab, which closes when the editor does", async () => {
    const root = mkdtempSync(join(tmpdir(), "t3tui-edit-"));
    writeFileSync(join(root, "README.md"), "hello\n");
    const project = { ...v2ShellSnapshot.projects[0]!, workspaceRoot: root };
    const previous = { visual: process.env.VISUAL, editor: process.env.EDITOR };
    delete process.env.VISUAL;
    process.env.EDITOR = "sleep 0.6; true";
    try {
      const app = await open({ width: 200, session: fakeSession({ vcs, snapshot: { ...v2ShellSnapshot, projects: [project] } }) });
      await app.press("l");
      await app.press("o");
      expect(app.frame()).toContain("Details  Editor");
      expect(app.frame()).toContain("Editing README.md");
      expect(app.find("Details  Editor").x).toBeGreaterThan(200 - 38 - 1);
      expect(app.hints()).toBe("ctrl+\\ leave pane");
      // Back to Details and to the editor again, with it still running.
      await app.press("\\", { ctrl: true });
      await app.press("}");
      expect(app.frame()).not.toContain("Editing README.md");
      await app.click(app.find("Editor").x, app.find("Editor").y);
      expect(app.frame()).toContain("Editing README.md");
      for (let tries = 0; tries < 40 && app.frame().includes("Details  Editor"); tries++) await app.settle(50);
      expect(app.frame()).not.toContain("Details  Editor");
      expect(app.frame()).toContain("Changes");
    } finally {
      restoreEditor(previous);
    }
  });
});
