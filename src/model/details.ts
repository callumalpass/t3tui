import type {
  DiscoveredLocalServer,
  GitStackedAction,
  OrchestrationProjectShell,
  OrchestrationV2PlanStep,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ScheduledTask,
  ServerConfig,
  ThreadId,
  VcsStatusResult,
} from "@t3tools/contracts";
import { formatWorkingDurationLabel, type ThreadStructureTurnItem } from "@t3tools/client-runtime/state/models";
import { homedir } from "node:os";

import type { VcsState } from "../client/session.ts";
import { formatClock, type T3tuiConfig } from "../config.ts";
import { buildMenuItems, resolveQuickAction } from "../../vendor/t3code/apps/web/src/components/GitActionsControl.logic.ts";
import { deriveLatestContextWindowSnapshot, formatContextWindowTokens, latestProviderTurnTokenUsage } from "../../vendor/t3code/apps/web/src/lib/contextWindow.ts";
import { statusLabel, threadState, type StatusTone } from "./threads.ts";
import { providerLimits, type LimitWindowLine } from "./usage.ts";

/** The web's thread details card, reduced to what a terminal column can show. Sections with nothing to say are left out. */
export interface ThreadDetails {
  /** The run state as the thread list words it; null for a thread with nothing to report. */
  readonly status: { readonly text: string; readonly tone: StatusTone } | null;
  /** Room left in the context window, as the web's usage card reads it. */
  readonly context: { readonly left: number | null; readonly used: string } | null;
  /** The thread's provider's limit windows. */
  readonly limits: readonly LimitWindowLine[] | null;
  /** The agent's latest to-do list. */
  readonly tasks: Tasks | null;
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
    readonly files: readonly ChangedFile[];
    /** The branch's total against its base, when it differs from the working tree's. */
    readonly branchTotal: { readonly baseRef: string | null; readonly insertions: number; readonly deletions: number } | null;
  } | null;
  /** The web's git quick action and menu: commit, push, create PR. */
  readonly git: {
    readonly quick: GitAction | null;
    readonly menu: readonly GitAction[];
  } | null;
  /** Parent, forks and subagents; finished subagents fold away. */
  readonly lineage: readonly LineageLine[];
  readonly subagents: { readonly total: number; readonly running: number };
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

export interface ChangedFile {
  readonly path: string;
  /** M, or ? for a path git status has no counts for: untracked, as a file or a whole folder. */
  readonly status: "M" | "?";
  readonly insertions: number;
  readonly deletions: number;
}

export interface Tasks {
  readonly done: number;
  readonly total: number;
  readonly steps: readonly OrchestrationV2PlanStep[];
  /** The steps shown while folded, around the current one; null when they all fit. */
  readonly window: { readonly start: number; readonly end: number } | null;
}

export interface LineageLine {
  readonly glyph: string;
  readonly tone: StatusTone;
  readonly text: string;
  /** The thread it links to, when there's one to open. */
  readonly threadId?: ThreadId;
  /** A finished subagent, folded away until asked for. */
  readonly finished?: boolean;
}

export interface AutomationLine {
  readonly task: ScheduledTask;
  /** The next run, or its state when it isn't waiting for one. */
  readonly when: string;
  readonly tone: StatusTone;
}

/** Sections that fold to a count. */
export type DetailsFold = "tasks" | "subagents";

/** Something in the panel you can select and activate, in display order. */
export type DetailsAction =
  | { readonly kind: "fold"; readonly id: string; readonly fold: DetailsFold }
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
  /**
   * The thread's projection, when it's loaded: its to-do list and context window, and the
   * idle subagents the shell leaves out.
   */
  readonly projection?: OrchestrationV2ThreadProjection | null;
  /** For the provider's limits. */
  readonly serverConfig?: ServerConfig | null;
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
  const { thread, project, vcs, snapshot, projection } = input;
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
        upstream: remote ? (remote.hasUpstream ? [remote.aheadCount > 0 ? `↑${remote.aheadCount}` : "", remote.behindCount > 0 ? `↓${remote.behindCount}` : ""].filter(Boolean).join(" ") || null : local?.hasPrimaryRemote ? "not pushed" : null) : null,
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
          files: tree.files.map((file): ChangedFile => ({ ...file, status: file.path.endsWith("/") || file.insertions + file.deletions === 0 ? "?" : "M" })),
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
  if (parentId) lineage.push({ glyph: "↰", tone: "muted", text: `${thread.lineage.relationshipToParent === "subagent" ? "subagent of" : "forked from"} ${titleOf(parentId)}`, threadId: parentId });
  for (const fork of threads.filter((other) => other.lineage.parentThreadId === thread.id && other.lineage.relationshipToParent === "fork" && other.deletedAt === null)) {
    lineage.push({ glyph: "↳", tone: "muted", text: `fork ${fork.title || "New thread"}`, threadId: fork.id });
  }
  // The projection names every subagent; the shell only the busy ones, but it knows their runs best.
  const subagents = new Map<ThreadId, { title: string; agent?: OrchestrationV2Subagent }>();
  for (const agent of projection?.subagents ?? []) if (agent.childThreadId) subagents.set(agent.childThreadId, { title: agent.title ?? titleOf(agent.childThreadId), agent });
  for (const other of threads) if (other.lineage.parentThreadId === thread.id && other.lineage.relationshipToParent === "subagent") subagents.set(other.id, { ...subagents.get(other.id), title: other.title });
  const children = [...subagents].map(([threadId, { title, agent }]) => {
    const shell = threads.find((other) => other.id === threadId);
    const status: SubagentStatus = shell?.activeRunId || (agent && LIVE_SUBAGENT.has(agent.status)) ? "running" : agent?.status === "failed" || (shell && threadState(shell).status === "failed") ? "failed" : "done";
    return { status, line: { ...SUBAGENT_STATUS[status], text: title || "Subagent", threadId, ...(status === "done" ? { finished: true } : {}) } satisfies LineageLine };
  });
  const unnamed = (thread.pendingBackgroundTasks ?? []).filter((task) => task.kind === "subagent" && !(task.childThreadId && subagents.has(task.childThreadId))).length;
  const withStatus = (status: SubagentStatus) => children.filter((child) => child.status === status).map((child) => child.line);
  lineage.push(...withStatus("running"));
  if (unnamed > 0) lineage.push({ ...SUBAGENT_STATUS.running, text: `${plural(unnamed, "subagent")} running` });
  lineage.push(...withStatus("failed"), ...withStatus("done"));
  const subagentCounts = { total: children.length + unnamed, running: children.filter((child) => child.status === "running").length + unnamed };

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
  return {
    status: statusLabel(threadState(thread), now),
    context: contextLine(projection ?? null),
    limits: providerLimits(input.serverConfig ?? null, thread.modelSelection.instanceId, now),
    tasks: latestTasks(projection ?? null),
    git,
    servers,
    automations,
    workspace: { path: tildify(path), worktree: thread.worktreePath !== null && project !== undefined && thread.worktreePath !== project.workspaceRoot, model, mode },
    branch,
    changes,
    lineage,
    subagents: subagentCounts,
    background,
    goal,
    vcsNote,
  };
}

/** Steps shown before the rest of a to-do list folds into a count. */
export const MAX_TASKS = 5;

/** The thread's context window as the web derives it, fed as its chat view feeds it. */
function contextLine(projection: OrchestrationV2ThreadProjection | null): ThreadDetails["context"] {
  if (!projection) return null;
  const providerThread = projection.providerThreads.find((candidate) => candidate.id === projection.thread.activeProviderThreadId);
  const live = latestProviderTurnTokenUsage(projection.providerTurns, projection, providerThread);
  const snapshot = deriveLatestContextWindowSnapshot(projection.visibleTurnItems as unknown as readonly { readonly item: ThreadStructureTurnItem }[], live, providerThread);
  if (!snapshot) return null;
  return { left: snapshot.remainingPercentage === null ? null : Math.round(snapshot.remainingPercentage), used: formatContextWindowTokens(snapshot.usedTokens) };
}

/** The agent's most recent to-do list, folded around the step it's on. */
function latestTasks(projection: OrchestrationV2ThreadProjection | null): Tasks | null {
  const item = projection?.turnItems.findLast((candidate) => candidate.type === "todo_list");
  if (item?.type !== "todo_list" || item.steps.length === 0) return null;
  const steps = item.steps;
  const running = steps.findIndex((step) => step.status === "running");
  const current = running >= 0 ? running : Math.max(0, steps.findIndex((step) => step.status === "pending"));
  // Two finished steps lead into the current one; one more step than fits shows rather than folds.
  const start = Math.max(0, Math.min(current - 2, steps.length - MAX_TASKS));
  return {
    done: steps.filter((step) => step.status === "completed").length,
    total: steps.length,
    steps,
    window: steps.length > MAX_TASKS + 1 ? { start, end: start + MAX_TASKS } : null,
  };
}

/** Every selectable line, top to bottom, as the panel shows them with these folds open. */
export function detailsActions(details: ThreadDetails, unfolded: ReadonlySet<DetailsFold> = new Set()): DetailsAction[] {
  const actions: DetailsAction[] = [];
  if (details.tasks?.window) actions.push({ kind: "fold", id: "fold:tasks", fold: "tasks" });
  if (details.changes && details.changes.files.length > 0) {
    for (const file of details.changes.files.slice(0, MAX_DETAIL_FILES)) actions.push({ kind: "diff", id: `diff:${file.path}`, path: file.path });
    actions.push({ kind: "diff", id: "diff:*", path: null });
  }
  if (details.git?.quick) actions.push({ kind: "git", id: `git:quick:${details.git.quick.action}`, git: details.git.quick });
  for (const git of details.git?.menu ?? []) actions.push({ kind: "git", id: `git:${git.action}`, git });
  for (const line of details.lineage) {
    if (line.finished && !actions.some((action) => action.id === "fold:subagents")) actions.push({ kind: "fold", id: "fold:subagents", fold: "subagents" });
    if (line.threadId && (!line.finished || unfolded.has("subagents"))) actions.push({ kind: "thread", id: `thread:${line.threadId}`, threadId: line.threadId });
  }
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
  return { quick, menu };
}

function automationLine(task: ScheduledTask, now: number, timestampFormat: T3tuiConfig["timestampFormat"]): AutomationLine {
  if (!task.enabled) return { task, when: "off", tone: "muted" };
  if (task.lastRunStatus === "running") return { task, when: "running", tone: "info" };
  if (task.lastRunStatus === "failed") return { task, when: "failed", tone: "bad" };
  const next = task.nextRunAt ? Date.parse(String(task.nextRunAt)) : NaN;
  if (Number.isFinite(next) && next > now) return { task, when: shortTime(next, now, timestampFormat), tone: "muted" };
  const when =
    task.schedule.type === "interval"
      ? `every ${formatWorkingDurationLabel(task.schedule.everyMs)}`
      : task.schedule.type === "fixed_time"
        ? `${task.schedule.weekdays && task.schedule.weekdays.length < 7 ? `${task.schedule.weekdays.map((day) => WEEKDAYS[day]).join(",")} ` : "daily "}${formatClock(task.schedule.timeOfDay, timestampFormat)}`
        : "on webhook";
  return { task, when, tone: "muted" };
}

/** A time to come, as briefly as it reads: "today 21:00", "tomorrow 9:00", "Mon 7:00", "4 Mar 7:00". */
export function shortTime(at: number, now: number, timestampFormat: T3tuiConfig["timestampFormat"]): string {
  const date = new Date(at);
  const clock = formatClock(`${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`, timestampFormat);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? WEEKDAYS[date.getDay()] : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${day} ${clock}`;
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

const LIVE_SUBAGENT: ReadonlySet<string> = new Set(["pending", "running", "waiting"]);
type SubagentStatus = "running" | "failed" | "done";
const SUBAGENT_STATUS: Record<SubagentStatus, { glyph: string; tone: StatusTone }> = { running: { glyph: "◐", tone: "info" }, failed: { glyph: "✕", tone: "bad" }, done: { glyph: "✓", tone: "good" } };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
