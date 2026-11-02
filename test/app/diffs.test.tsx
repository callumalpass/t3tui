import { afterEach, describe, expect, test } from "bun:test";

import { withCompletedTurn } from "./fixtures.ts";
import { fakeSession, renderApp } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

const patch = "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,2 +1,2 @@\n const kept = 1;\n-const before = 2;\n+const after = 3;\n";
const withDiff = () => fakeSession({ projection: withCompletedTurn(), results: { turnDiff: { diff: patch } } });
/** The removed and added lines share a row side by side, and stack when unified. */
const sideBySide = (frame: string) => frame.split("\n").some((line) => line.includes("before") && line.includes("after"));

describe("diffs", () => {
  test("a wide conversation shows them side by side", async () => {
    const app = await open({ width: 260, session: withDiff() });
    await app.press("D");
    await app.settle(50);
    expect(app.frame()).toContain("const before = 2;");
    expect(sideBySide(app.frame())).toBe(true);
  });

  test("a narrower one shows them unified", async () => {
    const app = await open({ width: 140, session: withDiff() });
    await app.press("D");
    await app.settle(50);
    expect(app.frame()).toContain("const after = 3;");
    expect(sideBySide(app.frame())).toBe(false);
  });

  test("Toggle split diff overrides the width for the session", async () => {
    const app = await open({ width: 140, session: withDiff() });
    await app.press("k", { ctrl: true });
    await app.type("split diff");
    await app.press("return");
    await app.press("D");
    await app.settle(50);
    expect(sideBySide(app.frame())).toBe(true);
    await app.press("k", { ctrl: true });
    await app.type("split diff");
    await app.press("return");
    await app.settle(50);
    expect(sideBySide(app.frame())).toBe(false);
  });
});
