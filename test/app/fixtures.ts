import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { v2Projection } from "../../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";

const at = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
/** `seconds` after the fixture's start. */
const after = (seconds: number) => DateTime.makeUnsafe(DateTime.toEpochMillis(at) + seconds * 1_000);

/** The thread with a command waiting for approval. */
export function withApproval(supportsFeedback = false): OrchestrationV2ThreadProjection {
  const item = {
    id: "item-approval",
    threadId: v2Projection.thread.id,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "waiting",
    title: null,
    startedAt: at,
    completedAt: null,
    updatedAt: at,
    type: "approval_request",
    requestId: "approval-1",
    requestKind: "command",
    prompt: "rm -rf dist && bun run build",
    reason: "Deletes dist/ and rebuilds it.",
  };
  return {
    ...v2Projection,
    runtimeRequests: [
      { id: "approval-1", nodeId: "node-1", providerTurnId: null, nativeRequestRef: null, kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: "session-1", ...(supportsFeedback ? { supportsFeedback } : {}) }, createdAt: at, resolvedAt: null },
    ],
    turnItems: [item],
    visibleTurnItems: [{ position: 0, visibility: "local", sourceThreadId: v2Projection.thread.id, sourceItemId: item.id, item }],
  } as unknown as OrchestrationV2ThreadProjection;
}

/** The thread asking one single-choice question. */
export function withQuestion(): OrchestrationV2ThreadProjection {
  return {
    ...v2Projection,
    runtimeRequests: [{ id: "question-1", nodeId: "node-1", providerTurnId: null, nativeRequestRef: null, kind: "user_input", status: "pending", responseCapability: { type: "message" }, createdAt: at, resolvedAt: null }],
    turnItems: [
      {
        id: "item-1",
        type: "user_input_request",
        requestId: "question-1",
        responseMode: "message",
        questions: [{ id: "q1", header: "Colour", question: "Which colour?", options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }], multiSelect: false }],
      },
    ],
  } as unknown as OrchestrationV2ThreadProjection;
}

/** A finished command whose long output the server left out of the thread. */
export const omittedCommand = {
  id: "item-cmd",
  threadId: v2Projection.thread.id,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "completed",
  title: null,
  startedAt: at,
  completedAt: at,
  updatedAt: at,
  type: "command_execution",
  input: "bun test",
  outputOmitted: true,
  exitCode: 0,
} as const;

/** A finished turn: one prompt, one reply 3m 12s later, and a checkpoint of three changed files. */
export function withCompletedTurn(): OrchestrationV2ThreadProjection {
  const base = {
    threadId: v2Projection.thread.id,
    runId: "run-1",
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    title: null,
  };
  const turnItems = [
    { ...base, id: "item-user", ordinal: 0, status: "completed", startedAt: at, completedAt: at, updatedAt: at, type: "user_message", createdBy: "user", creationSource: "web", messageId: "msg-user-1", inputIntent: "turn_start", text: "Do the thing", attachments: [] },
    { ...base, id: "item-edit", ordinal: 1, status: "completed", startedAt: after(60), completedAt: after(65), updatedAt: after(65), type: "file_change", fileName: "src/index.ts", additions: 30, deletions: 5 },
    { ...base, id: "item-assistant", ordinal: 2, status: "completed", startedAt: after(192), completedAt: after(192), updatedAt: after(192), type: "assistant_message", messageId: "msg-assistant-1", text: "Done — the thing is done.", streaming: false },
  ];
  return {
    ...v2Projection,
    runs: [
      { id: "run-1", threadId: v2Projection.thread.id, ordinal: 1, providerInstanceId: "codex", modelSelection: { instanceId: "codex", model: "gpt-5.4" }, providerThreadId: null, userMessageId: "msg-user-1", rootNodeId: null, activeAttemptId: null, status: "completed", requestedAt: at, startedAt: at, completedAt: after(192), checkpointId: "checkpoint-1", contextHandoffId: null },
    ],
    messages: [
      { createdBy: "user", creationSource: "web", id: "msg-user-1", threadId: v2Projection.thread.id, runId: "run-1", nodeId: null, role: "user", text: "Do the thing", attachments: [], streaming: false, createdAt: at, updatedAt: at },
      { createdBy: "user", creationSource: "web", id: "msg-assistant-1", threadId: v2Projection.thread.id, runId: "run-1", nodeId: null, role: "assistant", text: "Done — the thing is done.", attachments: [], streaming: false, createdAt: after(192), updatedAt: after(192) },
    ],
    checkpoints: [
      {
        id: "checkpoint-1",
        threadId: v2Projection.thread.id,
        scopeId: "scope-1",
        runId: "run-1",
        nodeId: null,
        parentCheckpointId: null,
        ordinalWithinScope: 0,
        appRunOrdinal: 1,
        ref: "refs/t3/checkpoint-1",
        status: "ready",
        files: [
          { path: "src/index.ts", kind: "modified", additions: 30, deletions: 5 },
          { path: "src/util.ts", kind: "modified", additions: 10, deletions: 2 },
          { path: "README.md", kind: "modified", additions: 2, deletions: 0 },
        ],
        capturedAt: after(192),
      },
    ],
    turnItems,
    visibleTurnItems: turnItems.map((item, position) => ({ position, visibility: "local", sourceThreadId: v2Projection.thread.id, sourceItemId: item.id, item })),
  } as unknown as OrchestrationV2ThreadProjection;
}

export function withOmittedOutput(): OrchestrationV2ThreadProjection {
  return {
    ...v2Projection,
    turnItems: [omittedCommand],
    visibleTurnItems: [{ position: 0, visibility: "local", sourceThreadId: omittedCommand.threadId, sourceItemId: omittedCommand.id, item: omittedCommand }],
  } as unknown as OrchestrationV2ThreadProjection;
}
