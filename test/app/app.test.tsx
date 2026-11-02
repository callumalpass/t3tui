import { afterEach, describe, expect, test } from "bun:test";

import { withApproval, withQuestion } from "./fixtures.ts";
import { loadLayout } from "../../src/layout.ts";
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

  test("the list keeps its dragged width for the next run", async () => {
    const first = await open();
    const before = first.find("│").x;
    await first.mockMouse.drag(before, 10, before + 7, 10);
    await first.settle(100);
    first.destroy();
    const layout = await loadLayout();
    expect(layout.listWidth).toBe(before + 7);
    const next = await open({ layout });
    expect(next.find("│").x).toBe(before + 7);
  });
});
