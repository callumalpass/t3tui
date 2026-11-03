import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RGBA } from "@opentui/core";
import { ProjectReadFileError } from "@t3tools/contracts";

import { colors } from "../../src/ui/theme.ts";
import { withCompletedTurn, withWorking } from "./fixtures.ts";
import { fakeSession, renderApp, v2ShellSnapshot } from "./harness.tsx";

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
type App = Awaited<ReturnType<typeof renderApp>>;
const prefix = async (app: App, key: string) => {
  await app.press("\\", { ctrl: true });
  await app.press(key);
};
const waitFor = async (check: () => boolean) => {
  for (let tries = 0; tries < 60 && !check(); tries++) await app?.settle(25);
};
/** The foreground colour of the first cell showing `text`. */
const fgOf = (app: App, text: string) => {
  const { x, y } = app.find(text);
  const line = app.renderer.currentRenderBuffer.getSpanLines()[y] as unknown as { spans: { text: string; fg: RGBA }[] };
  let left = 0;
  for (const span of line.spans) {
    left += Bun.stringWidth(span.text);
    if (left > x) return span.fg.toString();
  }
  throw new Error(`nothing at ${x},${y}`);
};
const color = (hex: string) => RGBA.fromHex(hex).toString();

const FOLDERS: Record<string, readonly unknown[]> = {
  "": [
    { path: "README.md", kind: "file" },
    { path: "src", kind: "directory" },
    { path: ".git", kind: "directory" },
    { path: "dist", kind: "directory", ignored: true },
    { path: "notes.txt", kind: "file" },
    { path: "debug.log", kind: "file" },
  ],
  src: [
    { path: "src/b.ts", kind: "file" },
    { path: "src/a.ts", kind: "file" },
  ],
};
const vcs = {
  status: "live",
  local: { isRepo: true, hasPrimaryRemote: true, isDefaultRef: true, refName: "main", hasWorkingTreeChanges: true, workingTree: { files: [{ path: "src/a.ts", insertions: 3, deletions: 1 }, { path: "notes.txt", insertions: 0, deletions: 0 }], insertions: 3, deletions: 1 } },
  remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null },
};
const serverConfig = { providers: [], settings: {}, environment: { capabilities: { ignoredFileListing: true } } };
/** A server with the folders above, and whatever else a test needs. */
const withFiles = (results: Record<string, unknown> = {}, more: Parameters<typeof fakeSession>[0] = {}) =>
  fakeSession({ vcs, serverConfig, results: { listEntries: (_cwd: string, path: string) => FOLDERS[path] ?? [], listIgnoredFiles: [{ path: "debug.log", byteLength: 10 }], ...results }, ...more });
const listed = (app: App) => app.calls("listEntries").map((call) => call.args[1]);
const filesKeys = "j/k move · l open · / search · m mention · y copy path · p preview · r refresh · esc back · ctrl+\\ panes";

/** A workspace on this machine holding README.md and src/a.ts, as the project's folder. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "t3tui-files-"));
  writeFileSync(join(root, "README.md"), "# Hello\n\nSome *words*.\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "logo.bin"), new Uint8Array(3 * 1024));
  return { root, snapshot: { ...v2ShellSnapshot, projects: [{ ...v2ShellSnapshot.projects[0]!, workspaceRoot: root }] } };
}

describe("the Files tab", () => {
  test("is a tab after Details that lists the workspace's root only once it shows", async () => {
    const app = await open({ width: 200, session: withFiles() });
    expect(app.frame()).toContain("Details  Files");
    expect(app.calls("listEntries")).toHaveLength(0);
    await app.press("F");
    expect(listed(app)).toEqual([""]);
    expect(app.hints()).toBe(filesKeys);
    const frame = app.frame();
    // Folders first, then files by name; .git is hidden.
    const order = ["▸ dist", "▸ src", "debug.log", "notes.txt", "README.md"].map((name) => frame.indexOf(name));
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(frame).not.toContain(".git");
    expect(frame).toContain("/workspace/project");
  });

  test("marks changes as the Changes list does, a folder with changes inside, and what git ignores", async () => {
    const app = await open({ width: 200, session: withFiles() });
    await app.press("F");
    const line = (name: string) => app.frame().split("\n").find((text) => text.includes(name)) ?? "";
    expect(line("notes.txt").trimEnd()).toEndWith("?");
    expect(line("▸ src").trimEnd()).toEndWith("•");
    expect(line("README.md").trimEnd()).toEndWith("README.md");
    expect(fgOf(app, "dist")).toBe(color(colors.faint));
    expect(fgOf(app, "debug.log")).toBe(color(colors.faint));
    expect(fgOf(app, "README.md")).toBe(color(colors.text));
    await app.press("j");
    await app.press("l");
    expect(line("a.ts").trimEnd()).toEndWith("M");
  });

  test("opens folders as they're listed, with … meanwhile, and h closes them or goes up", async () => {
    let release = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    const app = await open({ width: 200, session: withFiles({ listEntries: async (_cwd: string, path: string) => (path === "src" ? slow.then(() => FOLDERS.src) : FOLDERS[path]) }) });
    await app.press("F");
    await app.press("j");
    await app.press("l");
    const lines = app.frame().split("\n");
    expect(lines[lines.findIndex((text) => text.includes("▾ src")) + 1]?.trimEnd()).toEndWith("…");
    release();
    await waitFor(() => app.frame().includes("a.ts"));
    expect(app.frame().indexOf("a.ts")).toBeLessThan(app.frame().indexOf("b.ts"));
    await app.press("l");
    await app.press("h");
    await app.press("h");
    expect(app.frame()).toContain("▸ src");
    expect(app.frame()).not.toContain("a.ts");
    // Open again, it doesn't list again.
    await app.press("l");
    expect(listed(app)).toEqual(["", "src"]);
  });

  test("keeps each workspace's tree for the run", async () => {
    const app = await open({ width: 200, session: withFiles() });
    await app.press("F");
    await app.press("j");
    await app.press("l");
    await app.press("escape");
    await app.press("d");
    await app.press("d");
    await prefix(app, "2");
    expect(app.frame()).toContain("▾ src");
    expect(app.frame()).toContain("a.ts");
  });

  test("ctrl+\\ l and 1-9 reach it like any other tab", async () => {
    const app = await open({ width: 200, session: withFiles() });
    await prefix(app, "l");
    expect(app.hints()).toBe(filesKeys);
    await prefix(app, "1");
    expect(app.frame()).toContain("Changes");
    await prefix(app, "l");
    await prefix(app, "1");
    await app.press("l");
    await prefix(app, "2");
    expect(app.hints()).toBe(filesKeys);
    await prefix(app, "x");
    expect(app.hints()).toBe("Files stays; d hides the column.");
  });

  test("a click selects, a click on a folder opens it, and one on the selected file opens it", async () => {
    const { snapshot } = workspace();
    process.env.EDITOR = "sleep 3; :";
    delete process.env.VISUAL;
    const app = await open({ width: 200, session: withFiles({}, { snapshot }) });
    await app.press("F");
    const folder = app.find("▸ src");
    await app.click(folder.x, folder.y);
    expect(app.frame()).toContain("a.ts");
    const readme = app.find("README.md");
    await app.click(readme.x, readme.y);
    expect(app.frame()).not.toContain("README.md ✕");
    await app.click(readme.x, readme.y);
    expect(app.frame()).toContain("README.md ✕");
  });

  test("r and a turn finishing list the open folders again", async () => {
    const fake = withFiles({}, { projection: withWorking() });
    const app = await open({ width: 200, session: fake });
    await app.press("F");
    await app.press("j");
    await app.press("l");
    await app.press("r");
    expect(listed(app)).toEqual(["", "src", "", "src"]);
    fake.updateThread(withCompletedTurn());
    await waitFor(() => listed(app).length === 6);
    expect(listed(app)).toEqual(["", "src", "", "src", "", "src"]);
  });
});

describe("searching files", () => {
  test("/ searches the workspace, and esc goes back to the tree where it was", async () => {
    const results = [{ path: "src/deep/thing.ts", kind: "file" }, { path: "src/deep", kind: "directory" }];
    const app = await open({ width: 200, session: withFiles({ searchEntries: results }) });
    await app.press("F");
    await app.press("j");
    await app.press("/");
    await app.type("thing");
    await waitFor(() => app.calls("searchEntries").length > 0);
    expect(app.calls("searchEntries")[0]?.args).toEqual(["/workspace/project", "thing", 200]);
    await waitFor(() => app.frame().includes("src/deep/thing.ts"));
    expect(app.frame()).toContain("src/deep/");
    expect(app.frame()).not.toContain("README.md");
    await app.press("escape");
    expect(app.frame()).toContain("README.md");
    expect(app.frame()).not.toContain("thing.ts");
    // Still on src.
    await app.press("l");
    expect(app.frame()).toContain("▾ src");
  });

  test("enter on a folder found shows it in the tree, open", async () => {
    const app = await open({ width: 200, session: withFiles({ searchEntries: [{ path: "src", kind: "directory" }] }) });
    await app.press("F");
    await app.press("/");
    await app.type("sr");
    await waitFor(() => app.frame().includes("src/"));
    await app.press("return");
    expect(app.frame()).toContain("▾ src");
    expect(app.frame()).toContain("a.ts");
  });

  test("tab goes to the results, where m mentions one", async () => {
    const app = await open({ width: 200, session: withFiles({ searchEntries: [{ path: "src/a.ts", kind: "file" }] }) });
    await app.press("F");
    await app.press("/");
    await app.type("a.ts");
    await waitFor(() => app.frame().includes("src/a.ts"));
    await app.press("tab");
    await app.press("m");
    expect(app.hints()).toBe("Added @src/a.ts");
    expect(app.frame()).toContain("@src/a.ts");
  });
});

describe("acting on a file", () => {
  test("m mentions the selected file or folder as a chip, as the @ menu does, and keeps the keys", async () => {
    const app = await open({ width: 200, session: withFiles() });
    await app.press("F");
    await app.press("j");
    await app.press("m");
    expect(app.hints()).toBe("Added @src/");
    await app.press("j");
    await app.press("m");
    expect(app.frame()).toContain("@src/ @debug.log");
    // Sent as the @ menu sends them.
    await prefix(app, "k");
    await app.press("i");
    await app.press("return");
    expect(app.calls("sendMessage")[0]?.args[1]).toBe("[src](src) [debug.log](debug.log)");
  });

  test("y copies the path", async () => {
    const app = await open({ width: 200, session: withFiles() });
    await app.press("F");
    await app.press("G");
    await app.press("y");
    expect(app.calls("copy")[0]?.args).toEqual(["README.md"]);
    expect(app.hints()).toBe("Copied README.md");
  });

  test("a file on this machine opens in $EDITOR in the column", async () => {
    const { snapshot } = workspace();
    process.env.EDITOR = "sleep 3; :";
    delete process.env.VISUAL;
    const app = await open({ width: 200, session: withFiles({}, { snapshot }) });
    await app.press("F");
    await app.press("G");
    await app.press("return");
    expect(app.frame()).toContain("Details  Files  README.md ✕");
    expect(app.hints()).toStartWith("keys: README.md");
  });

  test("elsewhere, a file opens read-only in a preview tab, which ctrl+\\ x closes back to Files", async () => {
    const app = await open({ width: 200, session: withFiles({ readFile: { relativePath: "src/a.ts", contents: "export const answer = 42;\n", byteLength: 26, truncated: false } }) });
    await app.press("F");
    await app.press("j");
    await app.press("l");
    await app.press("j");
    await app.press("l");
    expect(app.calls("readFile")[0]?.args).toEqual(["/workspace/project", "src/a.ts"]);
    await waitFor(() => app.frame().includes("answer"));
    expect(app.frame()).toContain("Details  Files  src/a.ts ✕");
    expect(app.frame()).toContain("read-only");
    expect(app.hints()).toStartWith("j/k scroll");
    await prefix(app, "x");
    expect(app.frame()).not.toContain("src/a.ts ✕");
    expect(app.hints()).toBe(filesKeys);
  });

  test("p previews a file on this machine too: markdown rendered", async () => {
    const { root, snapshot } = workspace();
    const app = await open({ width: 200, session: withFiles({ readFile: { relativePath: "README.md", contents: "# Hello\n\nSome *words*.\n", byteLength: 22, truncated: false } }, { snapshot }) });
    await app.press("F");
    await app.press("G");
    await app.press("p");
    expect(app.calls("readFile")[0]?.args).toEqual([root, "README.md"]);
    await waitFor(() => app.frame().includes("Some words."));
    expect(app.frame()).not.toContain("# Hello");
  });

  test("a binary file is named with its size", async () => {
    const { snapshot } = workspace();
    const binary = new ProjectReadFileError({ cwd: "/x", relativePath: "logo.bin", failure: "binary_file" });
    const app = await open({ width: 200, session: withFiles({ listEntries: () => [{ path: "logo.bin", kind: "file" }], readFile: () => Promise.reject(binary) }, { snapshot }) });
    await app.press("F");
    await app.press("p");
    await waitFor(() => app.frame().includes("Binary file"));
    expect(app.frame()).toContain("Binary file, 3 KB");
  });

  test("Files: show is in the palette, under F", async () => {
    const app = await open({ session: withFiles() });
    await app.press("k", { ctrl: true });
    await app.type("files show");
    expect(app.frame()).toMatch(/Files: show\s+F/);
    await app.press("return");
    expect(app.hints()).toBe(filesKeys);
    expect(app.frame()).toContain("Details  Files");
  });
});
