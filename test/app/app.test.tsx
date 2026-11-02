import { afterEach, describe, expect, test } from "bun:test";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import { omittedCommand, withApproval, withCompletedTurn, withOmittedOutput, withQuestion, withWorking } from "./fixtures.ts";
import { loadLayout } from "../../src/layout.ts";
import { fakeSession, renderApp, v2Projection, v2ThreadId } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

describe("modes and hints", () => {
  test("navigation lists the thread keys; i types, esc goes back", async () => {
    const app = await open();
    expect(app.hints()).toBe("j/k threads · / filter · i type · c new · a attach · . actions · m model · ctrl+j terminal · l details · ctrl+k commands · q quit");
    await app.press("i");
    expect(app.hints()).toBe("enter send · shift+enter or \\ newline · ctrl+g editor · esc navigate · ctrl+n/p thread");
    await app.press("escape");
    expect(app.hints()).toStartWith("j/k threads");
  });

  test("the send shortcut setting changes the input hints", async () => {
    const app = await open({ config: { sendShortcut: "ctrl-enter" } });
    await app.press("i");
    expect(app.hints()).toStartWith("ctrl+enter send · enter newline");
  });

  test("/ filters the list; esc closes it", async () => {
    const app = await open();
    await app.press("/");
    expect(app.hints()).toBe("enter done · esc close");
    await app.press("escape");
    expect(app.hints()).toStartWith("j/k threads");
  });

  test("f finds in the thread", async () => {
    const app = await open();
    await app.press("f");
    expect(app.hints()).toBe("enter next match · shift+enter previous · ctrl+n/p match · esc close find");
    await app.press("escape");
    expect(app.hints()).toStartWith("j/k threads");
  });

  test("l focuses the details panel; h leaves it", async () => {
    const app = await open();
    await app.press("l");
    expect(app.hints()).toBe("j/k move · enter open · t toggle automation · esc back");
    await app.press("h");
    expect(app.hints()).toStartWith("j/k threads");
  });

  test("d toggles the details column", async () => {
    const app = await open();
    expect(app.frame()).not.toContain("/workspace/project ·");
    await app.press("d");
    expect(app.frame()).toContain("/workspace/project ·");
    await app.press("d");
    expect(app.frame()).not.toContain("/workspace/project ·");
  });
});

describe("keys falling through", () => {
  test("in the details panel, navigation keys still work", async () => {
    const app = await open();
    await app.press("l");
    await app.press("c");
    expect(app.frame()).toContain("What should the new thread do?");
  });

  test("the composer's / menu takes the arrows and esc; esc again leaves the composer", async () => {
    const app = await open();
    await app.press("i");
    await app.type("/");
    expect(app.hints()).toBe("↑/↓ move · tab or enter choose · esc close");
    await app.press("escape");
    expect(app.hints()).toStartWith("enter send");
    await app.press("escape");
    expect(app.hints()).toStartWith("j/k threads");
  });

  test("tab chooses from the / menu: /model opens the model picker", async () => {
    const app = await open();
    await app.press("i");
    await app.type("/mo");
    expect(app.frame()).toContain("/model");
    await app.press("tab");
    // Without the server's providers the picker says so rather than opening empty.
    expect(app.hints()).toBe("Still loading the server's providers.");
  });
});

describe("palette and pickers", () => {
  test("ctrl+k opens the palette, typing filters it, esc closes it", async () => {
    const app = await open();
    await app.press("k", { ctrl: true });
    expect(app.hints()).toBe("↑/↓ move · enter run · esc close");
    expect(app.frame()).toContain("New thread");
    await app.type("settings");
    expect(app.frame()).toContain("Settings");
    await app.press("escape");
    expect(app.hints()).toStartWith("j/k threads");
  });

  test("palette commands show their keys", async () => {
    const app = await open();
    await app.press("k", { ctrl: true });
    await app.type("new thread");
    expect(app.frame()).toMatch(/New thread\s+c/);
  });

  test("palette entries for pending requests carry their keys", async () => {
    const app = await open({ session: fakeSession({ projection: withApproval() }) });
    await app.press("k", { ctrl: true });
    await app.type("always allow");
    expect(app.frame()).toMatch(/Always allow this session\s+Y/);
  });

  test("running a command from the palette", async () => {
    const app = await open();
    await app.press("k", { ctrl: true });
    await app.type("settings");
    await app.press("return");
    expect(app.hints()).toBe("j/k move · enter change · esc close");
    await app.press("escape");
    expect(app.hints()).toStartWith("j/k threads");
  });

  test(". opens the thread's actions, and choosing one runs it", async () => {
    const app = await open();
    await app.press(".");
    expect(app.hints()).toBe("↑/↓ move · enter choose · esc close");
    await app.type("unread");
    await app.press("return");
    expect(app.calls("markUnread").map((call) => call.args[0])).toEqual([v2ThreadId]);
    expect(app.hints()).toBe("Marked unread");
  });
});

describe("a finished turn", () => {
  test("its changed files fold out under the reply, and a file opens the turn's diff", async () => {
    const patch = "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const app = await open({ session: fakeSession({ projection: withCompletedTurn(), results: { turnDiff: { diff: patch } } }) });
    expect(app.frame()).toContain("✎ 3 files  +42 −7 ›");
    expect(app.frame()).not.toContain("src/util.ts");
    const line = app.find("3 files");
    await app.click(line.x, line.y);
    expect(app.frame()).toContain("src/index.ts");
    expect(app.frame()).toContain("src/util.ts");
    expect(app.frame()).toContain("+30 −5");
    const file = app.find("src/util.ts");
    await app.click(file.x, file.y);
    await app.settle(50);
    expect(app.calls("turnDiff").map((call) => call.args[0])).toEqual([{ threadId: v2ThreadId, toTurnCount: 1, ignoreWhitespace: true, fromTurnCount: 0 }]);
    expect(app.frame()).toContain("Turn 1");
  });

  test("its footer names the model, the duration and the time", async () => {
    const app = await open({ session: fakeSession({ projection: withCompletedTurn() }) });
    // The date half is locale- and timezone-shaped; the model and duration are not.
    expect(app.frame()).toMatch(/gpt-5\.4 · 3m 12s · /);
  });
});

describe("live status", () => {
  test("while working, one status line sits above the composer and none in the timeline", async () => {
    const app = await open({ session: fakeSession({ projection: withWorking() }) });
    const frame = app.frame();
    expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Working for /);
    expect(frame.split("Working for")).toHaveLength(2);
    expect(frame).not.toContain("◐");
    const lines = frame.split("\n");
    const status = lines.findIndex((line) => line.includes("Working for"));
    const composer = lines.findIndex((line) => line.includes("Press i to type"));
    expect(status).toBeGreaterThan(-1);
    expect(status).toBeLessThan(composer);
    // The live tool itself stays a timeline row.
    expect(frame).toContain("Running bun");
  });
});

describe("approvals", () => {
  test("the request shows above the composer, with its buttons, and not in the timeline", async () => {
    const app = await open({ session: fakeSession({ projection: withApproval() }) });
    const frame = app.frame();
    expect(frame).toContain("Command approval");
    expect(frame).toContain("Deletes dist/ and rebuilds it.");
    // Only the composer block names the command; its timeline row is hidden.
    expect(frame.split("rm -rf dist && bun run build")).toHaveLength(2);
    // The composer stays below it, so a message can still go with a decline.
    expect(app.find("Command approval").y).toBeLessThan(app.find("gpt-5.4").y);
    const approve = app.find("Approve");
    await app.click(approve.x, approve.y);
    expect(app.calls("respond").map((call) => call.args[2])).toEqual(["accept"]);
  });

  test("y, Y and n answer the request", async () => {
    const app = await open({ session: fakeSession({ projection: withApproval() }) });
    expect(app.hints()).toStartWith("y approve · Y always · n decline · j/k threads");
    await app.press("y");
    await app.press("Y");
    await app.press("n");
    expect(app.calls("respond").map((call) => call.args[2])).toEqual(["accept", "acceptForSession", "decline"]);
  });

  test("clicking a hint answers too", async () => {
    const app = await open({ session: fakeSession({ projection: withApproval() }) });
    const hint = app.find("Y always");
    await app.click(hint.x, hint.y);
    expect(app.calls("respond").map((call) => call.args[2])).toEqual(["acceptForSession"]);
  });

  test("while typing, the hints say an approval is waiting", async () => {
    const app = await open({ session: fakeSession({ projection: withApproval() }) });
    await app.press("i");
    expect(app.hints()).toStartWith("approval waiting: esc, then y/n · enter send");
  });
});

describe("questions", () => {
  test("a digit picks an option and answers", async () => {
    const app = await open({ session: fakeSession({ projection: withQuestion() }) });
    expect(app.hints()).toStartWith("1-9 pick · x dismiss");
    await app.press("2");
    await app.settle(300);
    expect(app.calls("answer").map((call) => call.args[2])).toEqual([{ q1: "Blue" }]);
  });

  test("clicking an option answers", async () => {
    const app = await open({ session: fakeSession({ projection: withQuestion() }) });
    const option = app.find("Red");
    await app.click(option.x, option.y);
    await app.settle(300);
    expect(app.calls("answer").map((call) => call.args[2])).toEqual([{ q1: "Red" }]);
  });

  test("x dismisses it", async () => {
    const app = await open({ session: fakeSession({ projection: withQuestion() }) });
    await app.press("x");
    expect(app.calls("dismissQuestion")).toHaveLength(1);
  });
});

describe("composer", () => {
  test("enter sends the message", async () => {
    const app = await open();
    await app.press("i");
    await app.type("hello there");
    await app.press("return");
    expect(app.calls("sendMessage").map((call) => [call.args[0], call.args[1]])).toEqual([[v2ThreadId, "hello there"]]);
  });

  test("ctrl+u deletes to the start of the line rather than scrolling", async () => {
    const app = await open();
    await app.press("i");
    await app.type("hello there");
    await app.press("u", { ctrl: true });
    expect(app.frame()).not.toContain("hello there");
  });

  test("c starts a new thread draft; esc twice cancels it", async () => {
    const app = await open();
    await app.press("c");
    expect(app.frame()).toContain("What should the new thread do?");
    await app.press("escape");
    expect(app.hints()).toBe("i write the first message · p project · m model & mode · w worktree · esc cancel");
    await app.press("w");
    expect(app.frame()).toContain("a new worktree from the default branch");
    await app.press("escape");
    expect(app.hints()).toStartWith("j/k threads");
  });
});

describe("connection", () => {
  const reconnecting = () => ({ type: "reconnecting", message: "connect ECONNREFUSED 127.0.0.1:3773", retryAt: Date.now() + 5_000 }) as const;

  test("a dropped connection says why and when it retries; r and a click on it retry now", async () => {
    const app = await open({ session: fakeSession({ status: reconnecting() }) });
    expect(app.frame()).toMatch(/couldn't connect, retrying in \ds · connect ECONNREFUSED/);
    expect(app.hints()).toStartWith("r reconnect now · ");
    await app.press("r");
    expect(app.calls("retryNow")).toHaveLength(1);
    const at = app.find("couldn't connect");
    await app.click(at.x, at.y);
    expect(app.calls("retryNow")).toHaveLength(2);
  });

  test("while disconnected, enter keeps the message rather than sending it", async () => {
    const app = await open({ session: fakeSession({ status: reconnecting() }) });
    await app.press("i");
    await app.type("hello there");
    await app.press("return");
    expect(app.calls("sendMessage")).toHaveLength(0);
    expect(app.hints()).toStartWith("Not connected: message not sent.");
    expect(app.frame()).toContain("hello there");
  });

  test("a send that fails puts the message back in the composer", async () => {
    const app = await open({ session: fakeSession({ failures: { sendMessage: "socket closed" } }) });
    await app.press("i");
    await app.type("hello there");
    await app.press("return");
    expect(app.calls("sendMessage")).toHaveLength(1);
    expect(app.hints()).toBe("Not sent: socket closed");
    expect(app.frame()).toContain("hello there");
  });
});

describe("command output", () => {
  const session = () => fakeSession({ projection: withOmittedOutput(), results: { turnItem: { ...omittedCommand, outputOmitted: false, output: "12 pass\n0 fail" } } });

  test("output the server left out loads when the command opens", async () => {
    const app = await open({ session: session() });
    const row = app.find("bun test");
    await app.click(row.x, row.y);
    await app.settle(50);
    expect(app.calls("turnItem").map((call) => call.args)).toEqual([[omittedCommand.threadId, omittedCommand.id]]);
    expect(app.frame()).toContain("12 pass");
  });

  test("Copy output fetches it first", async () => {
    const app = await open({ session: session() });
    const row = app.find("bun test");
    await app.click(row.x, row.y, 2);
    await app.type("copy output");
    await app.press("return");
    await app.settle(50);
    expect(app.calls("turnItem")).toHaveLength(1);
    expect(app.hints()).toBe("Copied the output");
  });
});

describe("details panel", () => {
  const steps = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, text: `Step ${index}`, status: index < 2 ? "completed" : index === 2 ? "running" : "pending" }));
  const projection = {
    ...v2Projection,
    providerTurns: [{ tokenUsage: { usedTokens: 62_000, maxTokens: 100_000, updatedAt: "2026-06-20T00:00:00.000Z" } }],
    turnItems: [{ id: "todo", type: "todo_list", planId: "p", steps }],
  } as unknown as OrchestrationV2ThreadProjection;
  const vcs = {
    status: "live",
    local: {
      isRepo: true,
      hasPrimaryRemote: true,
      isDefaultRef: true,
      refName: "main",
      hasWorkingTreeChanges: true,
      workingTree: { files: [{ path: "README.md", insertions: 29, deletions: 167 }, { path: "docs/", insertions: 0, deletions: 0 }], insertions: 29, deletions: 167 },
    },
    remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null },
  };

  test("shows the context left, tasks, changes and branch", async () => {
    const app = await open({ width: 200, session: fakeSession({ projection, vcs }) });
    const frame = app.frame();
    expect(frame).toContain("Context  ████░░░░░░  38% left");
    expect(frame).toMatch(/Tasks +2\/8/);
    expect(frame).toContain("◐ Step 2");
    expect(frame).not.toContain("Step 7");
    expect(frame).toMatch(/M README\.md +\+29 −167/);
    expect(frame).toMatch(/\? docs\/ +new/);
    expect(frame).toContain("▸ View diff");
    // Up to date: no ahead/behind counts, no hint.
    expect(frame).toMatch(/┃ main +\n/);
    expect(frame).not.toContain("↑0");
    const more = app.find("› 3 more");
    await app.click(more.x, more.y);
    expect(app.frame()).toContain("Step 7");
    expect(app.frame()).toContain("‹ fewer");
  });

  test("leaves out the context line without usage reports", async () => {
    const app = await open({ width: 200 });
    expect(app.frame()).not.toContain("Context");
    expect(app.frame()).not.toContain("Tasks");
  });
});

describe("mouse", () => {
  test("the header button opens the palette", async () => {
    const app = await open();
    const button = app.find("ctrl+k commands");
    await app.click(button.x + 1, button.y);
    expect(app.hints()).toBe("↑/↓ move · enter run · esc close");
  });

  test("clicking a hint presses its key", async () => {
    const app = await open();
    const hint = app.find("l details");
    await app.click(hint.x, hint.y);
    expect(app.hints()).toBe("j/k move · enter open · t toggle automation · esc back");
  });

  test("right-clicking a thread opens its actions", async () => {
    const app = await open();
    // The list row is the "Thread" below the header; its relative age grows daily, so don't look for it.
    const y = app.frame().split("\n").findIndex((line, index) => index > 0 && line.includes("Thread"));
    await app.click(5, y, 2);
    expect(app.hints()).toBe("↑/↓ move · enter choose · esc close");
    expect(app.frame()).toContain("Mark unread");
  });

  test("clicking the composer starts typing; clicking the conversation leaves it", async () => {
    const app = await open();
    const box = app.find("Press i to type");
    await app.click(box.x, box.y);
    expect(app.hints()).toStartWith("enter send");
    await app.click(80, 10);
    expect(app.hints()).toStartWith("j/k threads");
  });

  test("dragging the divider resizes the list; right-click resets it", async () => {
    const app = await open();
    // The divider is an invisible-at-rest accent bar (┃ in the background colour).
    const before = app.find("┃").x;
    await app.mockMouse.drag(before, 10, before + 10, 10);
    await app.settle();
    expect(app.find("┃").x).toBe(before + 10);
    await app.click(before + 10, 10, 2);
    expect(app.find("┃").x).toBe(before);
  });

  test("the list keeps its dragged width for the next run", async () => {
    const first = await open();
    const before = first.find("┃").x;
    await first.mockMouse.drag(before, 10, before + 7, 10);
    await first.settle(100);
    first.destroy();
    const layout = await loadLayout();
    expect(layout.listWidth).toBe(before + 7);
    const next = await open({ layout });
    expect(next.find("┃").x).toBe(before + 7);
  });

  test("B hides the thread list and brings it back, and the next run remembers", async () => {
    const first = await open();
    const composer = () => first.find("Press i to type").x;
    const withList = composer();
    await first.press("B");
    expect(composer()).toBeLessThan(withList);
    expect((await loadLayout()).listHidden).toBe(true);
    first.destroy();
    const next = await open({ layout: await loadLayout() });
    expect(next.find("Press i to type").x).toBeLessThan(withList);
    await next.press("B");
    expect(next.find("Press i to type").x).toBe(withList);
    expect((await loadLayout()).listHidden).toBe(false);
  });

  test("d's choice for the details column is kept for the next run", async () => {
    const first = await open({ width: 200 });
    await first.press("d");
    expect((await loadLayout()).details).toBe(false);
  });

  test("dragging the details edge resizes it and keeps the width; right-click resets it", async () => {
    // Wide enough for the details column to open by itself.
    const first = await open({ width: 200 });
    // The details edge is the last bar on a row above the composer.
    const edge = () => first.frame().split("\n")[10]!.lastIndexOf("┃");
    const before = edge();
    expect(before).toBe(200 - 38 - 1);
    await first.mockMouse.drag(before, 10, before - 10, 10);
    await first.settle(100);
    expect(edge()).toBe(before - 10);
    expect((await loadLayout()).detailsWidth).toBe(48);
    await first.click(before - 10, 10, 2);
    await first.settle(100);
    expect(edge()).toBe(before);
    expect((await loadLayout()).detailsWidth).toBeNull();
  });
});
