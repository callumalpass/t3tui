import type { EnvironmentId, OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell, ProjectId } from "@t3tools/contracts";
import { formatWorkingDurationLabel, presentThreadShell, resolveThreadWorkingStartedAt, type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking, sortInboxThreadsByReturn, sortWorkingThreadsBySend } from "@t3tools/client-runtime/state/thread-inbox";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { sortPinnedThreadsByOrderKey, sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import * as DateTime from "effect/DateTime";

/** The web sidebar's sections, in its order. Active has no header unless others show. */
export type Section = "pinned" | "active" | "working" | "snoozed" | "settled" | "archived";

/** The web sidebar's row status (resolveSidebarThreadStatus). */
export type ThreadStatus = "approval" | "input" | "request" | "waiting" | "working" | "limited" | "failed" | "ready";

export interface ThreadRow {
  readonly thread: OrchestrationV2ThreadShell;
  readonly shell: EnvironmentThreadShell;
  readonly section: Section;
  readonly status: ThreadStatus;
  /** Finished since you last opened it. */
  readonly unread: boolean;
  readonly projectName: string;
}

export const SECTION_LABELS: Record<Section, string> = {
  pinned: "Pinned",
  active: "Active",
  working: "Working",
  snoozed: "Snoozed",
  settled: "Settled",
  archived: "Archived threads",
};

export const SECTION_ORDER: readonly Section[] = ["pinned", "active", "working", "snoozed", "settled", "archived"];

/** Only one server, so any constant id works for presentThreadShell. */
const LOCAL_ENVIRONMENT = "local" as EnvironmentId;

export function resolveStatus(shell: EnvironmentThreadShell): ThreadStatus {
  if (shell.hasPendingApprovals || shell.pendingSubagentRequest === "approval") return "approval";
  if (shell.hasPendingUserInput || shell.pendingSubagentRequest === "user_input") return "input";
  if ((shell.pendingGuestMessageCount ?? 0) > 0) return "request";
  const runtime = shell.runtime;
  if (runtime?.status === "running" && shell.blockedOnThreadWait) return "waiting";
  if (runtime && ["preparing", "queued", "starting", "running", "waiting"].includes(runtime.status)) return "working";
  if (runtime?.status === "idle") return "waiting";
  if (runtime?.status === "failed") return runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  return "ready";
}

export function hasUnseenCompletion(shell: EnvironmentThreadShell): boolean {
  const completedAt = Date.parse(shell.latestRun?.completedAt ?? "");
  if (Number.isNaN(completedAt) || !shell.lastVisitedAt) return false;
  const visitedAt = Date.parse(shell.lastVisitedAt);
  return Number.isNaN(visitedAt) || completedAt > visitedAt;
}

/** Whether the thread is waiting on you: the rows the web sidebar shows in bold. */
export function needsAttention(row: Pick<ThreadRow, "status" | "unread">): boolean {
  return row.status === "approval" || row.status === "input" || row.status === "request" || row.status === "failed" || row.status === "limited" || row.unread;
}

/** The sidebar's top-right status word, or null to show the time instead. */
export function statusLabel(row: ThreadRow, now = Date.now()): { readonly text: string; readonly tone: StatusTone } | null {
  switch (row.status) {
    case "working": {
      const label = row.shell.goal?.status === "active" ? "Goal" : "Working";
      const since = resolveThreadWorkingStartedAt(row.shell);
      return { text: since ? `${label} ${formatWorkingDurationLabel(now - Date.parse(since))}` : label, tone: "info" };
    }
    case "waiting":
      return { text: "Waiting", tone: "muted" };
    case "approval":
      return { text: "Approval", tone: "warn" };
    case "input":
      return { text: "Input", tone: "input" };
    case "request":
      return { text: "Request", tone: "input" };
    case "limited":
      return { text: "Limited", tone: "warn" };
    case "failed":
      return { text: "Failed", tone: "bad" };
    case "ready":
      return row.unread ? { text: "Done", tone: "good" } : null;
  }
}

export type StatusTone = "info" | "muted" | "warn" | "input" | "bad" | "good";

/** Threads in the web sidebar's sections and order. Subagent threads stay under their parent, so they're left out. */
export function threadRows(
  snapshot: OrchestrationV2ShellSnapshot | null,
  options: { readonly query?: string; readonly settledLimit?: number; readonly archived?: boolean; readonly now?: string } = {},
): ThreadRow[] {
  if (!snapshot) return [];
  const projects = new Map<ProjectId, OrchestrationProjectShell>(snapshot.projects.map((project) => [project.id, project]));
  const query = options.query?.trim().toLowerCase();
  const now = options.now ?? new Date().toISOString();
  const bySection: Record<Section, EnvironmentThreadShell[]> = { pinned: [], active: [], working: [], snoozed: [], settled: [], archived: [] };
  for (const thread of snapshot.threads) {
    if ((thread.archivedAt !== null) !== (options.archived === true) || thread.deletedAt !== null || thread.lineage.relationshipToParent === "subagent") continue;
    const projectName = projectLabel(projects.get(thread.projectId));
    if (query && !thread.title.toLowerCase().includes(query) && !projectName.toLowerCase().includes(query)) continue;
    const shell = presentThreadShell(LOCAL_ENVIRONMENT, thread);
    const section: Section = options.archived ? "archived" : effectiveSnoozed(shell, { now })
      ? "snoozed"
      : shell.settledOverride === "settled"
        ? "settled"
        : shell.pinnedAt != null
          ? "pinned"
          : isThreadWorking(shell)
            ? "working"
            : "active";
    bySection[section].push(shell);
  }
  const sorted: Record<Section, EnvironmentThreadShell[]> = {
    archived: bySection.archived.toSorted((a, b) => Date.parse(b.archivedAt ?? "") - Date.parse(a.archivedAt ?? "")),
    pinned: sortPinnedThreadsByOrderKey(bySection.pinned),
    active: sortInboxThreadsByReturn(bySection.active),
    working: sortWorkingThreadsBySend(bySection.working),
    snoozed: bySection.snoozed.toSorted((a, b) => Date.parse(a.snoozedUntil ?? "") - Date.parse(b.snoozedUntil ?? "")),
    settled: sortSettledThreads(bySection.settled).slice(0, options.settledLimit ?? 30),
  };
  return SECTION_ORDER.flatMap((section) =>
    sorted[section].map((shell) => ({
      thread: shell.source as OrchestrationV2ThreadShell,
      shell,
      section,
      status: resolveStatus(shell),
      unread: hasUnseenCompletion(shell),
      projectName: projectLabel(projects.get(shell.projectId)),
    })),
  );
}

export function lastActivity(thread: OrchestrationV2ThreadShell): number {
  return DateTime.toEpochMillis(thread.updatedAt);
}

/** The time the sidebar shows: your latest message, else the last update. */
export function rowTime(thread: OrchestrationV2ThreadShell): number {
  return thread.latestUserMessageAt ? DateTime.toEpochMillis(thread.latestUserMessageAt) : lastActivity(thread);
}

export function projectLabel(project: OrchestrationProjectShell | undefined): string {
  if (!project) return "";
  return project.title || project.workspaceRoot.split("/").filter(Boolean).pop() || project.workspaceRoot;
}

/** Matches a thread by id, id prefix, or a case-insensitive title substring. */
export function findThread(snapshot: OrchestrationV2ShellSnapshot, needle: string): OrchestrationV2ThreadShell | undefined {
  const lower = needle.toLowerCase();
  return (
    snapshot.threads.find((thread) => thread.id === needle) ??
    snapshot.threads.find((thread) => thread.id.startsWith(needle)) ??
    snapshot.threads.find((thread) => thread.id.endsWith(needle)) ??
    snapshot.threads.filter((thread) => thread.title.toLowerCase().includes(lower)).sort((a, b) => lastActivity(b) - lastActivity(a))[0]
  );
}

/** A short handle `findThread` accepts: MCP-launched ids share a prefix, so use the tail. */
export function shortId(id: string): string {
  return id.slice(-8);
}

/** Compact relative time, like the sidebar's: "now", "45s", "3m", "2h", "4d". */
export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
