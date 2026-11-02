import type { OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell, ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export type ThreadGroup = "needs-you" | "running" | "recent";

export interface ThreadRow {
  readonly thread: OrchestrationV2ThreadShell;
  readonly group: ThreadGroup;
  readonly projectName: string;
}

export const GROUP_LABELS: Record<ThreadGroup, string> = {
  "needs-you": "Needs you",
  running: "Running",
  recent: "Recent",
};

const ACTIVE_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);

export function needsUser(thread: OrchestrationV2ThreadShell): boolean {
  return thread.pendingRuntimeRequest !== null && thread.pendingRuntimeRequest.blocking !== false;
}

export function isRunning(thread: OrchestrationV2ThreadShell): boolean {
  return thread.activeRunId !== null || ACTIVE_STATUSES.has(thread.status);
}

export function groupOf(thread: OrchestrationV2ThreadShell): ThreadGroup {
  if (needsUser(thread)) return "needs-you";
  if (isRunning(thread)) return "running";
  return "recent";
}

export function lastActivity(thread: OrchestrationV2ThreadShell): number {
  return DateTime.toEpochMillis(thread.updatedAt);
}

/** Threads in display order: the ones waiting on you, then running, then the most recent. */
export function threadRows(snapshot: OrchestrationV2ShellSnapshot | null, options: { readonly recentLimit?: number; readonly query?: string } = {}): ThreadRow[] {
  if (!snapshot) return [];
  const projects = new Map<ProjectId, OrchestrationProjectShell>(snapshot.projects.map((project) => [project.id, project]));
  const query = options.query?.trim().toLowerCase();
  const order: ThreadGroup[] = ["needs-you", "running", "recent"];
  const rows = snapshot.threads
    .map((thread) => ({ thread, group: groupOf(thread), projectName: projectLabel(projects.get(thread.projectId)) }))
    .filter((row) => !query || row.thread.title.toLowerCase().includes(query) || row.projectName.toLowerCase().includes(query))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || lastActivity(b.thread) - lastActivity(a.thread));
  const limit = options.recentLimit ?? 60;
  let recent = 0;
  return rows.filter((row) => row.group !== "recent" || recent++ < limit);
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

export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
