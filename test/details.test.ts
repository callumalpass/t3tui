import { describe, expect, test } from "bun:test";
import type { OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadProjection, OrchestrationV2ThreadShell } from "@t3tools/contracts";

import type { VcsState } from "../src/client/session.ts";
import { detailsActions, detailsCwd, shortTime, threadDetails } from "../src/model/details.ts";
import { v2Projection, v2ThreadShell } from "../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";

const project = { id: "p1", title: "tasknotes", workspaceRoot: "/repo/tasknotes" } as unknown as OrchestrationProjectShell;
const thread = (extra: Record<string, unknown> = {}) =>
  ({
    ...v2ThreadShell,
    id: "t1",
    title: "Fix sync",
    projectId: "p1",
    branch: "feat/sync",
    worktreePath: "/repo/tasknotes-wt/sync",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    interactionMode: "default",
    runtimeMode: "approval-required",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "t1" },
    forkedFrom: null,
    pendingBackgroundTasks: [],
    goal: null,
    deletedAt: null,
    ...extra,
  }) as unknown as OrchestrationV2ThreadShell;

const vcs = (local: Record<string, unknown>, remote: Record<string, unknown> | null = null): VcsState =>
  ({
    status: "live",
    local: {
      isRepo: true,
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feat/sync",
      hasWorkingTreeChanges: true,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      ...local,
    },
    remote,
  }) as unknown as VcsState;

const detailsOf = (t: OrchestrationV2ThreadShell, v: VcsState | null, snapshot: OrchestrationV2ShellSnapshot | null, extra: Partial<Parameters<typeof threadDetails>[0]> = {}) =>
  threadDetails({ thread: t, project, vcs: v, snapshot, ...extra });

describe("threadDetails", () => {
  test("runs git in the worktree and labels the workspace", () => {
    const details = detailsOf(thread(), null, null);
    expect(detailsCwd(thread(), project)).toBe("/repo/tasknotes-wt/sync");
    expect(detailsCwd(thread({ worktreePath: null }), project)).toBe("/repo/tasknotes");
    expect(details.workspace).toEqual({ path: "/repo/tasknotes-wt/sync", worktree: true, model: "gpt-5", mode: "Build · Supervised" });
    // Before git status arrives, the branch comes from the thread.
    expect(details.branch?.name).toBe("feat/sync");
    expect(details.changes).toBeNull();
  });

  test("shows changes, ahead/behind and the remote's PR", () => {
    const details = detailsOf(
      thread(),
      vcs(
        {
          workingTree: { files: [{ path: "src/a.ts", insertions: 3, deletions: 1 }], insertions: 3, deletions: 1 },
          branchChanges: { baseRef: "main", insertions: 40, deletions: 2 },
        },
        { hasUpstream: true, aheadCount: 2, behindCount: 0, pr: { number: 41, title: "Fix sync", url: "u", baseRef: "main", headRef: "feat/sync", state: "open", isDraft: false } },
      ),
      null,
    );
    expect(details.branch).toEqual({ name: "feat/sync", upstream: "↑2", pullRequest: { number: 41, title: "Fix sync", state: "open", tone: "good", checks: null } });
    expect(details.changes?.files).toHaveLength(1);
    expect(details.changes?.branchTotal).toEqual({ baseRef: "main", insertions: 40, deletions: 2 });
  });

  test("falls back to the thread's linked PR, with its checks", () => {
    const pullRequests = [
      { host: "github.com", repository: "o/r", number: 7, url: "u", source: "created", linkedAt: "2026-01-01T00:00:00Z", stack: null, snapshot: { state: "open", title: "Seven", headBranch: "x", baseBranch: "main", isDraft: true, updatedAt: null, syncedAt: "2026-01-01T00:00:00Z", checksState: "failing" } },
    ];
    const details = detailsOf(thread({ pullRequests }), vcs({}, { hasUpstream: false, aheadCount: 0, behindCount: 0, pr: null }), null);
    expect(details.branch?.upstream).toBe("not pushed");
    expect(details.branch?.pullRequest).toEqual({ number: 7, title: "Seven", state: "draft", tone: "muted", checks: { text: "✕ checks", tone: "bad" } });
  });

  test("lists lineage, background work and the goal", () => {
    const snapshot = {
      threads: [
        { id: "parent", title: "Plan sync", lineage: { parentThreadId: null, relationshipToParent: null }, deletedAt: null },
        { id: "fork", title: "Try another way", lineage: { parentThreadId: "t1", relationshipToParent: "fork" }, deletedAt: null },
      ],
    } as unknown as OrchestrationV2ShellSnapshot;
    const details = detailsOf(
      thread({
        lineage: { parentThreadId: "parent", relationshipToParent: "fork", rootThreadId: "parent" },
        pendingBackgroundTasks: [
          { taskId: "a", kind: "subagent" },
          { taskId: "b", kind: "command", description: "dev server :5173" },
        ],
        goal: { objective: "Ship sync", status: "active", timeUsedSeconds: 90 },
      }),
      vcs({}),
      snapshot,
    );
    expect(details.lineage.map((entry) => [entry.glyph, entry.text, entry.threadId])).toEqual([
      ["↰", "forked from Plan sync", "parent"],
      ["↳", "fork Try another way", "fork"],
      ["◐", "1 subagent running", undefined],
    ]);
    expect(details.subagents).toEqual({ total: 1, running: 1 });
    expect(details.background).toEqual([{ glyph: "◐", text: "dev server :5173" }]);
    expect(details.goal).toEqual({ objective: "Ship sync", status: "active · 1m", tone: "info" });
  });

  test("notes folders that aren't repositories", () => {
    expect(detailsOf(thread(), vcs({ isRepo: false }), null).vcsNote).toBe("Not a git repository");
  });

  test("offers the web's git actions and lists selectable lines in order", () => {
    const servers = [{ host: "127.0.0.1", port: 5173, url: "http://127.0.0.1:5173", processName: "vite", pid: 42, terminal: null, agent: { threadId: "t1" } }];
    const automations = [{ id: "a1", title: "Nightly check", prompt: "check", enabled: true, schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] }, threadId: "t1", nextRunAt: null, lastRunAt: null, lastRunStatus: "never", lastRunError: null, runCount: 0 }];
    const details = detailsOf(
      thread(),
      vcs({ workingTree: { files: [{ path: "src/a.ts", insertions: 3, deletions: 1 }], insertions: 3, deletions: 1 } }, { hasUpstream: true, aheadCount: 0, behindCount: 0, aheadOfDefaultCount: 0, pr: null }),
      null,
      { servers, automations, timestampFormat: "24-hour" } as never,
    );
    expect(details.git?.quick).toEqual({ action: "commit_push_pr", label: "Commit, push & PR", commits: true });
    expect(details.automations[0]).toMatchObject({ when: "Mon,Tue 09:00", tone: "muted" });
    expect(detailsActions(details).map((action) => action.id)).toEqual(["diff:src/a.ts", "diff:*", "git:quick:commit_push_pr", "git:commit", "server:5173", "automation:a1"]);
  });

  test("hides ahead/behind when both are zero", () => {
    const details = detailsOf(thread(), vcs({}, { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null }), null);
    expect(details.branch?.upstream).toBeNull();
    expect(detailsOf(thread(), vcs({}, { hasUpstream: true, aheadCount: 0, behindCount: 3, pr: null }), null).branch?.upstream).toBe("↓3");
  });

  test("marks paths without counts as untracked", () => {
    const files = [
      { path: "README.md", insertions: 29, deletions: 167 },
      { path: "docs/", insertions: 0, deletions: 0 },
      { path: "scripts/demo-capture.tsx", insertions: 0, deletions: 0 },
    ];
    const details = detailsOf(thread(), vcs({ workingTree: { files, insertions: 29, deletions: 167 } }), null);
    expect(details.changes?.files.map((file) => [file.status, file.path])).toEqual([
      ["M", "README.md"],
      ["?", "docs/"],
      ["?", "scripts/demo-capture.tsx"],
    ]);
  });

  test("shows the run state, the context window left and the provider's limits", () => {
    const projection = { ...v2Projection, providerTurns: [{ tokenUsage: { usedTokens: 62_000, maxTokens: 100_000, updatedAt: "2026-06-20T00:00:00.000Z" } }] } as unknown as OrchestrationV2ThreadProjection;
    const serverConfig = {
      providers: [{ instanceId: "codex", driver: "codex", enabled: true, usageLimits: { checkedAt: "2026-06-20T00:00:00.000Z", windows: [{ id: "5h", kind: "session", label: "5h", usedPercent: 39 }, { id: "week", kind: "weekly", label: "week", usedPercent: 95 }] } }],
    };
    const details = detailsOf(thread({ status: "running", activeRunId: "run-1", latestRunId: "run-1" }), null, null, { projection, serverConfig } as never);
    expect(details.context).toEqual({ left: 38, used: "62k" });
    expect(details.limits).toEqual([
      { label: "5h", left: 61, tone: "muted" },
      { label: "week", left: 5, tone: "warn" },
    ]);
    // Without usage reports there's nothing to show.
    const quiet = detailsOf(thread(), null, null, { projection: v2Projection });
    expect(quiet.context).toBeNull();
    expect(quiet.limits).toBeNull();
    expect(quiet.status).toBeNull();
  });

  test("shows the latest to-do list, folded around the step under way", () => {
    const steps = (running: number) => Array.from({ length: 9 }, (_, index) => ({ id: `s${index}`, text: `Step ${index}`, status: index < running ? "completed" : index === running ? "running" : "pending" }));
    const projection = {
      ...v2Projection,
      turnItems: [
        { id: "old", type: "todo_list", planId: "p", steps: steps(0) },
        { id: "new", type: "todo_list", planId: "p", steps: steps(6) },
      ],
    } as unknown as OrchestrationV2ThreadProjection;
    const tasks = detailsOf(thread(), null, null, { projection }).tasks;
    expect(tasks).toMatchObject({ done: 6, total: 9, window: { start: 4, end: 9 } });
    expect(detailsActions(detailsOf(thread(), null, null, { projection }))[0]?.id).toBe("fold:tasks");
    expect(detailsOf(thread(), null, null, { projection: v2Projection }).tasks).toBeNull();
  });

  test("lists running and failed subagents, folding finished ones", () => {
    const child = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ ...v2ThreadShell, id, title, lineage: { rootThreadId: "t1", parentThreadId: "t1", relationshipToParent: "subagent" }, ...extra });
    const snapshot = { threads: [child("a", "Staging soak", { activeRunId: "run-a" }), child("b", "Fix webhook"), child("c", "Write docs")] } as unknown as OrchestrationV2ShellSnapshot;
    const projection = { ...v2Projection, subagents: [{ childThreadId: "b", title: "Fix webhook", status: "failed" }, { childThreadId: "c", title: "Write docs", status: "completed" }] } as unknown as OrchestrationV2ThreadProjection;
    const details = detailsOf(thread(), null, snapshot, { projection });
    expect(details.lineage.map((entry) => [entry.glyph, entry.text, entry.finished ?? false])).toEqual([
      ["◐", "Staging soak", false],
      ["✕", "Fix webhook", false],
      ["✓", "Write docs", true],
    ]);
    expect(details.subagents).toEqual({ total: 3, running: 1 });
    expect(detailsActions(details).map((action) => action.id)).toEqual(["thread:a", "thread:b", "fold:subagents"]);
    expect(detailsActions(details, new Set(["subagents"])).map((action) => action.id)).toEqual(["thread:a", "thread:b", "fold:subagents", "thread:c"]);
  });

  test("shows an automation's next run as a short time", () => {
    const now = new Date(2026, 10, 3, 12, 0).getTime();
    const at = (days: number, hours: number) => new Date(2026, 10, 3 + days, hours, 0).getTime();
    expect(shortTime(at(0, 21), now, "24-hour")).toBe("today 21:00");
    expect(shortTime(at(1, 9), now, "24-hour")).toBe("tomorrow 09:00");
    // 3 November 2026 is a Tuesday.
    expect(shortTime(at(6, 7), now, "24-hour")).toBe("Mon 07:00");
    const automations = [{ id: "a1", title: "Weekly report", enabled: true, schedule: { type: "fixed_time", timeOfDay: "07:00", weekdays: [1] }, threadId: "t1", nextRunAt: new Date(at(6, 7)).toISOString(), lastRunStatus: "succeeded" }];
    expect(detailsOf(thread(), null, null, { automations, now, timestampFormat: "24-hour" } as never).automations[0]).toMatchObject({ when: "Mon 07:00", tone: "muted" });
  });
});
