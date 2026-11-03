import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import type { ChatAttachment, ModelSelection, OrchestrationMessageContext, OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell, ServerConfig, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import type { T3Session } from "../client/session.ts";
import { RUNTIME_MODE_LABELS } from "../model/details.ts";
import type { Binding } from "../model/keymap.ts";
import { draftDefaults, modelSummary, type DraftThread } from "../model/models.ts";
import type { Picker } from "../model/palette.ts";
import { tildify } from "../model/paths.ts";
import type { DraftLine } from "./DraftView.tsx";

type WorkspaceStrategy = { type: "root" } | { type: "existing_worktree"; worktreePath: string } | { type: "worktree"; baseRef: string; startFromOrigin?: boolean };

/**
 * A new thread, as the web's: a local draft of where it runs and with what, which becomes a
 * thread when its first message is sent.
 */
export function useDraft(deps: {
  readonly session: T3Session;
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  readonly config: ServerConfig | null;
  /** The open thread, whose project and model a new draft starts from. */
  readonly thread: OrchestrationV2ThreadShell | undefined;
  readonly openPicker: (picker: Picker) => void;
  readonly say: (text: string, bad?: boolean) => void;
  /** A draft started: show it and take the keys to the composer. */
  readonly onStart: () => void;
  /** The thread the draft became. */
  readonly onLaunched: (threadId: ThreadId) => void;
}) {
  const { session, snapshot, config, say } = deps;
  const [draft, setDraft] = useState<DraftThread | null>(null);
  const projects = snapshot?.projects ?? [];
  const project = draft ? projects.find((candidate) => candidate.id === draft.projectId) : undefined;
  const hasThreads = (projectId: string) => snapshot?.threads.some((candidate) => candidate.projectId === projectId) ?? false;

  /**
   * Starts a draft: in the open thread's project with its model unless told otherwise, and in
   * an existing worktree when one is given (a thread's branch, a checked-out pull request).
   * Without `worktree`, the project's settings choose between its folder and a new worktree.
   */
  const start = (options: { readonly project?: OrchestrationProjectShell; readonly model?: ModelSelection | null; readonly worktree?: { readonly path: string; readonly branch: string | null } | null } = {}) => {
    const target = options.project ?? projects.find((candidate) => candidate.id === deps.thread?.projectId) ?? projects[0];
    if (!target) return say("No projects on this server yet; add one in T3 Code.", true);
    const defaults = draftDefaults({ config, project: target, currentModel: options.model === undefined ? (deps.thread?.modelSelection ?? null) : options.model, projectHasThreads: hasThreads(target.id) });
    const worktree = options.worktree;
    // null: a thread or pull request without a worktree, so the project folder.
    setDraft(worktree ? { ...defaults, envMode: "worktree", existingWorktree: { path: worktree.path, branch: worktree.branch } } : worktree === null ? { ...defaults, envMode: "local" } : defaults);
    deps.onStart();
  };

  const update = (patch: Partial<DraftThread>) => {
    if (draft) setDraft({ ...draft, ...patch });
  };

  const openProjectPicker = () => {
    if (!draft) return;
    deps.openPicker({
      placeholder: "Project",
      groups: [
        {
          label: "Projects",
          items: projects.map((candidate) => ({
            id: `project:${candidate.id}`,
            title: candidate.title,
            hint: candidate.id === draft.projectId ? "current" : tildify(candidate.workspaceRoot),
            run: () => setDraft(draftDefaults({ config, project: candidate, currentModel: draft.modelSelection, projectHasThreads: hasThreads(candidate.id) })),
          })),
        },
      ],
    });
  };

  /** Project folder ↔ new worktree; an existing worktree goes back to the project folder. */
  const toggleWorkspace = () => {
    if (!draft) return;
    const { existingWorktree: _, ...rest } = draft;
    setDraft({ ...rest, envMode: draft.existingWorktree ? "local" : draft.envMode === "local" ? "worktree" : "local" });
  };

  /** Sends the first message, which creates the thread; `onFailed` gets the message back. */
  const launch = (text: string, context: OrchestrationMessageContext | undefined, attachments: readonly ChatAttachment[], onFailed: () => void) => {
    if (!draft || !project) return;
    const launching = draft;
    const root = project.workspaceRoot;
    say("Starting thread…");
    const workspaceStrategy = async (): Promise<WorkspaceStrategy> => {
      if (launching.existingWorktree) return { type: "existing_worktree", worktreePath: launching.existingWorktree.path };
      if (launching.envMode !== "worktree") return { type: "root" };
      // A worktree starts from the default branch; outside a git repository it runs in place, as the web's.
      const refs = await session.defaultRef(root);
      return refs.isRepo && refs.ref ? { type: "worktree", baseRef: refs.ref.name, startFromOrigin: config?.settings.newWorktreesStartFromOrigin ?? true } : { type: "root" };
    };
    workspaceStrategy()
      .then((strategy) =>
        session.launchThread({
          projectId: launching.projectId,
          title: deriveThreadTitleSeed({ text, attachments: [...attachments] }),
          generateTitle: true,
          modelSelection: launching.modelSelection,
          runtimeMode: launching.runtimeMode,
          interactionMode: "default",
          workspaceStrategy: strategy,
          text,
          context,
          attachments,
        }),
      )
      .then(
        (id) => {
          setDraft(null);
          deps.onLaunched(id);
          say("Thread started");
        },
        (error) => {
          say(`Could not start the thread: ${error instanceof Error ? error.message : String(error)}`, true);
          onFailed();
        },
      );
  };

  const cancel = () => setDraft(null);

  /** The draft's settings as the draft view lists them; each opens what changes it. */
  const lines = (openModelPicker: () => void): DraftLine[] =>
    draft
      ? [
          { key: "project", label: "Project", value: project?.title ?? "—", shortcut: "p", onPick: openProjectPicker },
          { key: "model", label: "Model", value: modelSummary(config, draft.modelSelection), shortcut: "m", onPick: openModelPicker },
          { key: "mode", label: "Mode", value: RUNTIME_MODE_LABELS[draft.runtimeMode] ?? draft.runtimeMode, shortcut: "m", onPick: openModelPicker },
          { key: "workspace", label: "Runs in", value: draft.existingWorktree ? `the ${draft.existingWorktree.branch ?? "thread's"} worktree` : draft.envMode === "worktree" ? "a new worktree from the default branch" : "the project folder", shortcut: "w", onPick: toggleWorkspace },
        ]
      : [];

  const keys = draft
    ? {
        project: { keys: ["p"], run: openProjectPicker, hint: "project", command: { id: "draft-project", title: "New thread: choose project" } },
        workspace: {
          keys: ["w"],
          run: toggleWorkspace,
          hint: "worktree",
          command: { id: "draft-workspace", title: draft.envMode === "local" && !draft.existingWorktree ? "New thread: use a new worktree" : "New thread: run in the project folder", keywords: ["worktree", "local", "branch"] },
        },
        cancel: { keys: ["esc"], run: cancel, hint: "cancel", command: { id: "draft-cancel", title: "Cancel new thread", keywords: ["discard"] } },
      } satisfies Record<string, Binding>
    : null;

  return { draft, project, start, update, launch, cancel, lines, keys };
}
