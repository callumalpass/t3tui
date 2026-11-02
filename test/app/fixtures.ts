import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { v2Projection } from "../../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";

const at = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");

/** The thread with a command waiting for approval. */
export function withApproval(supportsFeedback = false): OrchestrationV2ThreadProjection {
  return {
    ...v2Projection,
    runtimeRequests: [
      { id: "approval-1", nodeId: "node-1", providerTurnId: null, nativeRequestRef: null, kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: "session-1", ...(supportsFeedback ? { supportsFeedback } : {}) }, createdAt: at, resolvedAt: null },
    ],
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

export function withOmittedOutput(): OrchestrationV2ThreadProjection {
  return {
    ...v2Projection,
    turnItems: [omittedCommand],
    visibleTurnItems: [{ position: 0, visibility: "local", sourceThreadId: omittedCommand.threadId, sourceItemId: omittedCommand.id, item: omittedCommand }],
  } as unknown as OrchestrationV2ThreadProjection;
}
