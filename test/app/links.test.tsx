import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { v2ShellSnapshot } from "../../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { withReply } from "./fixtures.ts";
import { fakeSession, renderApp } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
const saved = { path: process.env.PATH, visual: process.env.VISUAL, editor: process.env.EDITOR };
afterEach(() => {
  app?.destroy();
  app = null;
  process.env.PATH = saved.path;
  for (const [key, value] of [["VISUAL", saved.visual], ["EDITOR", saved.editor]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** A workspace on this machine holding src/a.ts, as the thread's worktree. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "t3tui-links-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  const snapshot = { ...v2ShellSnapshot, threads: v2ShellSnapshot.threads.map((thread) => ({ ...thread, worktreePath: root })) };
  return { root, snapshot };
}

/** xdg-open and open, replaced by a script that writes down what it was asked to open. */
function fakeOpener() {
  const bin = mkdtempSync(join(tmpdir(), "t3tui-opener-"));
  const log = join(bin, "opened");
  for (const name of ["xdg-open", "open"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\n`);
    chmodSync(join(bin, name), 0o755);
  }
  process.env.PATH = `${bin}:${process.env.PATH}`;
  return () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n");
    } catch {
      return [];
    }
  };
}

const waitFor = async (check: () => boolean) => {
  for (let tries = 0; tries < 40 && !check(); tries++) await app?.settle(25);
};

describe("links and paths in replies", () => {
  test("a click on a link opens it in the browser, whether written as a link or bare", async () => {
    const opened = fakeOpener();
    const app = await open({ session: fakeSession({ projection: withReply("See [the docs](https://example.com/docs) or https://bare.example.org/x now.", false) }) });
    const label = app.find("the docs");
    await app.click(label.x + 2, label.y);
    const bare = app.find("bare.example");
    await app.click(bare.x, bare.y);
    await waitFor(() => opened().length === 2);
    expect(opened()).toEqual(["https://example.com/docs", "https://bare.example.org/x"]);
  });

  test("a click on a workspace file's path opens it in the column's editor, named from the workspace", async () => {
    delete process.env.VISUAL;
    process.env.EDITOR = "sleep 3; :";
    const { snapshot } = workspace();
    const app = await open({ width: 200, session: fakeSession({ snapshot, projection: withReply("I changed `src/a.ts:3` and left src/missing.ts alone.", false) }) });
    const missing = app.find("missing.ts");
    await app.click(missing.x, missing.y);
    expect(app.frame()).not.toContain("Editing");
    const path = app.find("a.ts:3");
    await app.click(path.x, path.y);
    expect(app.frame()).toContain("Details  Editor");
    expect(app.frame()).toContain("Editing src/a.ts ");
  });

  test("a drag over a link selects it rather than opening it", async () => {
    const opened = fakeOpener();
    const app = await open({ session: fakeSession({ projection: withReply("Go to https://example.com/page please.", false) }) });
    const link = app.find("https://example.com/page");
    await app.mockMouse.drag(link.x, link.y, link.x + 10, link.y);
    await app.settle(100);
    expect(opened()).toEqual([]);
    expect(app.calls("copy")).toHaveLength(1);
  });
});
