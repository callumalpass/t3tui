import { describe, expect, test } from "bun:test";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { findThread, relativeTime, statusLabel, threadRows } from "../src/model/threads.ts";

const at = (ms: number) => DateTime.makeUnsafe(ms);
const thread = (id: string, title: string, updated: number, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  projectId: "p1",
  status: "completed",
  activeRunId: null,
  latestRunId: "run-1",
  latestRunRequestedAt: at(updated - 100),
  latestRunStartedAt: at(updated - 90),
  latestRunCompletedAt: at(updated),
  pendingRuntimeRequest: null,
  latestUserMessageAt: null,
  lineage: { relationshipToParent: null, parentThreadId: null },
  modelSelection: { instanceId: "codex", model: "gpt" },
  archivedAt: null,
  deletedAt: null,
  settledOverride: null,
  settledAt: null,
  pinnedAt: null,
  lastVisitedAt: at(updated + 1),
  hasActionableProposedPlan: false,
  interactionMode: "default",
  createdAt: at(0),
  updatedAt: at(updated),
  ...extra,
});
const snapshot = {
  projects: [{ id: "p1", title: "tasknotes", workspaceRoot: "/home/me/tasknotes" }],
  threads: [
    thread("mcp:launch:aaaa1111", "old finished", 1_000),
    thread("t-running", "busy one", 2_000, { status: "running", activeRunId: "run-1", latestRunCompletedAt: null }),
    thread("t-waiting", "wants approval", 500, { status: "running", activeRunId: "run-1", latestRunCompletedAt: null, pendingRuntimeRequest: { id: "q", kind: "command", createdAt: at(0) } }),
    thread("t-new", "newest finished", 3_000, { lastVisitedAt: at(10) }),
    thread("t-settled", "put away", 4_000, { settledOverride: "settled", settledAt: at(4_000) }),
    thread("t-child", "a subagent", 5_000, { lineage: { relationshipToParent: "subagent", parentThreadId: "t-new" } }),
  ],
} as unknown as OrchestrationV2ShellSnapshot;

describe("threadRows", () => {
  test("uses the web sidebar's sections and leaves subagents under their parent", () => {
    expect(threadRows(snapshot).map((row) => [row.thread.id as string, row.section])).toEqual([
      ["t-new", "active"],
      ["mcp:launch:aaaa1111", "active"],
      ["t-waiting", "active"],
      ["t-running", "working"],
      ["t-settled", "settled"],
    ]);
  });

  test("shows the sidebar's status words", () => {
    const byId = new Map(threadRows(snapshot).map((row) => [row.thread.id as string, row]));
    expect(statusLabel(byId.get("t-waiting")!)?.text).toBe("Approval");
    expect(statusLabel(byId.get("t-new")!)?.text).toBe("Done");
    expect(statusLabel(byId.get("mcp:launch:aaaa1111")!)).toBeNull();
    expect(statusLabel(byId.get("t-running")!, 2_000 + 75_000)?.text).toBe("Working 1m");
  });

  test("filters by title or project", () => {
    expect(threadRows(snapshot, { query: "BUSY" }).map((row) => row.thread.id as string)).toEqual(["t-running"]);
    expect(threadRows(snapshot, { query: "tasknotes" })).toHaveLength(5);
  });
});

describe("findThread", () => {
  test("matches ids, id tails and title text", () => {
    expect(findThread(snapshot, "t-new")?.title).toBe("newest finished");
    expect(findThread(snapshot, "aaaa1111")?.title).toBe("old finished");
    expect(findThread(snapshot, "Approval")?.id as string | undefined).toBe("t-waiting");
  });
});

test("relativeTime", () => {
  expect(relativeTime(0, 2_000)).toBe("now");
  expect(relativeTime(0, 45_000)).toBe("45s");
  expect(relativeTime(0, 3 * 3600_000)).toBe("3h");
});
