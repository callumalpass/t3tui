import { describe, expect, test } from "bun:test";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { findThread, relativeTime, threadRows } from "../src/model/threads.ts";

const at = (ms: number) => DateTime.makeUnsafe(ms);
const thread = (id: string, title: string, updated: number, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  projectId: "p1",
  status: "completed",
  activeRunId: null,
  pendingRuntimeRequest: null,
  updatedAt: at(updated),
  ...extra,
});
const snapshot = {
  projects: [{ id: "p1", title: "tasknotes", workspaceRoot: "/home/me/tasknotes" }],
  threads: [
    thread("mcp:launch:aaaa1111", "old finished", 1_000),
    thread("t-running", "busy one", 2_000, { status: "running", activeRunId: "r1" }),
    thread("t-waiting", "wants approval", 500, { status: "running", activeRunId: "r2", pendingRuntimeRequest: { id: "q", kind: "command", createdAt: at(0) } }),
    thread("t-new", "newest finished", 3_000),
  ],
} as unknown as OrchestrationV2ShellSnapshot;

describe("threadRows", () => {
  test("orders needs-you, then running, then recent by activity", () => {
    expect(threadRows(snapshot).map((row) => row.thread.id as string)).toEqual(["t-waiting", "t-running", "t-new", "mcp:launch:aaaa1111"]);
  });

  test("filters by title or project and caps recent rows", () => {
    expect(threadRows(snapshot, { query: "BUSY" }).map((row) => row.thread.id as string)).toEqual(["t-running"]);
    expect(threadRows(snapshot, { query: "tasknotes" })).toHaveLength(4);
    expect(threadRows(snapshot, { recentLimit: 1 }).map((row) => row.group)).toEqual(["needs-you", "running", "recent"]);
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
  expect(relativeTime(0, 45_000)).toBe("45s");
  expect(relativeTime(0, 3 * 3600_000)).toBe("3h");
});
