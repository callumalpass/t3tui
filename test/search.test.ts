import { describe, expect, test } from "bun:test";
import { OrchestrationV2RpcSchemas, OrchestrationV2SearchThreadsInput, ThreadId, type OrchestrationV2SearchThreadsResult, type OrchestrationV2ShellSnapshot, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { T3Session } from "../src/client/session.ts";
import { findTextSegments, mergeThreadShells, messageMatchGroups, threadReorder, threadSearchQuery } from "../src/model/search.ts";
import { paletteGroups } from "../src/model/palette.ts";
import { threadRows } from "../src/model/threads.ts";
import { stepThreadFindIndex } from "../vendor/t3code/apps/web/src/components/chat/threadFind.ts";

const at = (ms: number) => DateTime.makeUnsafe(ms);
const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, projectId: "p1", status: "completed", activeRunId: null,
  latestRunId: null, latestUserMessageAt: null, pendingRuntimeRequest: null,
  lineage: { relationshipToParent: null, parentThreadId: null }, modelSelection: { instanceId: "codex", model: "gpt" },
  archivedAt: null, deletedAt: null, settledOverride: null, settledAt: null, pinnedAt: null,
  lastVisitedAt: at(100), hasActionableProposedPlan: false, interactionMode: "default", createdAt: at(0), updatedAt: at(100), ...extra,
}) as unknown as OrchestrationV2ThreadShell;
const snapshot = (threads: readonly OrchestrationV2ThreadShell[]) => ({ projects: [{ id: "p1", title: "Project", workspaceRoot: "/project" }], threads, archivedThreads: [] }) as unknown as OrchestrationV2ShellSnapshot;

describe("thread search", () => {
  test("uses the web's minimum tokens, query cap, and commands-only prefix", () => {
    expect(threadSearchQuery("ab", false)).toBeNull();
    expect(threadSearchQuery("ab", true)).toBe("ab");
    expect(threadSearchQuery("  hello world  ", false)).toBe("hello world");
    expect(threadSearchQuery("> search", true)).toBeNull();
    expect(threadSearchQuery("x".repeat(300), false)?.length).toBe(200);
  });

  test("adds snippets in a final group, excluding threads already found by title", () => {
    const shell = snapshot([thread("hello"), thread("other")]);
    const groups = paletteGroups({ query: "hello", commands: [], snapshot: shell });
    const result = { matches: [{ threadId: "hello", projectId: "p1", snippet: "hello", source: "user", messageCreatedAt: null }, { threadId: "other", projectId: "p1", snippet: "hello from a message", source: "assistant", messageCreatedAt: null }] } as unknown as OrchestrationV2SearchThreadsResult;
    const combined = messageMatchGroups(groups, result, shell);
    expect(combined.map((group) => group.label)).toEqual(["Threads", "In messages"]);
    expect(combined.at(-1)?.entries[0]).toMatchObject({ threadId: "other", snippet: "hello from a message" });
    expect(messageMatchGroups(groups, null, shell)).toEqual(groups);
  });

  test("live rows and archives replace stale fetched older rows", () => {
    const old = thread("older", { settledOverride: "settled", settledAt: at(100) });
    const active = thread("older");
    expect(mergeThreadShells(snapshot([active]), [old])?.threads).toEqual([active]);
    const archived = thread("older", { archivedAt: at(200) });
    const merged = mergeThreadShells({ ...snapshot([]), archivedThreads: [archived] }, [old]);
    expect(threadRows(merged)).toEqual([]);
  });

  test("archived rows stay separate and show newest archive first", () => {
    const shell = snapshot([thread("active"), thread("older", { archivedAt: at(200) }), thread("newer", { archivedAt: at(300) })]);
    expect(threadRows(shell).map((row) => row.thread.id as string)).toEqual(["active"]);
    expect(threadRows(shell, { archived: true }).map((row) => [row.thread.id as string, row.section])).toEqual([["newer", "archived"], ["older", "archived"]]);
  });

  test("can reveal beyond the first thirty settled threads", () => {
    const shell = snapshot(Array.from({ length: 45 }, (_, i) => thread(`settled-${i}`, { settledOverride: "settled", settledAt: at(i + 1) })));
    expect(threadRows(shell)).toHaveLength(30);
    expect(threadRows(shell, { settledLimit: 60 })).toHaveLength(45);
  });

  test("find strips markdown and wraps through server match counts", () => {
    expect(findTextSegments("# Header\n\nFind **this** [label](https://example.com).\n\n```ts\nconst answer = 42;\n```\n")).toEqual(["Header", "Find this label.", "const answer = 42;"]);
    expect(findTextSegments("Find a\nphrase")).toEqual(["Find a phrase"]);
    expect(findTextSegments("Find a\nphrase", true)).toEqual(["Find a", "phrase"]);
    expect(stepThreadFindIndex(2, 3, 1)).toBe(0);
    expect(stepThreadFindIndex(0, 3, -1)).toBe(2);
    expect(stepThreadFindIndex(0, 0, 1)).toBe(0);
  });

  test("reordering uses the web's planner and respects section boundaries", () => {
    const rows = threadRows(snapshot([thread("one", { pinnedAt: at(1), pinOrderKey: "f" }), thread("two", { pinnedAt: at(1), pinOrderKey: "m" }), thread("three", { pinnedAt: at(1), pinOrderKey: "t" }), thread("active")]));
    const move = threadReorder(rows, ThreadId.make("two"), 1);
    expect(move?.section).toBe("pinned");
    expect(move?.assignments).toHaveLength(1);
    expect(move!.assignments[0]!.orderKey > "t").toBe(true);
    expect(threadReorder(rows, ThreadId.make("one"), -1)).toBeNull();
    expect(threadReorder(rows, ThreadId.make("three"), 1)).toBeNull();
    const keyless = threadRows(snapshot([thread("one", { pinnedAt: at(1) }), thread("two", { pinnedAt: at(1) })]));
    expect(threadReorder(keyless, ThreadId.make("one"), 1)?.assignments).toHaveLength(2);
    const hidden = threadRows(snapshot([thread("hidden", { pinnedAt: at(1), pinOrderKey: "w" })]));
    const filtered = threadReorder(rows.filter((row) => row.thread.id !== "three"), ThreadId.make("one"), 1, [...rows, ...hidden]);
    expect(filtered?.assignments.every((assignment) => assignment.id !== "hidden" && assignment.orderKey !== "w")).toBe(true);
  });

  test("read RPC wrappers send payloads accepted by their contract schemas", async () => {
    const session = new T3Session();
    const schemas = { searchThreads: OrchestrationV2SearchThreadsInput, searchThread: OrchestrationV2RpcSchemas.searchThread.input, getArchivedShellSnapshot: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.input, getOlderSettledThreads: OrchestrationV2RpcSchemas.getOlderSettledThreads.input };
    const sent: { name: keyof typeof schemas; input: unknown }[] = [];
    const rpc = Object.fromEntries(["searchThreads", "searchThread", "getArchivedShellSnapshot", "getOlderSettledThreads"].map((name) => [`orchestration.${name}`, (input: unknown) => {
      sent.push({ name: name as keyof typeof schemas, input });
      return Effect.succeed({});
    }]));
    (session as unknown as { connection: unknown }).connection = { rpc };
    await session.searchThreads({ query: "hello", limit: 20, olderSettledBefore: "2026-10-01T00:00:00Z" });
    await session.searchThread({ threadId: ThreadId.make("one"), query: "hello", index: 2 });
    await session.archivedThreads();
    await session.olderSettledThreads({ before: { settledAt: "2026-10-01T00:00:00Z", threadId: ThreadId.make("one") }, limit: 30 });
    expect(sent).toHaveLength(4);
    for (const call of sent) expect(Schema.is(schemas[call.name])(call.input)).toBe(true);
  });
});
