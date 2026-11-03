/**
 * Renders the whole app against invented demo data (the interaction-test
 * harness's fake session) and writes the settled frame as an HTML fragment
 * for the landing page: dark, dark in a standalone page, and light; and the
 * same with the terminal drawer open, in both themes. Then the panes, one
 * page each (demo-pane-*.html): the drawer with and without the keys, the
 * ctrl+\ prefix waiting, zoom, the strip of running programs, side
 * placement's one strip, two files in one Neovim, and the palette.
 *
 * Run with `bun run scripts/demo-capture.tsx`.
 */
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type CapturedFrame, type RGBA, TextAttributes } from "@opentui/core";
import type { OrchestrationV2ShellSnapshot, OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { DEFAULT_LAYOUT, type Layout } from "../src/layout.ts";
import { applyTheme, colors } from "../src/ui/theme.ts";
import { fakeSession, renderApp } from "../test/app/harness.tsx";
import { v2Project, v2Projection, v2ThreadShell } from "../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";

/** Where the HTML goes: DEMO_OUT, or dist/demo. */
const OUT_DIR = process.env.DEMO_OUT ?? join(import.meta.dir, "../dist/demo");

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A DateTime `ms` before the capture, so every relative time reads naturally. */
const ago = (ms: number) => DateTime.makeUnsafe(NOW - ms);

// --- The demo shell: 3 projects, 8 threads ---------------------------------

const project = (id: string, title: string, workspaceRoot: string) => ({ ...v2Project, id, title, workspaceRoot });

const OPEN_THREAD = "thread-bundle";
const APPROVAL_ID = "approval-1";

const thread = (extra: Record<string, unknown>) => ({
  ...v2ThreadShell,
  status: "completed",
  activeRunId: null,
  latestRunId: "run-1",
  latestRunRequestedAt: ago(3 * HOUR),
  latestRunStartedAt: ago(3 * HOUR),
  latestRunCompletedAt: ago(3 * HOUR),
  pendingRuntimeRequest: null,
  pinnedAt: null,
  lastVisitedAt: ago(2 * HOUR),
  ...extra,
});

const snapshot = {
  schemaVersion: 1,
  snapshotSequence: 0,
  projects: [
    project("project-t3tui", "t3tui", "/home/dev/projects/t3tui"),
    project("project-acme", "acme-api", "/home/dev/projects/acme-api"),
    project("project-dotfiles", "dotfiles", "/home/dev/dotfiles"),
  ],
  threads: [
    // The open thread: pinned, running, and waiting on a command approval.
    thread({
      id: OPEN_THREAD,
      projectId: "project-t3tui",
      title: "Bundle into dist/",
      runtimeMode: "approval-required",
      status: "running",
      latestRunId: "run-2",
      activeRunId: "run-2",
      latestRunRequestedAt: ago(3 * MIN),
      latestRunStartedAt: ago(3 * MIN),
      latestRunCompletedAt: null,
      activityRunStartedAt: ago(3 * MIN),
      pendingRuntimeRequest: { id: APPROVAL_ID, kind: "command", createdAt: ago(40_000) },
      latestUserMessageAt: ago(3 * MIN),
      pinnedAt: ago(2 * DAY),
      pinOrderKey: "a",
      createdAt: ago(2 * DAY),
      updatedAt: ago(40_000),
    }),
    // Working, six minutes in.
    thread({
      id: "thread-flaky",
      projectId: "project-acme",
      title: "Fix flaky auth test",
      modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
      status: "running",
      latestRunId: "run-flaky",
      activeRunId: "run-flaky",
      latestRunRequestedAt: ago(6 * MIN),
      latestRunStartedAt: ago(6 * MIN),
      latestRunCompletedAt: null,
      activityRunStartedAt: ago(6 * MIN),
      latestUserMessageAt: ago(6 * MIN),
      createdAt: ago(5 * HOUR),
      updatedAt: ago(20_000),
    }),
    // Waiting for an answer.
    thread({
      id: "thread-resize",
      projectId: "project-t3tui",
      title: "Resize the thread list",
      status: "running",
      latestRunId: "run-resize",
      activeRunId: "run-resize",
      latestRunRequestedAt: ago(12 * MIN),
      latestRunStartedAt: ago(12 * MIN),
      latestRunCompletedAt: null,
      pendingRuntimeRequest: { id: "question-1", kind: "user_input", createdAt: ago(9 * MIN) },
      latestUserMessageAt: ago(12 * MIN),
      createdAt: ago(DAY),
      updatedAt: ago(9 * MIN),
    }),
    // Finished while you were looking elsewhere.
    thread({
      id: "thread-rate-limit",
      projectId: "project-acme",
      title: "Add rate-limit headers",
      latestRunRequestedAt: ago(40 * MIN),
      latestRunStartedAt: ago(40 * MIN),
      latestRunCompletedAt: ago(18 * MIN),
      latestUserMessageAt: ago(40 * MIN),
      lastVisitedAt: ago(2 * HOUR),
      createdAt: ago(DAY),
      updatedAt: ago(18 * MIN),
    }),
    thread({
      id: "thread-sighup",
      projectId: "project-dotfiles",
      title: "Exit on SIGHUP",
      latestRunRequestedAt: ago(HOUR),
      latestRunStartedAt: ago(HOUR),
      latestRunCompletedAt: ago(47 * MIN),
      latestUserMessageAt: ago(HOUR),
      lastVisitedAt: ago(3 * HOUR),
      createdAt: ago(2 * DAY),
      updatedAt: ago(47 * MIN),
    }),
    // Idle and read.
    thread({
      id: "thread-tmux",
      projectId: "project-t3tui",
      title: "Add tmux mirror",
      latestRunRequestedAt: ago(3 * HOUR + 10 * MIN),
      latestRunStartedAt: ago(3 * HOUR + 10 * MIN),
      latestRunCompletedAt: ago(3 * HOUR),
      latestUserMessageAt: ago(3 * HOUR + 10 * MIN),
      lastVisitedAt: ago(2 * HOUR + 50 * MIN),
      createdAt: ago(3 * DAY),
      updatedAt: ago(3 * HOUR),
    }),
    thread({
      id: "thread-aliases",
      projectId: "project-dotfiles",
      title: "Tidy shell aliases",
      latestRunRequestedAt: ago(3 * DAY),
      latestRunStartedAt: ago(3 * DAY),
      latestRunCompletedAt: ago(3 * DAY),
      latestUserMessageAt: ago(3 * DAY),
      lastVisitedAt: ago(3 * DAY - HOUR),
      createdAt: ago(6 * DAY),
      updatedAt: ago(3 * DAY),
    }),
    // Put away: the Settled section folds to a count at the bottom of the list.
    thread({
      id: "thread-deps",
      projectId: "project-acme",
      title: "Bump dependencies",
      settledOverride: "settled",
      settledAt: ago(DAY),
      latestRunRequestedAt: ago(2 * DAY),
      latestRunStartedAt: ago(2 * DAY),
      latestRunCompletedAt: ago(2 * DAY),
      latestUserMessageAt: ago(2 * DAY),
      lastVisitedAt: ago(DAY),
      createdAt: ago(4 * DAY),
      updatedAt: ago(DAY),
    }),
  ],
  archivedThreads: [],
} as unknown as OrchestrationV2ShellSnapshot;

// --- The open thread's conversation -----------------------------------------

const USER_1 = "Bundle the CLI into dist/ so it can run without the repo checkout. Keep the vendor link step on postinstall.";
const ASSISTANT_1 = [
  "Done — the bundle step is **self-contained** now:",
  "",
  "- `scripts/build.ts` bundles `src/bin.ts` into `dist/`",
  "- the vendor symlink is created on `postinstall`",
  "- `bun run build` passes typecheck and the test suite",
  "",
  "Say the word and I'll cut a clean rebuild.",
].join("\n");
const USER_2 = "Now rebuild dist/ from scratch and check the bundled binary starts.";

const run = (id: string, ordinal: number, userMessageId: string, status: string, requestedMsAgo: number, completedMsAgo: number | null) => ({
  id,
  threadId: OPEN_THREAD,
  ordinal,
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  providerThreadId: null,
  userMessageId,
  rootNodeId: null,
  activeAttemptId: null,
  status,
  requestedAt: ago(requestedMsAgo),
  startedAt: ago(requestedMsAgo),
  completedAt: completedMsAgo === null ? null : ago(completedMsAgo),
  checkpointId: null,
  contextHandoffId: null,
});

let ordinal = 0;
const item = (runId: string, startMsAgo: number, work: Record<string, unknown>, status = "completed", spanMs = 5_000) => ({
  id: `item-${ordinal}`,
  threadId: OPEN_THREAD,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: ordinal++,
  status,
  title: null,
  startedAt: ago(startMsAgo),
  completedAt: status === "completed" ? ago(startMsAgo - spanMs) : null,
  updatedAt: status === "completed" ? ago(startMsAgo - spanMs) : ago(startMsAgo),
  ...work,
});

const turnItems = [
  item("run-1", 26 * MIN, { type: "user_message", createdBy: "user", creationSource: "web", messageId: "msg-user-1", inputIntent: "turn_start", text: USER_1, attachments: [] }, "completed", 0),
  item("run-1", 25 * MIN + 50_000, { type: "reasoning", text: "The build needs to inline the vendored packages and keep the symlink step for local development.", streaming: false }),
  item("run-1", 25 * MIN + 20_000, { type: "file_search", pattern: "Bun.build", results: [{ fileName: "scripts/build.ts" }, { fileName: "package.json" }] }),
  item("run-1", 24 * MIN + 40_000, { type: "file_change", fileName: "scripts/build.ts", additions: 42, deletions: 6 }),
  item("run-1", 24 * MIN, { type: "command_execution", input: "bun run typecheck", output: "tsc --noEmit\n(no errors)", exitCode: 0 }, "completed", 20_000),
  item("run-1", 23 * MIN + 20_000, { type: "command_execution", input: "bun test", output: "128 pass\n0 fail\n412 expect() calls", exitCode: 0 }, "completed", 30_000),
  // 3m 12s after the first user message: the turn folds to "Worked for 3m 12s".
  item("run-1", 22 * MIN + 48_000, { type: "assistant_message", messageId: "msg-assistant-1", text: ASSISTANT_1, streaming: false }, "completed", 0),
  item("run-2", 3 * MIN, { type: "user_message", createdBy: "user", creationSource: "web", messageId: "msg-user-2", inputIntent: "turn_start", text: USER_2, attachments: [] }, "completed", 0),
  item("run-2", 2 * MIN + 50_000, { type: "reasoning", text: "A clean rebuild means removing dist/ first, then re-running the bundle and smoke-testing the binary.", streaming: false }),
  item("run-2", 2 * MIN + 30_000, { type: "command_execution", input: "git status --porcelain", output: " M scripts/build.ts\n M package.json", exitCode: 0 }, "completed", 3_000),
  item("run-2", 40_000, { type: "approval_request", requestId: APPROVAL_ID, requestKind: "command", prompt: "rm -rf dist && bun run scripts/build.ts", reason: "Deletes dist/ and rebuilds it from a clean tree." }, "waiting", 0),
];

const message = (id: string, runId: string, role: string, text: string, atMsAgo: number) => ({
  createdBy: "user",
  creationSource: "web",
  id,
  threadId: OPEN_THREAD,
  runId,
  nodeId: null,
  role,
  text,
  attachments: [],
  streaming: false,
  createdAt: ago(atMsAgo),
  updatedAt: ago(atMsAgo),
});

const projection = {
  ...v2Projection,
  thread: {
    ...v2Projection.thread,
    id: OPEN_THREAD,
    projectId: "project-t3tui",
    title: "Bundle into dist/",
    runtimeMode: "approval-required",
    createdAt: ago(2 * DAY),
    updatedAt: ago(40_000),
  },
  runs: [run("run-1", 1, "msg-user-1", "completed", 26 * MIN, 22 * MIN + 48_000), run("run-2", 2, "msg-user-2", "running", 3 * MIN, null)],
  runtimeRequests: [
    { id: APPROVAL_ID, nodeId: "node-1", providerTurnId: null, nativeRequestRef: null, kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: "session-1" }, createdAt: ago(40_000), resolvedAt: null },
  ],
  messages: [
    message("msg-user-1", "run-1", "user", USER_1, 26 * MIN),
    message("msg-assistant-1", "run-1", "assistant", ASSISTANT_1, 22 * MIN + 48_000),
    message("msg-user-2", "run-2", "user", USER_2, 3 * MIN),
  ],
  turnItems,
  visibleTurnItems: turnItems.map((entry, position) => ({ position, visibility: "local", sourceThreadId: OPEN_THREAD, sourceItemId: entry.id, item: entry })),
  updatedAt: ago(40_000),
} as unknown as OrchestrationV2ThreadProjection;

// --- Captured frame -> HTML ---------------------------------------------------

function hex(color: RGBA): string {
  const [r, g, b] = color.toInts();
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

interface StyledSpan {
  readonly text: string;
  readonly style: string;
}

/** One frame as a `<pre class="tui">`, one line per row, styled spans merged. */
function frameToHtml(frame: CapturedFrame, baseBg: string): string {
  const lines = frame.lines.map((line) => {
    const styled: StyledSpan[] = [];
    for (const span of line.spans) {
      if (!span.text) continue;
      const attrs = span.attributes & 0xff;
      const inverse = (attrs & TextAttributes.INVERSE) !== 0;
      const fg = hex(inverse ? span.bg : span.fg);
      const bg = hex(inverse ? span.fg : span.bg);
      const declarations = [`color:${fg}`];
      if (bg !== baseBg) declarations.push(`background:${bg}`);
      if ((attrs & TextAttributes.BOLD) !== 0) declarations.push("font-weight:bold");
      if ((attrs & TextAttributes.ITALIC) !== 0) declarations.push("font-style:italic");
      const decorations = [
        (attrs & TextAttributes.UNDERLINE) !== 0 ? "underline" : "",
        (attrs & TextAttributes.STRIKETHROUGH) !== 0 ? "line-through" : "",
      ].filter(Boolean);
      if (decorations.length > 0) declarations.push(`text-decoration:${decorations.join(" ")}`);
      if ((attrs & TextAttributes.DIM) !== 0) declarations.push("opacity:.65");
      const style = declarations.join(";");
      const last = styled.at(-1);
      if (last && last.style === style) styled[styled.length - 1] = { text: last.text + span.text, style };
      else styled.push({ text: span.text, style });
    }
    // Trailing blank spans in the base colour add nothing over the pre's background.
    while (styled.length > 0) {
      const last = styled.at(-1)!;
      if (last.text.trim() !== "" || last.style.includes("background:")) break;
      styled.pop();
    }
    return styled.map((span) => `<span style="${span.style}">${escapeHtml(span.text)}</span>`).join("");
  });
  return `<pre class="tui" style="background:${baseBg}">${lines.join("\n")}\n</pre>\n`;
}

function standalonePage(fragment: string, pageBg: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>t3tui — demo screen</title>
<style>
  body { margin: 0; padding: 24px; background: ${pageBg}; }
  .tui { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.3; margin: 0; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  /* Terminal cells paint their whole height; inline spans don't, so stretch
     each span's background into the line gap. Paint-only: layout is unchanged. */
  .tui span { padding: 0.15em 0; }
</style>
</head>
<body>
${fragment}</body>
</html>
`;
}

// --- Render both themes ---------------------------------------------------------

/** The open thread's two terminals, the first with a build's output. */
const terminals = ["term-1", "term-2"].map((terminalId) => ({ threadId: OPEN_THREAD, terminalId, cwd: "/home/demo/t3tui", worktreePath: null, status: "running", pid: 42, exitCode: null, exitSignal: null, hasRunningSubprocess: false, label: "", updatedAt: new Date(NOW).toISOString() }));
const terminalHistory = "~/t3tui main$ bun run scripts/build.ts\r\n\x1b[32m✓\x1b[0m bundled src/bin.ts → dist/bin.js (1.8 MB)\r\n\x1b[32m✓\x1b[0m wrote dist/vendor\r\n~/t3tui main$ ";

async function capture(mode: "dark" | "light", drawer = false): Promise<{ frame: CapturedFrame; chars: string; baseBg: string }> {
  applyTheme(mode);
  const terminalEvents = [{ type: "snapshot", threadId: OPEN_THREAD, terminalId: "term-1", createdAt: new Date(NOW).toISOString(), snapshot: { history: terminalHistory } }];
  const app = await renderApp({
    session: fakeSession({ snapshot, projection, ...(drawer ? { terminals, terminalEvents } : {}) }),
    width: 140,
    height: drawer ? 44 : 34,
  });
  try {
    if (drawer) await app.press("j", { ctrl: true });
    // A running run ticks a spinner and a duration, so settle() gives up after
    // its retries; one more short wait lands on whatever frame is current.
    await app.settle(120);
    await app.renderOnce();
    return { frame: app.captureSpans(), chars: app.frame(), baseBg: colors.bg };
  } finally {
    app.destroy();
  }
}

await mkdir(OUT_DIR, { recursive: true });

const dark = await capture("dark");
console.log(dark.chars);
const darkFragment = frameToHtml(dark.frame, dark.baseBg);
await writeFile(join(OUT_DIR, "demo-screen.html"), darkFragment);
await writeFile(join(OUT_DIR, "demo-screen-page.html"), standalonePage(darkFragment, "#161616"));

const light = await capture("light");
const lightFragment = frameToHtml(light.frame, light.baseBg);
await writeFile(join(OUT_DIR, "demo-screen-light.html"), lightFragment);
await writeFile(join(OUT_DIR, "demo-screen-light-page.html"), standalonePage(lightFragment, "#e8e8e8"));

console.log(`wrote ${join(OUT_DIR, "demo-screen.html")}`);
console.log(`wrote ${join(OUT_DIR, "demo-screen-page.html")}`);
console.log(`wrote ${join(OUT_DIR, "demo-screen-light.html")}`);

for (const mode of ["dark", "light"] as const) {
  const drawer = await capture(mode, true);
  if (mode === "dark") console.log(drawer.chars);
  const file = join(OUT_DIR, mode === "dark" ? "demo-drawer-page.html" : "demo-drawer-light-page.html");
  await writeFile(file, standalonePage(frameToHtml(drawer.frame, drawer.baseBg), mode === "dark" ? "#161616" : "#e8e8e8"));
  console.log(`wrote ${file}`);
}

// --- The panes -------------------------------------------------------------------

type DemoApp = Awaited<ReturnType<typeof renderApp>>;
/** ctrl+\, then a key. */
const prefix = async (app: DemoApp, key: string, modifiers?: Parameters<DemoApp["press"]>[1]) => {
  await app.press("\\", { ctrl: true });
  await app.press(key, modifiers);
};

/** The demo project's files, on this machine, for the editor to open: two changed files under Changes. */
const workspaceRoot = mkdtempSync(join(tmpdir(), "t3tui-demo-"));
const changed = { "scripts/build.ts": 'import { $ } from "bun";\n\nawait $`rm -rf dist`;\nawait Bun.build({ entrypoints: ["src/bin.ts"], outdir: "dist", target: "bun" });\n', "package.json": '{\n  "name": "t3tui",\n  "scripts": { "build": "bun run scripts/build.ts" }\n}\n' };
for (const [path, text] of Object.entries(changed)) await Bun.write(join(workspaceRoot, path), text);
const localSnapshot = { ...snapshot, projects: snapshot.projects.map((entry) => (entry.id === "project-t3tui" ? { ...entry, workspaceRoot } : entry)) } as OrchestrationV2ShellSnapshot;
const vcs = {
  status: "live",
  local: { isRepo: true, hasPrimaryRemote: true, isDefaultRef: true, refName: "main", hasWorkingTreeChanges: true, workingTree: { files: Object.keys(changed).map((path) => ({ path, insertions: 4, deletions: 1 })), insertions: 8, deletions: 2 } },
  remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null },
};
// Neovim without the user's own setup, so every capture looks the same.
process.env.VISUAL = "nvim --clean -n";

/** o on each changed file under Changes, from the details panel. */
const editBoth = async (app: DemoApp) => {
  await app.press("l");
  for (let tries = 0; tries < 12 && !app.hints().includes("o edit file"); tries++) await app.press("j");
  await app.press("o");
  await app.settle(600);
  await prefix(app, "k");
  await app.press("l");
  for (let tries = 0; tries < 12 && !app.hints().includes("o edit file"); tries++) await app.press("j");
  await app.press("j");
  await app.press("o");
  await app.settle(600);
};

const scenes: readonly { readonly name: string; readonly layout?: Layout; readonly steps: (app: DemoApp) => Promise<void> }[] = [
  { name: "drawer-focused", steps: (app) => app.press("j", { ctrl: true }) },
  { name: "drawer-unfocused", steps: async (app) => {
    await app.press("j", { ctrl: true });
    await prefix(app, "k");
  } },
  { name: "prefix", steps: async (app) => {
    await app.press("j", { ctrl: true });
    await app.press("\\", { ctrl: true });
  } },
  { name: "zoom", steps: async (app) => {
    await app.press("j", { ctrl: true });
    await prefix(app, "z");
  } },
  { name: "running", steps: async (app) => {
    await app.press("j", { ctrl: true });
    await prefix(app, "2");
    await app.press("j", { ctrl: true });
    await editBoth(app);
    await prefix(app, "k");
    await app.press("d");
    await app.settle(400);
  } },
  { name: "side", layout: { ...DEFAULT_LAYOUT, detailsWidth: 60, terminalPlacement: "side" }, steps: async (app) => {
    await app.press("j", { ctrl: true });
  } },
  { name: "nvim", steps: async (app) => {
    await editBoth(app);
    // Neovim lists both files: one instance has them.
    await app.type(":ls");
    await app.press("return");
    await app.settle(300);
  } },
  { name: "palette", steps: async (app) => {
    await app.press("j", { ctrl: true });
    await prefix(app, "k");
    await app.press("k", { ctrl: true });
    await app.type("terminal");
  } },
];

applyTheme("dark");
for (const scene of scenes) {
  const terminalEvents = [{ type: "snapshot", threadId: OPEN_THREAD, terminalId: "term-1", createdAt: new Date(NOW).toISOString(), snapshot: { history: terminalHistory } }];
  const app = await renderApp({ session: fakeSession({ snapshot: localSnapshot, projection, terminals, terminalEvents, vcs }), width: 190, height: 50, ...(scene.layout ? { layout: scene.layout } : {}) });
  try {
    await scene.steps(app);
    await app.settle(120);
    await app.renderOnce();
    const file = join(OUT_DIR, `demo-pane-${scene.name}.html`);
    await writeFile(file, standalonePage(frameToHtml(app.captureSpans(), colors.bg), "#161616"));
    console.log(`wrote ${file}`);
  } finally {
    app.destroy();
  }
}
process.exit(0);
