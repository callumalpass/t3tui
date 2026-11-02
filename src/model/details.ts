import type {
  DiscoveredLocalServer,
  GitStackedAction,
  OrchestrationProjectShell,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadShell,
  ScheduledTask,
  ThreadId,
  VcsStatusResult,
} from "@t3tools/contracts";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { homedir } from "node:os";

import type { VcsState } from "../client/session.ts";
import { formatClock, type T3tuiConfig } from "../config.ts";
import { buildMenuItems, resolveQuickAction } from "../../vendor/t3code/apps/web/src/components/GitActionsControl.logic.ts";
import type { StatusTone } from "./threads.ts";

/** The web's thread details card, reduced to what a terminal column can show. Sections with nothing to say are left out. */
export interface ThreadDetails {
  readonly workspace: {
    readonly path: string;
    readonly worktree: boolean;
    readonly model: string;
    readonly mode: string | null;
  };
  readonly branch: {
    readonly name: string;
    readonly upstream: string | null;
    readonly pullRequest: PullRequestLine | null;
  } | null;
  readonly changes: {
    readonly insertions: number;
    readonly deletions: number;
    readonly files: readonly { readonly path: string; readonly insertions: number; readonly deletions: number }[];
    /** The branch's total against its base, when it differs from the working tree's. */
    readonly branchTotal: { readonly baseRef: string | null; readonly insertions: number; readonly deletions: number } | null;
  } | null;
  /** The web's git quick action and menu: commit, push, create PR. */
  readonly git: {
    readonly quick: GitAction | null;
    /** Why there's no quick action ("Up to date", "Sync ref"), as the web's disabled button says. */
    readonly hint: string | null;
    readonly menu: readonly GitAction[];
  } | null;
  readonly lineage: readonly LineageLine[];
  readonly servers: readonly { readonly server: DiscoveredLocalServer; readonly label: string }[];
  readonly automations: readonly AutomationLine[];
  readonly background: readonly { readonly glyph: string; readonly text: string }[];
  readonly goal: { readonly objective: string; readonly status: string; readonly tone: StatusTone } | null;
  /** Git status failed, or the folder isn't a repository. */
  readonly vcsNote: string | null;
}

export interface GitAction {
  readonly action: GitStackedAction;
  readonly label: string;
  /** Commit actions take a message; the others don't. */
  readonly commits: boolean;
}

export interface LineageLine {
  readonly glyph: string;
  readonly text: string;
  /** The thread it links to, when there's one to open. */
  readonly threadId?: ThreadId;
}

export interface AutomationLine {
  readonly task: ScheduledTask;
  readonly schedule: string;
  readonly status: string;
  readonly tone: StatusTone;
}

/** Something in the panel you can select and activate, in display order. */
export type DetailsAction =
  | { readonly kind: "diff"; readonly id: string; readonly path: string | null }
  | { readonly kind: "git"; readonly id: string; readonly git: GitAction }
  | { readonly kind: "thread"; readonly id: string; readonly threadId: ThreadId }
  | { readonly kind: "server"; readonly id: string; readonly server: DiscoveredLocalServer }
  | { readonly kind: "automation"; readonly id: string; readonly task: ScheduledTask };

export interface DetailsInput {
  readonly thread: OrchestrationV2ThreadShell;
  readonly project: OrchestrationProjectShell | undefined;
  readonly vcs: VcsState | null;
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  /** From the thread's projection, when it's loaded: names idle subagents the shell leaves out. */
  readonly subagents?: readonly OrchestrationV2Subagent[];
  readonly servers?: readonly DiscoveredLocalServer[];
  readonly automations?: readonly ScheduledTask[];
  readonly now?: number;
  /** How automation times read; the system's locale by default. */
  readonly timestampFormat?: T3tuiConfig["timestampFormat"];
}

export interface PullRequestLine {
  readonly number: number;
  readonly title: string | null;
  readonly state: string;
  readonly tone: StatusTone;
  readonly checks: { readonly text: string; readonly tone: StatusTone } | null;
}

export const RUNTIME_MODE_LABELS: Record<string, string> = {
  "approval-required": "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

/** The folder git runs in: the thread's worktree, else its project's root. */
export function detailsCwd(thread: OrchestrationV2ThreadShell, project: OrchestrationProjectShell | undefined): string | null {
  return thread.worktreePath ?? project?.workspaceRoot ?? null;
}

export function threadDetails(input: DetailsInput): ThreadDetails {
  const { thread, project, vcs, snapshot } = input;
  const now = input.now ?? Date.now();
  const local = vcs?.local?.isRepo ? vcs.local : null;
  const remote = local ? (vcs?.remote ?? null) : null;
  const path = detailsCwd(thread, project) ?? "";
  const model = thread.modelSelection.model === "default" ? "Default model" : thread.modelSelection.model;
  const mode = [thread.interactionMode === "plan" ? "Plan" : "Build", RUNTIME_MODE_LABELS[thread.runtimeMode] ?? thread.runtimeMode].join(" · ");

  const branchName = local?.refName ?? thread.branch;
  const branch = branchName
    ? {
        name: branchName,
        upstream: remote ? (remote.hasUpstream ? `↑${remote.aheadCount} ↓${remote.behindCount}` : local?.hasPrimaryRemote ? "not pushed" : null) : null,
        pullRequest: pullRequestLine(thread, remote),
      }
    : null;

  const tree = local?.workingTree;
  const branchChanges = local?.branchChanges;
  const changes =
    tree && (tree.files.length > 0 || (branchChanges && branchChanges.insertions + branchChanges.deletions > 0))
      ? {
          insertions: tree.insertions,
          deletions: tree.deletions,
          files: tree.files,
          branchTotal:
            branchChanges && !local?.isDefaultRef && (branchChanges.insertions !== tree.insertions || branchChanges.deletions !== tree.deletions)
              ? { baseRef: branchChanges.baseRef, insertions: branchChanges.insertions, deletions: branchChanges.deletions }
              : null,
        }
      : null;

  const threads = snapshot?.threads ?? [];
  const titleOf = (id: string) => threads.find((other) => other.id === id)?.title ?? "another thread";
  const lineage: LineageLine[] = [];
  const parentId = thread.lineage.parentThreadId ?? (thread.forkedFrom?.type === "run" ? thread.forkedFrom.threadId : null);
  if (parentId) lineage.push({ glyph: "↰", text: `${thread.lineage.relationshipToParent === "subagent" ? "subagent of" : "forked from"} ${quote(titleOf(parentId))}`, threadId: parentId });
  for (const fork of threads.filter((other) => other.lineage.parentThreadId === thread.id && other.lineage.relationshipToParent === "fork" && other.deletedAt === null)) {
    lineage.push({ glyph: "↳", text: `fork ${quote(fork.title)}`, threadId: fork.id });
  }
  // The projection names every subagent; the shell only the busy ones.
  const subagents = new Map<ThreadId, string>();
  for (const subagent of input.subagents ?? []) if (subagent.childThreadId) subagents.set(subagent.childThreadId, subagent.title ?? titleOf(subagent.childThreadId));
  for (const other of threads) if (other.lineage.parentThreadId === thread.id && other.lineage.relationshipToParent === "subagent") subagents.set(other.id, other.title);
  const running = new Set(threads.filter((other) => other.activeRunId !== null).map((other) => other.id as string));
  for (const [threadId, title] of subagents) lineage.push({ glyph: running.has(threadId) ? "◐" : "↳", text: `subagent ${quote(title)}`, threadId });
  const unnamed = (thread.pendingBackgroundTasks ?? []).filter((task) => task.kind === "subagent" && !(task.childThreadId && subagents.has(task.childThreadId))).length;
  if (unnamed > 0) lineage.push({ glyph: "◐", text: `${plural(unnamed, "subagent")} running` });

  const git = local ? gitActions({ ...local, ...(remote ?? { hasUpstream: false, aheadCount: 0, behindCount: 0, pr: null }) }) : null;

  const servers = (input.servers ?? [])
    .filter((server) => server.terminal?.threadId === thread.id || server.agent?.threadId === thread.id)
    .map((server) => ({ server, label: `${server.url.replace(/^https?:\/\//, "")}${server.processName ? `  ${server.processName}` : ""}` }));

  const automations = (input.automations ?? [])
    .filter((task) => task.threadId === thread.id)
    .map((task) => automationLine(task, now, input.timestampFormat ?? "locale"));

  const background = (thread.pendingBackgroundTasks ?? [])
    .filter((task) => task.kind !== "subagent")
    .map((task) => ({ glyph: task.kind === "monitor" ? "◎" : "◐", text: task.description ?? task.kind.replace("_", " ") }));

  const goal = thread.goal
    ? {
        objective: thread.goal.objective,
        status: [thread.goal.status.replace("_", " "), thread.goal.timeUsedSeconds ? formatWorkingDurationLabel(thread.goal.timeUsedSeconds * 1000) : ""].filter(Boolean).join(" · "),
        tone: (thread.goal.status === "active" ? "info" : thread.goal.status === "complete" ? "good" : thread.goal.status === "paused" ? "muted" : "warn") as StatusTone,
      }
    : null;

  const vcsNote = vcs?.status === "error" ? "Git status unavailable" : vcs?.local && !vcs.local.isRepo ? "Not a git repository" : null;
  return { git, servers, automations, workspace: { path: tildify(path), worktree: thread.worktreePath !== null && project !== undefined && thread.worktreePath !== project.workspaceRoot, model, mode }, branch, changes, lineage, background, goal, vcsNote };
}

/** Every selectable line, top to bottom, as the panel shows them. */
export function detailsActions(details: ThreadDetails): DetailsAction[] {
  const actions: DetailsAction[] = [];
  if (details.git?.quick) actions.push({ kind: "git", id: `git:quick:${details.git.quick.action}`, git: details.git.quick });
  for (const git of details.git?.menu ?? []) actions.push({ kind: "git", id: `git:${git.action}`, git });
  if (details.changes && details.changes.files.length > 0) {
    actions.push({ kind: "diff", id: "diff:*", path: null });
    for (const file of details.changes.files.slice(0, MAX_DETAIL_FILES)) actions.push({ kind: "diff", id: `diff:${file.path}`, path: file.path });
  }
  for (const line of details.lineage) if (line.threadId) actions.push({ kind: "thread", id: `thread:${line.threadId}`, threadId: line.threadId });
  for (const { server } of details.servers) actions.push({ kind: "server", id: `server:${server.port}`, server });
  for (const { task } of details.automations) actions.push({ kind: "automation", id: `automation:${task.id}`, task });
  return actions;
}

/** Files listed under Changes before the rest fold into a count. */
export const MAX_DETAIL_FILES = 8;

const COMMIT_ACTIONS: ReadonlySet<GitStackedAction> = new Set(["commit", "commit_push", "commit_push_pr"]);
const MENU_ACTIONS: Record<string, GitStackedAction> = { commit: "commit", push: "push", pr: "create_pr" };

/** The web's GitActionsControl logic: one quick action, plus the enabled menu items it doesn't already cover. */
function gitActions(status: VcsStatusResult): NonNullable<ThreadDetails["git"]> {
  const quickAction = resolveQuickAction(status, false, status.isDefaultRef, status.hasPrimaryRemote);
  const quick = quickAction.kind === "run_action" && quickAction.action && !quickAction.disabled ? { action: quickAction.action, label: quickAction.label, commits: COMMIT_ACTIONS.has(quickAction.action) } : null;
  const menu = buildMenuItems(status, false, status.hasPrimaryRemote)
    .filter((item) => !item.disabled && MENU_ACTIONS[item.id] && MENU_ACTIONS[item.id] !== quick?.action)
    .map((item) => ({ action: MENU_ACTIONS[item.id]!, label: item.label, commits: item.id === "commit" }));
  return { quick, hint: quick ? null : quickAction.hint ?? quickAction.label, menu };
}

function automationLine(task: ScheduledTask, now: number, timestampFormat: T3tuiConfig["timestampFormat"]): AutomationLine {
  const schedule =
    task.schedule.type === "interval"
      ? `every ${formatWorkingDurationLabel(task.schedule.everyMs)}`
      : task.schedule.type === "fixed_time"
        ? `${task.schedule.weekdays && task.schedule.weekdays.length < 7 ? `${task.schedule.weekdays.map((day) => WEEKDAYS[day]).join(",")} ` : "daily "}${formatClock(task.schedule.timeOfDay, timestampFormat)}`
        : "on webhook";
  if (!task.enabled) return { task, schedule, status: "off", tone: "muted" };
  if (task.lastRunStatus === "running") return { task, schedule, status: "running", tone: "info" };
  if (task.lastRunStatus === "failed") return { task, schedule, status: "failed", tone: "bad" };
  const next = task.nextRunAt ? Date.parse(String(task.nextRunAt)) : NaN;
  return { task, schedule, status: Number.isFinite(next) && next > now ? `in ${formatWorkingDurationLabel(next - now)}` : "on", tone: "good" };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The remote's PR for the branch, else the newest PR the thread linked. */
function pullRequestLine(thread: OrchestrationV2ThreadShell, remote: VcsState["remote"]): PullRequestLine | null {
  if (remote?.pr) {
    const pr = remote.pr;
    return { number: pr.number, title: pr.title, ...prState(pr.state, pr.isDraft === true), checks: null };
  }
  const link = (thread.pullRequests ?? []).filter((candidate) => candidate.source !== "stack-dismissed").at(-1);
  if (link) {
    const snapshot = link.snapshot;
    return {
      number: link.number,
      title: snapshot?.title ?? null,
      ...(snapshot ? prState(snapshot.state, snapshot.isDraft) : { state: "linked", tone: "muted" as StatusTone }),
      checks: snapshot?.checksState ? (CHECKS[snapshot.checksState] ?? null) : null,
    };
  }
  const linked = thread.linkedPullRequest ?? thread.branchPullRequest;
  return linked ? { number: linked.number, title: null, state: "linked", tone: "muted", checks: null } : null;
}

const CHECKS: Record<string, { text: string; tone: StatusTone }> = {
  passing: { text: "✓ checks", tone: "good" },
  failing: { text: "✕ checks", tone: "bad" },
  pending: { text: "◐ checks", tone: "warn" },
};

function prState(state: string, draft: boolean): { state: string; tone: StatusTone } {
  if (state === "open") return draft ? { state: "draft", tone: "muted" } : { state: "open", tone: "good" };
  if (state === "merged") return { state: "merged", tone: "input" };
  return { state, tone: "muted" };
}

function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const quote = (text: string) => `"${text || "New thread"}"`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
