import { describe, expect, test } from "bun:test";
import type { OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell } from "@t3tools/contracts";

import type { VcsState } from "../src/client/session.ts";
import { detailsCwd, threadDetails } from "../src/model/details.ts";

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

describe("threadDetails", () => {
  test("runs git in the worktree and labels the workspace", () => {
    const details = threadDetails(thread(), project, null, null);
    expect(detailsCwd(thread(), project)).toBe("/repo/tasknotes-wt/sync");
    expect(detailsCwd(thread({ worktreePath: null }), project)).toBe("/repo/tasknotes");
    expect(details.workspace).toEqual({ path: "/repo/tasknotes-wt/sync", worktree: true, model: "gpt-5", mode: "Build · Supervised" });
    // Before git status arrives, the branch comes from the thread.
    expect(details.branch?.name).toBe("feat/sync");
    expect(details.changes).toBeNull();
  });

  test("shows changes, ahead/behind and the remote's PR", () => {
    const details = threadDetails(
      thread(),
      project,
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
    const details = threadDetails(thread({ pullRequests }), project, vcs({}, { hasUpstream: false, aheadCount: 0, behindCount: 0, pr: null }), null);
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
    const details = threadDetails(
      thread({
        lineage: { parentThreadId: "parent", relationshipToParent: "fork", rootThreadId: "parent" },
        pendingBackgroundTasks: [
          { taskId: "a", kind: "subagent" },
          { taskId: "b", kind: "command", description: "dev server :5173" },
        ],
        goal: { objective: "Ship sync", status: "active", timeUsedSeconds: 90 },
      }),
      project,
      vcs({}),
      snapshot,
    );
    expect(details.lineage.map((entry) => entry.text)).toEqual(['forked from "Plan sync"', 'forked into "Try another way"', "1 subagent (1 running)"]);
    expect(details.background).toEqual([{ glyph: "◐", text: "dev server :5173" }]);
    expect(details.goal).toEqual({ objective: "Ship sync", status: "active · 1m", tone: "info" });
  });

  test("notes folders that aren't repositories", () => {
    expect(threadDetails(thread(), project, vcs({ isRepo: false }), null).vcsNote).toBe("Not a git repository");
  });
});
