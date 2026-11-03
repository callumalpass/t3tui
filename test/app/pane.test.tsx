import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RGBA } from "@opentui/core";

import { DEFAULT_LAYOUT, loadLayout } from "../../src/layout.ts";
import { colors } from "../../src/ui/theme.ts";
import { withReply } from "./fixtures.ts";
import { fakeSession, renderApp, v2ShellSnapshot, v2ThreadId } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
const saved = { visual: process.env.VISUAL, editor: process.env.EDITOR };
afterEach(() => {
  app?.destroy();
  app = null;
  for (const [key, value] of [["VISUAL", saved.visual], ["EDITOR", saved.editor]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
/** Runs as `$EDITOR "$1"`. */
const setEditor = (command: string) => {
  delete process.env.VISUAL;
  process.env.EDITOR = command;
};

const terminal = { threadId: v2ThreadId, terminalId: "term-1", cwd: "/workspace/project", worktreePath: null, status: "running", pid: 42, exitCode: null, exitSignal: null, hasRunningSubprocess: false, label: "", updatedAt: "2026-06-20T00:00:00.000Z" };
const second = { ...terminal, terminalId: "term-2" };
const snapshot = { type: "snapshot", threadId: v2ThreadId, terminalId: "term-1", createdAt: "2026-06-20T00:00:00.000Z", snapshot: { history: "earlier output\r\nuser@host:~$ " } };
const withTerminal = (events: readonly unknown[] = [snapshot]) => fakeSession({ terminals: [terminal], terminalEvents: events, projection: withReply("The reply above the drawer.", false) });
const withTerminals = () => fakeSession({ terminals: [terminal, second], terminalEvents: [snapshot], projection: withReply("The reply above the drawer.", false) });

const PREFIX_HINT = "ctrl+\\ … · tab next · j drawer · l column · 1-9 tab · x close · z zoom · n new · esc cancel";
const keysOn = (name: string) => `keys: ${name} · ctrl+\\ ctrl+\\ leave · ctrl+\\ panes`;
type App = Awaited<ReturnType<typeof renderApp>>;
/** ctrl+\, then a key. */
const prefix = async (app: App, key: string, modifiers?: Parameters<App["press"]>[1]) => {
  await app.press("\\", { ctrl: true });
  await app.press(key, modifiers);
};
const attached = (app: App) => app.calls("attachTerminal").map((call) => (call.args[0] as { terminalId: string }).terminalId);
/** The colours of the cell at a point. */
const cellAt = (app: App, x: number, y: number) => {
  const line = app.renderer.currentRenderBuffer.getSpanLines()[y] as unknown as { spans: { text: string; fg: RGBA; bg: RGBA }[] };
  let left = 0;
  for (const span of line.spans) {
    left += Bun.stringWidth(span.text);
    if (left > x) return { fg: span.fg.toString(), bg: span.bg.toString() };
  }
  throw new Error(`nothing at ${x},${y}`);
};
const color = (hex: string) => RGBA.fromHex(hex).toString();
const waitFor = async (check: () => boolean) => {
  for (let tries = 0; tries < 60 && !check(); tries++) await app?.settle(25);
};

/** A workspace on this machine holding README.md and src/ui/deep/TerminalPane.tsx, as the project's folder. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "t3tui-edit-"));
  writeFileSync(join(root, "README.md"), "hello\n");
  mkdirSync(join(root, "src/ui/deep"), { recursive: true });
  writeFileSync(join(root, "src/ui/deep/TerminalPane.tsx"), "export {};\n");
  const project = { ...v2ShellSnapshot.projects[0]!, workspaceRoot: root };
  return { root, snapshot: { ...v2ShellSnapshot, projects: [project] } };
}
/** A stand-in Neovim: it writes down how it was run; the instance waits, the remote calls answer at once (1 buffer modified). */
function fakeNvim() {
  const bin = mkdtempSync(join(tmpdir(), "t3tui-nvim-bin-"));
  const log = join(bin, "log");
  writeFileSync(join(bin, "nvim"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1" = --server ]; then case "$4" in len*) echo 1;; esac; exit 0; fi\nsleep 5\n`);
  chmodSync(join(bin, "nvim"), 0o755);
  setEditor(join(bin, "nvim"));
  return () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n");
    } catch {
      return [];
    }
  };
}

describe("terminal drawer", () => {
  test("ctrl+j opens the thread's terminal in a drawer below the composer, with its scrollback, and it takes every key", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("Terminal 1 ✕  + new");
    expect(app.frame()).toContain("user@host:~$");
    expect(app.calls("attachTerminal")).toHaveLength(1);
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    // Under the composer, the conversation's full width.
    const tab = app.find("Terminal 1 ✕");
    expect(tab.y).toBeGreaterThan(app.find("Press i to type").y);
    expect(tab.x).toBeLessThan(app.find("Press i to type").x);
    await app.press("q");
    await app.press("escape");
    expect(app.calls("writeTerminal").map((call) => call.args[2])).toEqual(["q", "\x1b"]);
    // q went to the shell rather than quitting.
    expect(app.frame()).toContain("user@host:~$");
  });

  test("ctrl+\\ is a prefix: twice leaves the drawer and comes back; any other key only cancels it and reaches no program", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    await app.press("\\", { ctrl: true });
    expect(app.hints()).toBe(PREFIX_HINT);
    await app.press("q");
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    await prefix(app, "escape");
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    expect(app.calls("writeTerminal")).toHaveLength(0);
    await prefix(app, "\\", { ctrl: true });
    expect(app.hints()).toStartWith("ctrl+\\ panes · j/k threads");
    await app.press("j");
    expect(app.calls("writeTerminal")).toHaveLength(0);
    await prefix(app, "\\", { ctrl: true });
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    await prefix(app, "k");
    expect(app.hints()).toStartWith("ctrl+\\ panes");
  });

  test("the prefix gives up after about two seconds", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    await app.press("\\", { ctrl: true });
    expect(app.hints()).toBe(PREFIX_HINT);
    await app.settle(2100);
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    await app.press("q");
    expect(app.calls("writeTerminal").map((call) => call.args[2])).toEqual(["q"]);
  });

  test("a click on the drawer focuses it; a click on the conversation or the message box takes the keys back", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    const reply = app.find("The reply above");
    await app.click(reply.x, reply.y);
    expect(app.hints()).toStartWith("ctrl+\\ panes · j/k threads");
    const shell = app.find("user@host");
    await app.click(shell.x, shell.y);
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    const composer = app.find("Press i to type");
    await app.click(composer.x, composer.y);
    expect(app.hints()).toStartWith("enter send");
  });

  test("ctrl+j hides the drawer again, from it or from the conversation, and brings back the same terminal", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("user@host");
    expect(app.hints()).toStartWith("j/k threads");
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("user@host");
    await prefix(app, "\\", { ctrl: true });
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("user@host");
    expect(app.calls("writeTerminal")).toHaveLength(0);
  });

  test("each terminal is a tab: a click, the prefix's 1…9, or the T picker switches; + new opens another", async () => {
    const app = await open({ session: withTerminals() });
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("Terminal 1 ✕  Terminal 2  + new");
    expect(attached(app)).toEqual(["term-1"]);
    await prefix(app, "2");
    expect(attached(app)).toEqual(["term-1", "term-2"]);
    expect(app.hints()).toBe(keysOn("Terminal 2"));
    // From the conversation too, the drawer's tabs.
    await prefix(app, "\\", { ctrl: true });
    await prefix(app, "1");
    expect(attached(app)).toEqual(["term-1", "term-2", "term-1"]);
    // alt+1…9 is gone.
    await app.press("2", { meta: true });
    expect(attached(app)).toEqual(["term-1", "term-2", "term-1"]);
    const tab = app.find("Terminal 2");
    await app.click(tab.x, tab.y);
    expect(attached(app)).toEqual(["term-1", "term-2", "term-1", "term-2"]);
    expect(app.hints()).toBe(keysOn("Terminal 2"));
    await prefix(app, "k");
    await app.press("T");
    await app.press("return");
    expect(attached(app).at(-1)).toBe("term-1");
    const plus = app.find("+ new");
    await app.click(plus.x, plus.y);
    expect(app.calls("openTerminal")).toHaveLength(1);
    expect(app.frame()).toContain("Terminal 1  Terminal 2  Terminal 3 ✕  + new");
    expect(attached(app).at(-1)).toBe("term-3");
    // So does the prefix's n.
    await prefix(app, "n");
    expect(app.calls("openTerminal")).toHaveLength(2);
  });

  test("the prefix's x, the active tab's ✕ and a middle click close a terminal, after asking", async () => {
    const app = await open({ session: withTerminals() });
    await app.press("j", { ctrl: true });
    await prefix(app, "x");
    expect(app.frame()).toContain("Close Terminal 1?");
    await app.press("escape");
    expect(app.calls("closeTerminal")).toHaveLength(0);
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    const close = app.find("Terminal 1 ✕");
    await app.click(close.x + "Terminal 1 ".length, close.y);
    expect(app.frame()).toContain("Close Terminal 1?");
    await app.press("return");
    expect(app.calls("closeTerminal").map((call) => call.args[1])).toEqual(["term-1"]);
    const other = app.find("Terminal 2");
    await app.mockMouse.click(other.x, other.y, 1);
    await app.settle();
    expect(app.frame()).toContain("Close Terminal 2?");
  });

  test("the prefix's z zooms the drawer over the conversation and the message box, until z again", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    const tabs = app.find("Terminal 1 ✕").y;
    await prefix(app, "z");
    expect(app.frame()).not.toContain("The reply above");
    expect(app.frame()).not.toContain("Press i to type");
    expect(app.find("Terminal 1 ✕").y).toBeLessThan(tabs);
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    await prefix(app, "z");
    expect(app.frame()).toContain("The reply above");
    expect(app.find("Terminal 1 ✕").y).toBe(tabs);
    // From the conversation, z zooms the pane that last had the keys.
    await prefix(app, "k");
    await prefix(app, "z");
    expect(app.frame()).not.toContain("The reply above");
    expect(app.hints()).toBe(keysOn("Terminal 1"));
  });

  test("the focused pane's strip and edge light up; the message box's bar steps back", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    const tab = app.find("Terminal 1 ✕");
    const shell = app.find("user@host");
    const bar = app.find("Press i to type");
    expect(cellAt(app, tab.x, tab.y).fg).toBe(color(colors.accent));
    expect(cellAt(app, tab.x - 2, tab.y).bg).toBe(color(colors.element));
    expect(cellAt(app, shell.x - 1, shell.y).fg).toBe(color(colors.accent));
    expect(cellAt(app, bar.x - 3, bar.y).fg).toBe(color(colors.faint));
    await prefix(app, "k");
    expect(cellAt(app, tab.x, tab.y).fg).toBe(color(colors.muted));
    expect(cellAt(app, tab.x - 2, tab.y).bg).toBe(color(colors.panel));
    expect(cellAt(app, shell.x - 1, shell.y).fg).toBe(color(colors.faint));
    expect(cellAt(app, bar.x - 3, bar.y).fg).toBe(color(colors.border));
  });

  test("while the drawer is hidden, a strip under the message box names the terminals this run opened; a click brings one back", async () => {
    const app = await open({ session: withTerminals() });
    expect(app.frame()).not.toContain("▸ Terminal");
    await app.press("j", { ctrl: true });
    await app.press("j", { ctrl: true });
    // Terminal 2 wasn't opened here.
    expect(app.frame()).toContain("▸ Terminal 1   ctrl+j");
    expect(app.find("▸ Terminal 1").y).toBeGreaterThan(app.find("Press i to type").y);
    await prefix(app, "j");
    await prefix(app, "2");
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("▸ Terminal 1 · Terminal 2   ctrl+j");
    const name = app.find("Terminal 1 · ");
    await app.click(name.x, name.y);
    expect(attached(app).at(-1)).toBe("term-1");
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    expect(app.frame()).not.toContain("▸ Terminal");
  });

  test("a terminal that closes takes its tab away, and the last one the drawer", async () => {
    const closed = { type: "closed", threadId: v2ThreadId, terminalId: "term-1", createdAt: "2026-06-20T00:00:00.000Z" };
    const app = await open({ session: withTerminal([snapshot, closed]) });
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("Terminal 1 ✕");
    expect(app.hints()).toBe("Terminal closed");
  });

  test("dragging the drawer's edge resizes it and keeps the height; right-click resets it", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("j", { ctrl: true });
    await prefix(app, "k");
    const tabs = () => app.find("Terminal 1 ✕").y;
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

  test("Pane: move terminal to the side puts each terminal in the right column's one strip of tabs, and stays", async () => {
    const app = await open({ width: 200, layout: { ...DEFAULT_LAYOUT, detailsWidth: 54 }, session: withTerminals() });
    await app.press("k", { ctrl: true });
    await app.type("move terminal to the side");
    await app.press("return");
    expect((await loadLayout()).terminalPlacement).toBe("side");
    await app.press("j", { ctrl: true });
    expect(app.frame()).toContain("Details  Files  Terminal 1 ✕  Terminal 2  + new");
    expect(app.frame().match(/Terminal 2/g)).toHaveLength(1);
    expect(app.find("Details  Files  Terminal 1").x).toBeGreaterThan(200 - 54 - 1);
    expect(app.frame()).toContain("user@host");
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    // The prefix's 1…9 count the column's tabs (Details, Files, then the rest); Details gives the keys back.
    await prefix(app, "1");
    expect(app.frame()).not.toContain("user@host");
    expect(app.frame()).toContain("/workspace/project");
    expect(app.hints()).toStartWith("ctrl+\\ panes");
    await prefix(app, "l");
    expect(app.frame()).toContain("user@host");
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    await prefix(app, "4");
    expect(attached(app).at(-1)).toBe("term-2");
    expect(app.hints()).toBe(keysOn("Terminal 2"));
    await app.press("j", { ctrl: true });
    expect(app.frame()).not.toContain("Details  Terminal");
  });

  test("the T picker can still attach full screen", async () => {
    const app = await open({ session: withTerminal() });
    await app.press("T");
    expect(app.frame()).toContain("Attach full screen");
  });

  test("ctrl+g writes the message in $EDITOR in the composer's place, and what's saved comes back", async () => {
    // This one waits a moment, overwrites the file and exits.
    setEditor("sleep 0.8; printf 'from the editor' >");
    const app = await open();
    await app.press("i");
    await app.type("draft");
    const composer = app.find("draft");
    await app.press("g", { ctrl: true });
    expect(app.frame()).toContain("Message · save and quit");
    expect(app.frame()).not.toContain("draft");
    expect(app.find("Message · save and quit").x).toBeLessThan(composer.x);
    expect(app.hints()).toBe(keysOn("message"));
    // Zoomed, it takes the conversation's place too.
    const top = app.find("Message · save and quit").y;
    await prefix(app, "z");
    expect(app.find("Message · save and quit").y).toBeLessThan(top);
    expect(app.frame()).not.toContain("Do the thing");
    await waitFor(() => !app.frame().includes("Message · save and quit"));
    expect(app.frame()).not.toContain("Message · save and quit");
    expect(app.frame()).toContain("from the editor");
    expect(app.hints()).toStartWith("enter send");
  });

  test("$EDITOR's terminal is the size of the box it's in, even a box shorter than 24 rows", async () => {
    // It writes its size on its top and bottom rows, and again when that changes.
    setEditor(`draw() { printf '\\033[2J\\033[1;1Htop %s\\033[999;1Hbottom %s' "$(stty size)" "$(stty size)"; }; trap draw WINCH; draw; for i in $(seq 50); do sleep 0.1; done #`);
    const app = await open({ width: 100, height: 20 });
    await app.press("i");
    await app.press("g", { ctrl: true });
    await waitFor(() => app.frame().includes("bottom "));
    const rows = app.find("bottom ").y - app.find("top ").y + 1;
    expect(app.frame()).toContain(`bottom ${rows} `);
    // Zoomed, it gets the taller box.
    await prefix(app, "z");
    await waitFor(() => !app.frame().includes(`bottom ${rows} `));
    const zoomed = app.find("bottom ").y - app.find("top ").y + 1;
    expect(zoomed).toBeGreaterThan(rows);
    expect(app.frame()).toContain(`bottom ${zoomed} `);
  });
});

describe("the panes together", () => {
  test("tab after ctrl+\\ moves through the message editor, the drawer and the column in turn, and back; shift+tab goes the other way", async () => {
    const { snapshot } = workspace();
    setEditor("sleep 5; true");
    const vcs = { status: "live", local: { isRepo: true, hasPrimaryRemote: true, isDefaultRef: true, refName: "main", hasWorkingTreeChanges: true, workingTree: { files: [{ path: "README.md", insertions: 1, deletions: 0 }], insertions: 1, deletions: 0 } }, remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null } };
    const app = await open({ width: 200, height: 50, session: fakeSession({ snapshot, vcs, terminals: [terminal], terminalEvents: [snapshot] }) });
    await app.press("l");
    await app.press("o");
    expect(app.hints()).toBe(keysOn("README.md"));
    await prefix(app, "k");
    await app.press("j", { ctrl: true });
    await prefix(app, "k");
    await app.press("g", { ctrl: true });
    expect(app.hints()).toBe(keysOn("message"));
    const order = [];
    for (let step = 0; step < 4; step++) {
      await prefix(app, "tab");
      order.push(app.hints());
    }
    expect(order).toEqual([keysOn("Terminal 1"), keysOn("README.md"), expect.stringMatching(/^ctrl\+\\ panes/), keysOn("message")]);
    await prefix(app, "tab", { shift: true });
    expect(app.hints()).toStartWith("ctrl+\\ panes");
    await prefix(app, "tab", { shift: true });
    expect(app.hints()).toBe(keysOn("README.md"));
    await prefix(app, "j");
    expect(app.hints()).toBe(keysOn("Terminal 1"));
    await prefix(app, "l");
    expect(app.hints()).toBe(keysOn("README.md"));
    await prefix(app, "h");
    expect(app.hints()).toStartWith("ctrl+\\ panes");
  });

  test("the palette lists terminal and pane commands under one prefix each, closing and clearing only the active terminal", async () => {
    const app = await open({ session: withTerminals() });
    await app.press("j", { ctrl: true });
    await prefix(app, "k");
    await app.press("k", { ctrl: true });
    await app.type("terminal:");
    const frame = app.frame();
    for (const title of ["Terminal: hide", "Terminal: new", "Terminal: attach full screen", "Terminal: pick…", "Terminal: close Terminal 1", "Terminal: clear Terminal 1"]) expect(frame).toContain(title);
    expect(frame).not.toContain("Terminal 2");
    await app.press("escape");
    await app.press("k", { ctrl: true });
    await app.type("pane:");
    for (const title of ["Pane: next", "Pane: zoom", "Pane: move terminal to the side"]) expect(app.frame()).toContain(title);
  });

  test("the palette sits on a solid backdrop over the whole conversation area, so no conversation shows beside it", async () => {
    const app = await open({ session: fakeSession({ projection: withReply("Decision: fix the bleed at the palette's edges.", false) }) });
    const reply = app.find("Decision:");
    await app.press("k", { ctrl: true });
    const lines = app.frame().split("\n");
    expect(lines.some((line) => line.includes("Decision"))).toBe(false);
    // The backdrop runs from the list's edge to the right edge, below the header to above the hints.
    expect(cellAt(app, reply.x, reply.y).bg).toBe(color(colors.panel));
    expect(cellAt(app, 139, 1).bg).toBe(color(colors.panel));
    expect(cellAt(app, reply.x, 38).bg).toBe(color(colors.panel));
    const search = app.find("Search commands");
    const left = search.x - reply.x;
    expect(left).toBeGreaterThan(2);
  });
});

describe("editing a changed file", () => {
  const vcs = {
    status: "live",
    local: { isRepo: true, hasPrimaryRemote: true, isDefaultRef: true, refName: "main", hasWorkingTreeChanges: true, workingTree: { files: [{ path: "README.md", insertions: 2, deletions: 1 }], insertions: 2, deletions: 1 } },
    remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null },
  };
  const twoFiles = { ...vcs, local: { ...vcs.local, workingTree: { ...vcs.local.workingTree, files: [{ path: "README.md", insertions: 2, deletions: 1 }, { path: "src/ui/deep/TerminalPane.tsx", insertions: 1, deletions: 0 }] } } };
  /** o on each changed file in turn, from the details panel. */
  const editBoth = async (app: App) => {
    await app.press("l");
    await app.press("o");
    await prefix(app, "k");
    await app.press("l");
    for (let tries = 0; tries < 8 && !app.hints().includes("o edit file"); tries++) await app.press("j");
    await app.press("j");
    await app.press("o");
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

  test("a file on this machine opens in a tab of the column named by its path, which closes when the editor does", async () => {
    const { snapshot } = workspace();
    setEditor("sleep 0.6; true");
    const app = await open({ width: 200, session: fakeSession({ vcs, snapshot }) });
    await app.press("l");
    await app.press("o");
    expect(app.frame()).toContain("Details  Files  README.md ✕");
    expect(app.find("Details  Files  README.md").x).toBeGreaterThan(200 - 38 - 1);
    expect(app.hints()).toBe(keysOn("README.md"));
    // Back to Details and to the editor again, with it still running.
    await prefix(app, "1");
    expect(app.frame()).toContain("Changes");
    const tab = app.find("Details  Files  README.md");
    await app.click(tab.x + "Details  Files  ".length, tab.y);
    expect(app.hints()).toBe(keysOn("README.md"));
    await waitFor(() => !app.frame().includes("Details  Files  README.md"));
    expect(app.frame()).not.toContain("Details  Files  README.md");
    expect(app.frame()).toContain("Changes");
  });

  test("each file gets a tab of its own, named from the workspace and shortened from the middle", async () => {
    const { snapshot } = workspace();
    setEditor("sleep 5; true");
    const app = await open({ width: 200, session: fakeSession({ vcs: twoFiles, snapshot }) });
    await editBoth(app);
    // The column's default width cuts them; wider, they fit.
    expect(app.frame()).toContain("Details  Files  …DME.md  …ne.tsx ✕");
    await app.mockMouse.drag(200 - 39, 10, 200 - 68, 10);
    await app.settle(100);
    expect(app.frame()).toContain("Details  Files  README.md  src/ui/deep/TerminalPane.tsx ✕");
    expect(app.frame()).toContain("src/ui/deep/TerminalPane.tsx");
    expect(app.hints()).toBe(keysOn("TerminalPane.tsx"));
    await prefix(app, "3");
    expect(app.hints()).toBe(keysOn("README.md"));
    // An editor that can't be asked to quit isn't closed under you.
    await prefix(app, "x");
    expect(app.hints()).toStartWith("Quit README.md from inside it");
    expect(app.frame()).toContain("Details  Files  README.md ✕");
  });

  test("Neovim takes further files in the instance already running, through its socket, and the prefix's x asks it to quit", async () => {
    const { root, snapshot } = workspace();
    const log = fakeNvim();
    const app = await open({ width: 200, layout: { ...DEFAULT_LAYOUT, detailsWidth: 46 }, session: fakeSession({ vcs: twoFiles, snapshot }) });
    await editBoth(app);
    await waitFor(() => log().some((line) => line.includes("--remote-expr")));
    expect(app.frame()).toContain("Details  Files  src/…/TerminalPane.tsx ✕");
    expect(app.frame()).not.toContain("README.md ✕");
    expect(app.hints()).toBe(keysOn("TerminalPane.tsx"));
    const [listen, remote] = log();
    const socket = /^--listen (\S+) /.exec(listen ?? "")?.[1];
    expect(listen).toBe(`--listen ${socket} ${join(root, "README.md")}`);
    expect(remote).toBe(`--server ${socket} --remote-expr execute('drop ' .. fnameescape('${join(root, "src/ui/deep/TerminalPane.tsx")}'))`);
    await prefix(app, "x");
    await waitFor(() => log().length > 2);
    expect(log()[2]).toBe(`--server ${socket} --remote-send <C-\\><C-N>:confirm qa<CR>`);
  });

  test("with the column hidden, the header names the editor still running in it, with ● for unsaved changes", async () => {
    const { snapshot } = workspace();
    fakeNvim();
    const app = await open({ width: 200, session: fakeSession({ vcs, snapshot }) });
    await app.press("l");
    await app.press("o");
    await prefix(app, "k");
    await app.press("d");
    await waitFor(() => app.frame().includes("●"));
    expect(app.frame().split("\n")[0]).toContain("Editor: README.md ● · d");
    const note = app.find("Editor: README.md");
    await app.click(note.x, note.y);
    expect(app.frame()).toContain("Details  Files  README.md ✕");
  });

  test("on a narrow window the column, editor and all, takes the conversation's place", async () => {
    const { snapshot } = workspace();
    setEditor("sleep 3; true");
    const app = await open({ width: 100, session: fakeSession({ vcs, snapshot, projection: withReply("The reply under the column.", false) }) });
    await app.press("d");
    await app.press("l");
    await app.press("o");
    expect(app.find("README.md ✕").x).toBeLessThan(50);
    expect(app.frame()).not.toContain("The reply under");
    expect(app.frame()).toContain("Press i to type");
    // d hides the column, editor and all, and brings it back with the editor still running.
    await prefix(app, "k");
    await app.press("d");
    expect(app.frame()).toContain("The reply under");
    await app.press("d");
    expect(app.frame()).toContain("README.md ✕");
  });
});
