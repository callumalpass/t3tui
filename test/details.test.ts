import { describe, expect, test } from "bun:test";
import type { OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell } from "@t3tools/contracts";

import type { VcsState } from "../src/client/session.ts";
import { detailsActions, detailsCwd, threadDetails } from "../src/model/details.ts";

const project = { id: "p1", title: "tasknotes", workspaceRoot: "/repo/tasknotes" } as unknown as OrchestrationProjectShell;
const thread = (extra: Record<string, unknown> = {}) =>
  ({
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
    expect(details.branch).toEqual({ name: "feat/sync", upstream: "↑2 ↓0", pullRequest: { number: 41, title: "Fix sync", state: "open", tone: "good", checks: null } });
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
    expect(details.lineage.map((entry) => [entry.text, entry.threadId])).toEqual([
      ['forked from "Plan sync"', "parent"],
      ['fork "Try another way"', "fork"],
      ["1 subagent running", undefined],
    ]);
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
    expect(details.automations[0]).toMatchObject({ schedule: "Mon,Tue 09:00", status: "on" });
    expect(detailsActions(details).map((action) => action.id)).toEqual(["git:quick:commit_push_pr", "git:commit", "diff:*", "diff:src/a.ts", "server:5173", "automation:a1"]);
  });
});
