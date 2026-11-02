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
