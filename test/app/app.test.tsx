import { afterEach, describe, expect, test } from "bun:test";

import { withApproval, withQuestion } from "./fixtures.ts";
import { fakeSession, renderApp, v2ThreadId } from "./harness.tsx";

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
    expect(app.frame()).not.toContain("Workspace");
    await app.press("d");
    expect(app.frame()).toContain("Workspace");
    await app.press("d");
    expect(app.frame()).not.toContain("Workspace");
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

describe("approvals", () => {
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

describe("mouse", () => {
  test("the header button opens the palette", async () => {
    const app = await open();
    const button = app.find("commands ctrl+k");
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
    const row = app.find("135d");
    await app.click(row.x, row.y, 2);
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
    const before = app.find("│").x;
    await app.mockMouse.drag(before, 10, before + 10, 10);
    await app.settle();
    expect(app.find("│").x).toBe(before + 10);
    await app.click(before + 10, 10, 2);
    expect(app.find("│").x).toBe(before);
  });
});
