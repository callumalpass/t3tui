import type { OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { homedir } from "node:os";

import type { VcsState } from "../client/session.ts";
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
  readonly lineage: readonly { readonly glyph: string; readonly text: string }[];
  readonly background: readonly { readonly glyph: string; readonly text: string }[];
  readonly goal: { readonly objective: string; readonly status: string; readonly tone: StatusTone } | null;
  /** Git status failed, or the folder isn't a repository. */
  readonly vcsNote: string | null;
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

export function threadDetails(
  thread: OrchestrationV2ThreadShell,
  project: OrchestrationProjectShell | undefined,
  vcs: VcsState | null,
  snapshot: OrchestrationV2ShellSnapshot | null,
): ThreadDetails {
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
  const lineage: { glyph: string; text: string }[] = [];
  const parentId = thread.lineage.parentThreadId ?? (thread.forkedFrom?.type === "run" ? thread.forkedFrom.threadId : null);
  if (parentId) lineage.push({ glyph: "↰", text: `${thread.lineage.relationshipToParent === "subagent" ? "subagent of" : "forked from"} ${quote(titleOf(parentId))}` });
  const forks = threads.filter((other) => other.lineage.parentThreadId === thread.id && other.lineage.relationshipToParent === "fork" && other.deletedAt === null);
  if (forks.length > 0) lineage.push({ glyph: "↳", text: forks.length === 1 ? `forked into ${quote(forks[0]!.title)}` : `${forks.length} forks` });
  const subagents = threads.filter((other) => other.lineage.parentThreadId === thread.id && other.lineage.relationshipToParent === "subagent");
  const runningSubagents = (thread.pendingBackgroundTasks ?? []).filter((task) => task.kind === "subagent").length;
  // Idle subagents are left out of the shell, so the running count can exceed what's listed.
  const subagentCount = Math.max(subagents.length, runningSubagents);
  if (subagentCount > 0) lineage.push({ glyph: "↳", text: `${plural(subagentCount, "subagent")}${runningSubagents > 0 ? ` (${runningSubagents} running)` : ""}` });

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
  return { workspace: { path: tildify(path), worktree: thread.worktreePath !== null && project !== undefined && thread.worktreePath !== project.workspaceRoot, model, mode }, branch, changes, lineage, background, goal, vcsNote };
}

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
