import type { OrchestrationV2ThreadProjection, RunId } from "@t3tools/contracts";
import { secretRequestDisplay, type SecretRequestItem } from "@t3tools/client-runtime/secret-request";
import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import { deriveThreadStructureRuntime } from "@t3tools/client-runtime/state/thread-execution";
import { latestExecutedRun, latestRootProviderFailure } from "@t3tools/shared/orchestrationV2ThreadError";

export interface QueuedMessage {
  readonly runId: RunId;
  readonly text: string;
  /** A guest's message keeps the guest's words: it can be removed, not rewritten. */
  readonly editable: boolean;
}

/** What the composer's queue controls need, derived as the web's chat view derives it. */
export interface QueueState {
  readonly queued: readonly QueuedMessage[];
  readonly activeRunId: RunId | null;
  /** "Send now" starts a turn with the message when idle, or steers it into the running one. */
  readonly canSendNow: boolean;
  readonly canPromoteToSteer: boolean;
  /** An interrupted run (or one stopped by a usage limit) the web offers to continue. */
  readonly resumableRunId: RunId | null;
  /** Queued turns held back by an interrupt, released by resuming. */
  readonly held: boolean;
}

export function queueState(projection: OrchestrationV2ThreadProjection): QueueState {
  const workflow = deriveThreadQueueWorkflowState(projection);
  return {
    queued: workflow.queuedRuns.map(({ run, text, context }) => ({ runId: run.id, text, editable: context?.guest === undefined })),
    activeRunId: workflow.activeRun?.id ?? null,
    canSendNow: workflow.canSendNow,
    canPromoteToSteer: workflow.canPromoteToSteer,
    resumableRunId: resumableRunId(projection),
    held: workflow.isHeld,
  };
}

function resumableRunId(projection: OrchestrationV2ThreadProjection): RunId | null {
  const run = latestExecutedRun(projection.runs);
  if (run?.status === "interrupted") return run.id;
  return run?.status === "failed" &&
    deriveThreadStructureRuntime(projection)?.lastErrorClass === "usage_limit" &&
    latestRootProviderFailure(run, projection.turnItems)?.class === "usage_limit"
    ? run.id
    : null;
}

/** The oldest secret request this thread can answer: one asked here, not inherited from a fork. */
export function pendingSecretRequest(projection: OrchestrationV2ThreadProjection): SecretRequestItem | null {
  for (const projected of projection.visibleTurnItems) {
    const item = projected.item;
    if (item.type === "secret_request" && secretRequestDisplay(item, projected.visibility).kind === "pending") return item;
  }
  return null;
}
