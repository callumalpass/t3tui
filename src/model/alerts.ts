import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

import { createThreadNotificationGate, type ThreadNotificationKind, type ThreadNotificationObservation } from "../../vendor/t3code/apps/web/src/components/ThreadNotificationCoordinator.logic.ts";
import { resolveStatus, type ThreadStatus } from "./threads.ts";

export type { ThreadNotificationKind };

export interface Alert {
  readonly thread: OrchestrationV2ThreadShell;
  readonly kind: ThreadNotificationKind;
  readonly status: ThreadStatus;
  /** As the web's notification titles. */
  readonly title: string;
}

interface Observed extends ThreadNotificationObservation {
  readonly raw: OrchestrationV2ThreadShell;
  readonly status: ThreadStatus;
}

const LOCAL_ENVIRONMENT = "local" as EnvironmentId;

/**
 * The web's ThreadNotificationCoordinator over the shell snapshot: attention (approval,
 * question, guest request, failure, usage limit) alerts once per run and status;
 * completion alerts after the Working shelf's grace, unless the run was stopped. Nothing
 * alerts for state that was already there when tui3 connected.
 */
export function createAlerts(onAlert: (alert: Alert) => void) {
  let previous = new Map<ThreadId, Observed>();
  const gate = createThreadNotificationGate<ThreadId>((threadId, kind) => {
    const state = previous.get(threadId);
    if (state) onAlert({ thread: state.raw, kind, status: state.status, title: alertTitle(kind, state.status) });
  });
  return {
    observe(snapshot: OrchestrationV2ShellSnapshot): void {
      const next = new Map<ThreadId, Observed>();
      const changed: [Observed | undefined, Observed][] = [];
      for (const raw of snapshot.threads) {
        // Subagents show under their parent, whose status covers them.
        if (raw.lineage.relationshipToParent === "subagent") continue;
        const prior = previous.get(raw.id);
        if (prior?.raw === raw) {
          next.set(raw.id, prior);
          continue;
        }
        const shell = presentThreadShell(LOCAL_ENVIRONMENT, raw);
        let status = resolveStatus(shell);
        if (status === "ready" && shell.latestRun?.status === "failed") status = "failed";
        const attention = status === "input" || status === "request" || status === "approval" || status === "failed" || status === "limited" ? `${shell.latestRun?.runId ?? ""}:${status}` : null;
        const completedAt = Date.parse(shell.latestRun?.completedAt ?? "");
        const settled = status === "ready" && shell.latestRun?.status === "completed";
        const state: Observed = { raw, status, attention, settled, completedAt: settled && Number.isFinite(completedAt) ? completedAt : null };
        next.set(raw.id, state);
        changed.push([prior, state]);
      }
      previous = next;
      gate.retain(new Set(next.keys()));
      for (const [prior, state] of changed) {
        gate.observe(state.raw.id, prior, state, { archived: state.raw.archivedAt !== null, quiet: state.raw.latestRunStopRequested === true });
      }
    },
    /** The shell went away: the next snapshot counts as a first sighting again. */
    clear(): void {
      gate.clear();
      previous = new Map();
    },
  };
}

export function alertTitle(kind: ThreadNotificationKind, status: ThreadStatus): string {
  if (kind === "completion") return "Thread completed";
  switch (status) {
    case "approval":
      return "Approval needed";
    case "limited":
      return "Usage limit reached";
    case "failed":
      return "Thread failed";
    case "request":
      return "Guest request";
    default:
      return "Input needed";
  }
}
