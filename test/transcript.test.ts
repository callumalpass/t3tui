import { describe, expect, test } from "bun:test";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

import { blockFor } from "../src/model/transcript.ts";

const base = { id: "item-1", threadId: "thread-1", runId: null } as const;
const item = (fields: Record<string, unknown>) => ({ ...base, ...fields }) as unknown as OrchestrationV2TurnItem;

describe("blockFor", () => {
  test("failed commands show the exit code and a short output tail", () => {
    const block = blockFor(item({ type: "command_execution", input: "make test\n--verbose", output: "a\nb\nc\nd\ne", exitCode: 2 }), new Set());
    expect(block).toEqual({ kind: "tool", id: "item-1", icon: "$", label: "make test (exit 2)", detail: "…\nc\nd\ne", tone: "bad" });
  });

  test("approvals know whether they are still pending", () => {
    const fields = { type: "approval_request", requestId: "req-1", requestKind: "command", prompt: "Run rm -rf build?" };
    expect(blockFor(item(fields), new Set(["req-1"]))).toMatchObject({ kind: "approval", pending: true, title: "Run rm -rf build?" });
    expect(blockFor(item(fields), new Set())).toMatchObject({ pending: false });
  });

  test("dynamic tools summarize their input", () => {
    expect(blockFor(item({ type: "dynamic_tool", toolName: "read", input: { file_path: "/tmp/x.ts" } }), new Set())).toMatchObject({ label: "read /tmp/x.ts" });
  });

  test("empty messages and bookkeeping items render nothing", () => {
    expect(blockFor(item({ type: "user_message", text: "  " }), new Set())).toBeNull();
    expect(blockFor(item({ type: "checkpoint" }), new Set())).toBeNull();
  });
});

import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { buildTranscript, summarizeWork } from "../src/model/transcript.ts";

const projectionOf = (items: OrchestrationV2TurnItem[], pendingIds: string[] = []) =>
  ({
    runtimeRequests: pendingIds.map((id) => ({ id, status: "pending" })),
    visibleTurnItems: items.map((entry, position) => ({ position, item: entry })),
  }) as unknown as OrchestrationV2ThreadProjection;

let counter = 0;
const turn = (fields: Record<string, unknown>) => item({ id: `i${counter++}`, ...fields });

describe("buildTranscript", () => {
  test("folds runs of work between messages into one segment", () => {
    const transcript = buildTranscript(
      projectionOf([
        turn({ type: "user_message", text: "fix it" }),
        turn({ type: "command_execution", input: "ls" }),
        turn({ type: "reasoning", text: "thinking", streaming: false }),
        turn({ type: "file_change", fileName: "a.ts" }),
        turn({ type: "assistant_message", text: "done", streaming: false }),
      ]),
    );
    expect(transcript.segments.map((segment) => segment.kind)).toEqual(["user", "work", "assistant"]);
    const work = transcript.segments[1];
    expect(work?.kind === "work" && summarizeWork(work.steps)).toBe("1 command · 1 edit");
  });

  test("marks trailing work active while the thread runs", () => {
    const transcript = buildTranscript(projectionOf([turn({ type: "command_execution", input: "make" })]), { running: true });
    expect(transcript.segments[0]).toMatchObject({ kind: "work", active: true });
  });

  test("errors break out of folded work", () => {
    const transcript = buildTranscript(projectionOf([turn({ type: "command_execution", input: "a" }), turn({ type: "error", failure: { message: "boom" } }), turn({ type: "command_execution", input: "b" })]));
    expect(transcript.segments.map((segment) => segment.kind)).toEqual(["work", "alert", "work"]);
  });

  test("reuses unchanged segments so the view can skip them", () => {
    const user = turn({ type: "user_message", text: "hi" });
    const command = turn({ type: "command_execution", input: "ls" });
    const first = buildTranscript(projectionOf([user, command, turn({ type: "assistant_message", text: "He", streaming: true })]));
    const second = buildTranscript(projectionOf([user, command, turn({ type: "assistant_message", text: "Hello", streaming: true })]), { previous: first });
    expect(second.segments[0]).toBe(first.segments[0]!);
    expect(second.segments[1]).toBe(first.segments[1]!);
    expect(second.segments[2]).not.toBe(first.segments[2]!);
  });
});
