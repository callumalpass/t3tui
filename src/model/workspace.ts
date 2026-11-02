import {
  EDITORS,
  worktreeSetupStageLabel,
  type EditorId,
  type TerminalOpenInput,
  type TerminalSummary,
  type ThreadId,
  type WorktreeSetupSnapshot,
} from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";

export { resolveBranchSelectionTarget } from "../../vendor/t3code/apps/web/src/components/BranchToolbar.logic.ts";

/** Allocate and launch shells with the web's project environment and terminal numbering. */
export function newTerminalInput(
  threadId: ThreadId,
  projectRoot: string,
  worktreePath: string | null,
  terminals: readonly TerminalSummary[],
  metadataLive: boolean,
): TerminalOpenInput {
  const existingIds = terminals.map((terminal) => terminal.terminalId);
  // Without live metadata the next number is unknowable, so fall back to a fresh id.
  const terminalId = nextTerminalId(existingIds, metadataLive ? undefined : crypto.randomUUID());
  return {
    threadId,
    terminalId,
    cwd: worktreePath ?? projectRoot,
    worktreePath,
    env: projectScriptRuntimeEnv({ project: { cwd: projectRoot }, worktreePath }),
  };
}

/** The web's fallback when its browser-local last-editor preference isn't available. */
export function preferredEditor(available: readonly EditorId[]): EditorId | null {
  return EDITORS.find((editor) => available.includes(editor.id))?.id ?? null;
}

/** Show the active preparation stage without hiding failures after setup stops. */
export function worktreeSetupNote(snapshot: WorktreeSetupSnapshot | null): string | null {
  if (!snapshot || snapshot.phase === "done") return null;
  const running = snapshot.stages.find((stage) => stage.status === "running");
  const failed = snapshot.stages.find((stage) => stage.status === "failed");
  const stage = running ?? failed;
  const percent = stage?.percent !== null && stage?.percent !== undefined ? `${stage.percent}%` : null;
  const parts = [
    `Worktree setup: ${snapshot.phase}`,
    stage ? worktreeSetupStageLabel(stage.id) : null,
    percent,
    snapshot.error ?? stage?.detail,
  ];
  return parts.filter(Boolean).join(" · ");
}
