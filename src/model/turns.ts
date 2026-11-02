import type { MessageId, OrchestrationV2ThreadProjection, RunId } from "@t3tools/contracts";
import { checkpointFileTotals, deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";
import { deriveRevertTurnCountByUserMessageId, findRevertCheckpoint, type TimelineEntriesProjection } from "../../vendor/t3code/apps/web/src/session-logic.ts";

export { findRevertCheckpoint };
export type TurnCheckpoint = ReturnType<typeof deriveThreadCheckpointSummaries>[number];
export interface TurnTarget {
  readonly messageId: MessageId;
  readonly runId: RunId;
  readonly text: string;
  readonly hasAttachments: boolean;
  readonly checkpoint: TurnCheckpoint | undefined;
  readonly revertTurnCount: number | undefined;
}

/** Uses the web's rewind mapping; run ordinals can have gaps after a rollback. */
export function turnTargets(projection: OrchestrationV2ThreadProjection, entries: TimelineEntriesProjection["entries"], unsettledRunId: RunId | null, historyComplete: boolean): TurnTarget[] {
  const checkpoints = deriveThreadCheckpointSummaries(projection);
  const revertCounts = deriveRevertTurnCountByUserMessageId({
    timelineEntries: entries,
    checkpoints,
    threadStartCheckpointReady: historyComplete && findRevertCheckpoint(projection.checkpoints, 0) !== undefined,
    availableRevertTurnCounts: availableRevertTurnCounts(projection),
    unsettledRunId,
  });
  const seen = new Set<RunId>();
  return entries.flatMap((entry) => {
    if (entry.kind !== "message" || entry.message.role !== "user" || !entry.message.runId || seen.has(entry.message.runId)) return [];
    const message = entry.message;
    const runId = entry.message.runId;
    seen.add(runId);
    return [{ messageId: message.id, runId, text: message.text, hasAttachments: (message.attachments?.length ?? 0) > 0,
      checkpoint: checkpoints.findLast((checkpoint) => checkpoint.runId === message.runId), revertTurnCount: revertCounts.get(message.id) }];
  });
}

/** Same provider-turn eligibility as ChatView.logic, without importing its browser state. */
function availableRevertTurnCounts(projection: OrchestrationV2ThreadProjection): Set<number> {
  const available = new Set<number>();
  const providerThread = projection.providerThreads.find((thread) => thread.id === projection.thread.activeProviderThreadId);
  if (!providerThread?.providerSessionId || providerThread.providerInstanceId !== projection.thread.modelSelection.instanceId) return available;
  available.add(0);
  for (const run of projection.runs) {
    if (run.activeAttemptId === null) continue;
    const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
    const turn = projection.providerTurns.filter((candidate) => candidate.runAttemptId === run.activeAttemptId)
      .reduce<(typeof projection.providerTurns)[number] | undefined>((latest, candidate) => !latest || candidate.ordinal > latest.ordinal ? candidate : latest, undefined)
      ?? projection.providerTurns.find((candidate) => candidate.id === attempt?.providerTurnId);
    if (turn?.providerThreadId === providerThread.id) available.add(run.ordinal);
  }
  return available;
}

/** With no cursor, diff the most recent checkpoint that actually changed files. */
export function diffTurn(turns: readonly TurnTarget[], selectedMessageId: string | null): TurnCheckpoint | undefined {
  return selectedMessageId !== null
    ? turns.find((turn) => turn.messageId === selectedMessageId)?.checkpoint
    : turns.map((turn) => turn.checkpoint).filter((checkpoint): checkpoint is TurnCheckpoint => checkpoint !== undefined && checkpointFileTotals(checkpoint).count > 0)
      .sort((left, right) => right.checkpointTurnCount - left.checkpointTurnCount)[0];
}

/** A cursor stays on its message when older history is prepended. */
export function adjacentTurn(turns: readonly TurnTarget[], selectedMessageId: string | null, direction: -1 | 1): TurnTarget | undefined {
  const index = turns.findIndex((turn) => turn.messageId === selectedMessageId);
  return turns[index < 0 ? turns.length - 1 : Math.max(0, Math.min(turns.length - 1, index + direction))];
}

