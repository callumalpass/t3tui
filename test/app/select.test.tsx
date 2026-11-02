import { afterEach, describe, expect, test } from "bun:test";

import { withCompletedTurn } from "./fixtures.ts";
import { fakeSession, renderApp, v2ThreadId } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

describe("select and copy", () => {
  test("dragging across the conversation copies what it covers on release", async () => {
    const app = await open({ session: fakeSession({ projection: withCompletedTurn() }) });
    const reply = app.find("Done — the thing");
    await app.mockMouse.drag(reply.x, reply.y, reply.x + 8, reply.y);
    await app.settle();
    expect(app.calls("copy").map((call) => call.args[0])).toEqual(["Done — th"]);
    expect(app.hints()).toBe("Copied");
  });

  test("a single click copies nothing and still selects the turn", async () => {
    const app = await open({ session: fakeSession({ projection: withCompletedTurn() }) });
    const prompt = app.find("Do the thing");
    await app.click(prompt.x, prompt.y);
    expect(app.calls("copy")).toHaveLength(0);
    expect(app.hints()).not.toBe("Copied");
  });

  test("the terminal pane's text can be selected and copied too", async () => {
    const terminal = { threadId: v2ThreadId, terminalId: "term-1", cwd: "/workspace/project", worktreePath: null, status: "running", pid: 42, exitCode: null, exitSignal: null, hasRunningSubprocess: false, label: "", updatedAt: "2026-06-20T00:00:00.000Z" };
    const snapshot = { type: "snapshot", threadId: v2ThreadId, terminalId: "term-1", createdAt: "2026-06-20T00:00:00.000Z", snapshot: { history: "build finished in 3s\r\n$ " } };
    const app = await open({ width: 200, session: fakeSession({ terminals: [terminal], terminalEvents: [snapshot] }) });
    await app.press("j", { ctrl: true });
    const line = app.find("build finished");
    await app.mockMouse.drag(line.x, line.y, line.x + 13, line.y);
    await app.settle();
    expect(app.calls("copy").map((call) => call.args[0])).toEqual(["build finished"]);
    // Dragging isn't typing: nothing went to the shell.
    expect(app.calls("writeTerminal")).toHaveLength(0);
  });
});
