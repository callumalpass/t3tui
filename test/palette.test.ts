import { expect, test } from "bun:test";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { paletteEntries, paletteGroups } from "../src/model/palette.ts";

const at = (ms: number) => DateTime.makeUnsafe(ms);
const thread = (id: string, title: string, updated: number, extra: Record<string, unknown> = {}) => ({
  id, title, projectId: "p1", branch: null, archivedAt: null, deletedAt: null, latestUserMessageAt: null, updatedAt: at(updated),
  lineage: { parentThreadId: null, relationshipToParent: null }, ...extra,
});
const snapshot = {
  projects: [{ id: "p1", title: "tasknotes", workspaceRoot: "/r" }],
  threads: [
    thread("t1", "Fix calendar sync", 1_000),
    thread("t2", "Release notes", 3_000),
    thread("t3", "Sync worker", 2_000, { lineage: { parentThreadId: "t1", relationshipToParent: "subagent" } }),
    thread("t4", "Old", 500, { archivedAt: at(600) }),
  ],
} as unknown as OrchestrationV2ShellSnapshot;
const commands = [
  { id: "details", title: "Show thread details", shortcut: "d" },
  { id: "diff", title: "View uncommitted changes", keywords: ["diff"] },
];

test("lists commands, then recent threads, before you type", () => {
  const groups = paletteGroups({ query: "", commands, snapshot });
  expect(groups.map((group) => group.label)).toEqual(["Commands", "Recent threads"]);
  expect(groups[1]!.entries.map((entry) => (entry.kind === "thread" ? (entry.threadId as string) : ""))).toEqual(["t2", "t3", "t1"]);
});

test("searches threads, subagents included, and commands by keyword", () => {
  const entries = paletteEntries(paletteGroups({ query: "sync", commands, snapshot }));
  expect(entries.map((entry) => (entry.kind === "thread" ? `${entry.threadId}${entry.subagent ? "*" : ""}` : entry.command.id)).sort()).toEqual(["t1", "t3*"]);
  expect(paletteEntries(paletteGroups({ query: "diff", commands, snapshot }))[0]).toMatchObject({ kind: "command", command: { id: "diff" } });
  expect(paletteGroups({ query: ">", commands, snapshot }).map((group) => group.label)).toEqual(["Commands"]);
});
