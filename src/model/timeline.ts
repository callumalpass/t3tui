import { turnTargets, type TurnTarget } from "./turns.ts";
import type { OrchestrationV2ThreadProjection, RunAttemptId, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadStructureRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import { derivePendingThreadRequests, type PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";

// The web app's own timeline derivation: tui3 shows the same rows, folds and labels.
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRowsWithState,
  type MessagesTimelineRow,
  type MessagesTimelineRowsInput,
  type StableMessagesTimelineRowsState,
} from "../../vendor/t3code/apps/web/src/components/chat/MessagesTimeline.logic.ts";
import {
  deriveActiveWorkStartedAt,
  derivePhase,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  type TimelineEntriesProjection,
} from "../../vendor/t3code/apps/web/src/session-logic.ts";

export type { MessagesTimelineRow } from "../../vendor/t3code/apps/web/src/components/chat/MessagesTimeline.logic.ts";
export type { WorkLogEntry } from "../../vendor/t3code/apps/web/src/session-logic.ts";
export { liveWorkEntryLabel, workEntryDisplayLabel } from "../../vendor/t3code/apps/web/src/components/chat/MessagesTimeline.logic.ts";

/** What a turn footer needs of its run: the model, and how long it ran. */
export interface RunMeta {
  readonly model: string;
  readonly durationMs: number | null;
}

export interface Timeline {
  readonly rows: readonly MessagesTimelineRow[];
  readonly pending: PendingThreadRequests;
  readonly turns: readonly TurnTarget[];
  readonly isWorking: boolean;
  /** When the current run started working, for "Working for 12s". */
  readonly workStartedAt: string | null;
  /** Footers by run, keyed as messages key their runs. */
  readonly runMeta: ReadonlyMap<string, RunMeta>;
  /** Carried into the next build so unchanged rows keep their identity. */
  readonly cache: TimelineCache;
}

type TurnDiffSummaries = ReturnType<typeof deriveThreadCheckpointSummaries>;

interface TimelineCache {
  readonly entries: TimelineEntriesProjection;
  readonly rows: { readonly input: MessagesTimelineRowsInput; readonly rows: MessagesTimelineRow[] };
  readonly stable: StableMessagesTimelineRowsState;
  readonly expandAll: boolean;
  readonly expanded: ReadonlySet<string>;
  /** The last summaries and what they were derived from, so unchanged replies keep their row identity. */
  readonly turnDiffSummaries: TurnDiffSummaries;
  readonly checkpoints: OrchestrationV2ThreadProjection["checkpoints"];
  readonly checkpointMessages: OrchestrationV2ThreadProjection["messages"];
}

const sameItems = <T,>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((item, index) => item === b[index]);

/** Answers yes for every id: "expand everything" without knowing the group ids up front. */
class EverySet<T> extends Set<T> {
  override has(): boolean {
    return true;
  }
}
const EVERYTHING: ReadonlySet<string> = new EverySet<string>();
const NOTHING: ReadonlySet<string> = new Set<string>();

export function buildTimeline(
  projection: OrchestrationV2ThreadProjection,
  /** `expanded` holds the run, attempt and work group ids opened one at a time (by a click). */
  options: { readonly expandAll: boolean; readonly expanded?: ReadonlySet<string>; readonly historyComplete: boolean },
  previous: Timeline | null,
): Timeline {
  const opened = options.expanded ?? NOTHING;
  const cache = previous?.cache.expandAll === options.expandAll && previous.cache.expanded === opened ? previous.cache : null;
  const entries = deriveTimelineEntriesFromVisibleTurnItemsWithState(
    {
      visibleTurnItems: projection.visibleTurnItems,
      optimisticMessages: [],
      attempts: projection.attempts,
      nodes: projection.nodes,
      plans: projection.plans,
    },
    cache?.entries ?? null,
  );
  const runtime = deriveThreadStructureRuntime(projection);
  const latestRun = deriveThreadActivityRun(projection);
  const runlessStartedAt = deriveRunlessWorkStartedAt(projection);
  const isWorking = derivePhase(runtime) === "running" || runlessStartedAt !== null;
  const workStartedAt = deriveActiveWorkStartedAt(latestRun, runtime, null) ?? runlessStartedAt;
  const pending = derivePendingThreadRequests(projection);
  const previousCache = previous?.cache;
  const turnDiffSummaries =
    previousCache && sameItems(previousCache.checkpoints, projection.checkpoints) && sameItems(previousCache.checkpointMessages, projection.messages)
      ? previousCache.turnDiffSummaries
      : deriveThreadCheckpointSummaries(projection);
  const expanded = options.expandAll ? EVERYTHING : opened;
  const rows = deriveMessagesTimelineRowsWithState(
    {
      timelineEntries: entries.entries,
      pendingApprovalRequestIds: new Set(pending.approvals.map((approval) => approval.requestId)),
      latestRun,
      runningRunId: runtime?.activeRunId ?? null,
      // The ids are branded strings; one set of plain ones holds all three kinds.
      expandedRunIds: expanded as ReadonlySet<RunId>,
      expandedAttemptIds: expanded as ReadonlySet<RunAttemptId>,
      expandedWorkGroupIds: expanded,
      isWorking,
      runlessWorkActive: runlessStartedAt !== null,
      activeTurnStartedAt: workStartedAt,
      turnDiffSummaries,
      supportsConversationRollback: false,
    },
    cache?.rows ?? null,
  );
  const stable = computeStableMessagesTimelineRows(rows.rows, cache?.stable ?? { byId: new Map(), result: [] });
  return {
    rows: stable.result,
    pending,
    turns: turnTargets(projection, entries.entries, isWorking ? runtime?.activeRunId ?? null : null, options.historyComplete),
    isWorking,
    workStartedAt,
    runMeta: new Map(
      projection.runs.map((run) => {
        const started = run.workStartedAt ?? run.startedAt ?? run.requestedAt;
        const durationMs = run.completedAt ? DateTime.toEpochMillis(run.completedAt) - DateTime.toEpochMillis(started) : null;
        return [run.id as string, { model: run.modelSelection.model, durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null }] as const;
      }),
    ),
    cache: { entries, rows, stable, expandAll: options.expandAll, expanded: opened, turnDiffSummaries, checkpoints: projection.checkpoints, checkpointMessages: projection.messages },
  };
}
