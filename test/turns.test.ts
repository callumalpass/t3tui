import { describe, expect, test } from "bun:test";
import { CheckpointId, CheckpointRef, CheckpointScopeId, MessageId, NodeId, ProviderSessionId, ProviderThreadId, ProviderTurnId, RunAttemptId, RunId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import type { TimelineEntriesProjection } from "../vendor/t3code/apps/web/src/session-logic.ts";
import { v2Now, v2Projection } from "../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { adjacentTurn, diffTurn, findRevertCheckpoint, turnTargets } from "../src/model/turns.ts";

const providerThreadId = ProviderThreadId.make("pt");
const scopeId = CheckpointScopeId.make("scope");
function checkpoint(ordinal: number, runOrdinal: number | null = ordinal) {
  return { id: CheckpointId.make(`cp-${ordinal}`), threadId: v2Projection.thread.id, scopeId, runId: runOrdinal === null ? null : RunId.make(`run-${runOrdinal}`), nodeId: NodeId.make("node"), parentCheckpointId: null, ordinalWithinScope: ordinal, appRunOrdinal: runOrdinal, ref: CheckpointRef.make(`refs/checkpoints/${ordinal}`), status: "ready" as const,
    files: ordinal === 2 ? [] : [{ path: "file.ts", kind: "modified", additions: 1, deletions: 0 }], capturedAt: v2Now };
}
function entries(): TimelineEntriesProjection["entries"] {
  return [1, 2, 5].flatMap((ordinal) => [{ kind: "message" as const, id: `user-${ordinal}`, createdAt: "2026-06-20T00:00:00.000Z", message: { id: MessageId.make(`user-${ordinal}`), role: "user" as const, text: `prompt ${ordinal}`, runId: RunId.make(`run-${ordinal}`), streaming: false, inputIntent: "turn_start" as const, createdAt: "2026-06-20T00:00:00.000Z", updatedAt: "2026-06-20T00:00:00.000Z" } }]);
}
function projection(): OrchestrationV2ThreadProjection {
  const runs = [1, 2, 5].map((ordinal) => ({ id: RunId.make(`run-${ordinal}`), ordinal, activeAttemptId: RunAttemptId.make(`attempt-${ordinal}`), status: "completed" }));
  return { ...v2Projection, thread: { ...v2Projection.thread, activeProviderThreadId: providerThreadId }, checkpoints: [checkpoint(0, null), checkpoint(1), checkpoint(2), checkpoint(3, 5)],
    runs, attempts: [], providerThreads: [{ id: providerThreadId, providerSessionId: ProviderSessionId.make("session"), providerInstanceId: v2Projection.thread.modelSelection.instanceId }],
    providerTurns: runs.map((run) => ({ id: ProviderTurnId.make(`pt-${run.ordinal}`), runAttemptId: run.activeAttemptId, ordinal: run.ordinal, providerThreadId })),
  } as unknown as OrchestrationV2ThreadProjection;
}

describe("turn cursor and checkpoint targets", () => {
  test("navigates by message identity after earlier turns load", () => {
    const turns = turnTargets(projection(), entries(), null, true);
    expect(adjacentTurn(turns, null, -1)?.messageId).toBe(MessageId.make("user-5"));
    expect(adjacentTurn(turns, "user-5", -1)?.messageId).toBe(MessageId.make("user-2"));
    expect(adjacentTurn(turns, "user-1", -1)?.messageId).toBe(MessageId.make("user-1"));
    expect(adjacentTurn(turns, "user-5", 1)?.messageId).toBe(MessageId.make("user-5"));
    expect(adjacentTurn([], null, -1)).toBeUndefined();
  });
  test("rewinds before the prompt, using visible predecessors across ordinal gaps", () => {
    const turns = turnTargets(projection(), entries(), null, true);
    expect(turns.map((turn) => turn.revertTurnCount)).toEqual([0, 1, 2]);
    expect(findRevertCheckpoint(projection().checkpoints, turns[2]!.revertTurnCount!)?.id).toBe(CheckpointId.make("cp-2"));
  });
  test("does not mistake the first message in paged history for the thread start", () => {
    const turns = turnTargets(projection(), entries().slice(1), null, false);
    expect(turns.map((turn) => turn.revertTurnCount)).toEqual([undefined, 2]);
  });
  test("does not offer a running turn or a detached provider conversation for rollback", () => {
    expect(turnTargets(projection(), entries(), RunId.make("run-5"), true)[2]?.revertTurnCount).toBeUndefined();
    expect(turnTargets({ ...projection(), providerThreads: [] }, entries(), null, true).every((turn) => turn.revertTurnCount === undefined)).toBe(true);
  });
  test("defaults to the latest changed turn; a selection never falls back to another turn", () => {
    const turns = turnTargets(projection(), entries(), null, true);
    expect(diffTurn(turns, null)?.checkpointTurnCount).toBe(5);
    expect(diffTurn(turns.slice(0, 2), null)?.checkpointTurnCount).toBe(1);
    expect(diffTurn(turns, "user-2")?.checkpointTurnCount).toBe(2);
    expect(diffTurn(turns, "missing")).toBeUndefined();
  });
  test("keeps only one anchor for a turn with steering messages", () => {
    const all = entries();
    const first = all[0]!;
    expect(turnTargets(projection(), [first, first, ...all.slice(1)], null, true)).toHaveLength(3);
  });
});
