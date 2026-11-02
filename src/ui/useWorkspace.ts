import type { CliRenderer, KeyEvent } from "@opentui/core";
import type { OrchestrationProjectShell, OrchestrationV2ThreadShell, ServerConfig, ServerLifecycleStreamEvent, TerminalSummary, WorktreeSetupSnapshot } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { deriveLocalBranchNameFromRemoteRef, sanitizeNewRefName } from "@t3tools/shared/git";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { useEffect, useRef, useState } from "react";

import type { FeedState, T3Session } from "../client/session.ts";
import type { PaletteCommand, Picker, PickerItem } from "../model/palette.ts";
import { newTerminalInput, preferredEditor, resolveBranchSelectionTarget, worktreeSetupNote } from "../model/workspace.ts";
import type { Confirmation } from "./ConfirmBar.tsx";
import { splitPatch, type DiffState } from "./DiffView.tsx";
import { attachTerminal } from "./terminalAttach.ts";

type Command = PaletteCommand & { readonly run: () => void };

/** Workspace controls stay out of the app's composer and navigation state. */
export function useWorkspace(input: {
  readonly session: T3Session;
  readonly renderer: CliRenderer;
  readonly live: boolean;
  readonly thread: OrchestrationV2ThreadShell | undefined;
  readonly project: OrchestrationProjectShell | undefined;
  readonly serverConfig: ServerConfig | null;
  readonly draft: boolean;
  readonly diff: DiffState | null;
  readonly openPicker: (picker: Picker) => void;
  readonly confirm: (confirmation: Confirmation) => void;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  readonly say: (message: string, bad?: boolean) => void;
}) {
  const { session, renderer, live, thread, project, openPicker, confirm, run, say } = input;
  const [terminals, setTerminals] = useState<FeedState<TerminalSummary> | null>(null);
  const [setup, setSetup] = useState<WorktreeSetupSnapshot | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const sayRef = useRef(say);
  sayRef.current = say;
  const activeThread = useRef(thread?.id);
  activeThread.current = thread?.id;
  const lastReady = useRef<string | null>(null);
  useEffect(() => live ? session.watchTerminals(setTerminals) : undefined, [session, live]);
  useEffect(() => {
    setSetup(null);
    setSetupError(null);
    if (!live || !thread) return;
    return session.watchWorktreeSetup(thread.id, (state) => {
      setSetup(state.snapshot);
      setSetupError(state.status === "error" ? state.error ?? "Could not load worktree setup." : null);
    });
  }, [session, live, thread?.id]);
  useEffect(() => session.watchServerLifecycle((state) => {
    const event: ServerLifecycleStreamEvent | null = state.event;
    if (event?.type === "ready" && event.payload.at !== lastReady.current) {
      const restarted = lastReady.current !== null;
      lastReady.current = event.payload.at;
      const outcome = event.payload.updateOutcome;
      sayRef.current(outcome
        ? `Server update ${outcome.targetVersion}: ${outcome.status}${outcome.reason ? ` · ${outcome.reason}` : ""}`
        : `Server ${restarted ? "restarted" : "ready"} · ${event.payload.environment.serverVersion}`, outcome !== undefined && outcome.status !== "committed");
    } else if (event?.type === "legacyThreadMigration") {
      sayRef.current(`Thread migration ${event.payload.status} · ${event.payload.totalThreadCount} threads`);
    }
  }), [session]);

  const threadTerminals = (terminals?.items ?? []).filter((terminal) => terminal.threadId === thread?.id);
  const cwd = thread?.worktreePath ?? project?.workspaceRoot;
  const label = (terminal: TerminalSummary) => resolveTerminalSessionLabel(terminal.terminalId, terminal);
  const enterTerminal = (terminal: Pick<TerminalSummary, "terminalId" | "cwd" | "worktreePath" | "label">) => {
    if (!thread) return;
    attachTerminal(renderer, session, { threadId: thread.id, ...terminal, label: resolveTerminalSessionLabel(terminal.terminalId, terminal) }, (message) => {
      if (message) say(message);
    });
  };
  const newTerminal = () => {
    if (!thread || !project) return say("Open a thread with a project folder first.", true);
    const request = newTerminalInput(thread.id, project.workspaceRoot, thread.worktreePath, threadTerminals, terminals?.status === "live");
    run("Terminal opened", async () => {
      await session.openTerminal(request);
      enterTerminal({ terminalId: request.terminalId, cwd: request.cwd, worktreePath: thread.worktreePath, label: "" });
    });
  };
  const terminalMutation = (terminal: TerminalSummary, action: "close" | "clear") => {
    if (!thread) return;
    run(action === "close" ? "Terminal closed" : "Terminal cleared", () => action === "close" ? session.closeTerminal(thread.id, terminal.terminalId) : session.clearTerminal(thread.id, terminal.terminalId));
  };
  const terminalItems = (action: "close" | "clear"): PickerItem[] => threadTerminals.map((terminal) => ({
    id: `terminal:${action}:${terminal.terminalId}`, title: `${action === "close" ? "Close" : "Clear"} › ${label(terminal)}`,
    run: () => terminalMutation(terminal, action),
  }));
  const terminalPicker = () => {
    if (!thread || input.draft) return say("Open a thread first.", true);
    openPicker({ placeholder: "Terminals · type close or clear for actions", groups: [
      { label: "Terminals", items: threadTerminals.map((terminal) => ({ id: `terminal:${terminal.terminalId}`, title: label(terminal), hint: terminal.hasRunningSubprocess ? "busy" : terminal.status, run: () => enterTerminal(terminal) })) },
      { label: "Actions", items: [
        { id: "terminal:new", title: "New terminal", run: newTerminal },
        ...(["close", "clear"] as const).flatMap((action) => {
          const items = terminalItems(action);
          return items.length ? [
            { id: `terminal:${action}`, title: `${action === "close" ? "Close" : "Clear"} terminal…`, run: () => openPicker({ placeholder: `${action === "close" ? "Close" : "Clear"} terminal`, groups: [{ label: "Terminals", items }] }) },
            ...items.map((item) => ({ ...item, searchOnly: true })),
          ] : [];
        }),
      ] },
    ] });
  };
  const openTerminal = () => {
    if (!thread || input.draft) return say("Open a thread first.", true);
    if (threadTerminals.length === 0) return newTerminal();
    if (threadTerminals.length === 1) return enterTerminal(threadTerminals[0]!);
    terminalPicker();
  };

  const branchPicker = () => {
    if (!thread || !cwd || !project || input.draft) return say("Open a thread with a repository first.", true);
    say("Loading refs…");
    session.listRefs(cwd).then((refs) => {
      if (activeThread.current !== thread.id) return;
      const updateWorkspace = (branch: string | null, path: string | null) => session.setThreadWorkspace(thread.id, branch, path, thread.worktreePath);
      const promptBranch = (worktree: boolean) => confirm({
        title: worktree ? "Create a new worktree?" : "Create and switch ref",
        detail: worktree ? `Based on ${thread.branch ?? "HEAD"}. The thread will move to the new worktree.` : cwd,
        message: { placeholder: "New branch name" }, confirmLabel: "create",
        run: (raw) => {
          const name = sanitizeNewRefName(raw);
          if (!name) return say("Enter a branch name.", true);
          run(worktree ? "Worktree created" : "Branch created", async () => {
            if (worktree) {
              const result = await session.createWorktree(cwd, thread.branch ?? "HEAD", name);
              await updateWorkspace(result.worktree.refName, result.worktree.path);
            } else {
              const result = await session.createRef(cwd, name);
              await updateWorkspace(result.refName, thread.worktreePath);
            }
          });
        },
      });
      openPicker({ placeholder: "Select ref", groups: [
        { label: "Refs", items: refs.map((ref) => ({
          id: `ref:${ref.isRemote ? "remote:" : ""}${ref.name}`, title: ref.name,
          hint: ref.current ? "current" : ref.worktreePath ? "worktree" : ref.isRemote ? "remote" : ref.isDefault ? "default" : "local",
          run: () => run("Ref selected", async () => {
            const target = resolveBranchSelectionTarget({ activeProjectCwd: project.workspaceRoot, activeWorktreePath: thread.worktreePath, refName: ref });
            const result = target.reuseExistingWorktree ? null : await session.switchRef(target.checkoutCwd, ref.name);
            await updateWorkspace(ref.isRemote ? result?.refName ?? deriveLocalBranchNameFromRemoteRef(ref.name) : ref.name, target.nextWorktreePath);
          }),
        })) },
        { label: "Actions", items: [
          { id: "branch:create", title: "Create and switch ref…", run: () => promptBranch(false) },
          { id: "branch:pull", title: "Pull", run: () => run("Pulled", () => session.pull(cwd)) },
          { id: "worktree:create", title: "Create worktree…", run: () => promptBranch(true) },
          ...(thread.worktreePath ? [{ id: "worktree:remove", title: "Remove worktree…", run: () => confirm({
            title: "Remove this worktree?", detail: `${thread.worktreePath} · Stops this thread's provider session. Refuses shared worktrees and uncommitted changes.`, confirmLabel: "remove",
            run: () => run("Worktree removed", () => session.removeThreadWorktree(thread.id, project.workspaceRoot, thread.worktreePath!)),
          }) }] : []),
        ] },
      ] });
    }, (error) => say(`Could not list refs: ${messageOf(error)}`, true));
  };

  const openInEditor = () => {
    if (!thread || !cwd || input.draft) return say("Open a thread first.", true);
    const editor = preferredEditor(input.serverConfig?.availableEditors ?? []);
    if (!editor) return say("No available editor on the server.", true);
    const open = (path: string) => run("Opened in editor", () => session.openInEditor(path, editor));
    if (!input.diff) return open(cwd);
    const diff = input.diff;
    if (diff.path) return open(resolvePathLinkTarget(diff.path, diff.cwd));
    const files = splitPatch(diff.patch ?? "");
    if (!files.length) return say("No file to open in this diff.", true);
    openPicker({ placeholder: "Open diff file in editor", groups: [{ label: "Files", items: files.map((file) => ({ id: `editor:${file.path}`, title: file.path, run: () => open(resolvePathLinkTarget(file.path, diff.cwd)) })) }] });
  };
  const cancelSetup = () => {
    if (!setup || setup.threadId !== thread?.id || setup.phase !== "running") return;
    confirm({ title: "Cancel worktree setup?", detail: "Stops workspace preparation and its setup script.", confirmLabel: "cancel setup", run: () => run("Worktree setup cancellation requested", () => session.cancelWorktreeSetup(setup.threadId)) });
  };
  const commands: Command[] = thread && !input.draft ? [
    { id: "terminal", title: "Open terminal", shortcut: "ctrl+j", keywords: ["shell", "console"], run: openTerminal },
    { id: "terminal-picker", title: "Terminals…", shortcut: "T", keywords: ["shell", "close", "clear", "attach"], run: terminalPicker },
    { id: "terminal-new", title: "New terminal", keywords: ["shell", "open"], run: newTerminal },
    ...terminalItems("close"), ...terminalItems("clear"),
    { id: "branches", title: "Branches and worktrees…", shortcut: "b", keywords: ["git", "switch", "ref", "create", "remove", "pull"], run: branchPicker },
    { id: "workspace-editor", title: input.diff ? "Open diff file in editor" : "Open workspace in editor", shortcut: "E", keywords: ["folder", "code", "vscode", "cursor"], run: openInEditor },
    ...(setup?.threadId === thread.id && setup.phase === "running" ? [{ id: "setup-cancel", title: "Cancel worktree setup…", keywords: ["preparation", "stop"], run: cancelSetup }] : []),
  ] : [];
  const key = (key: KeyEvent): boolean => {
    if (key.ctrl || key.meta) return false;
    if (key.name === "t" && key.shift) return terminalPicker(), true;
    if (key.name === "b" && !key.shift) return branchPicker(), true;
    if (key.name === "e" && key.shift) return openInEditor(), true;
    return false;
  };
  return { commands, key, openTerminal, note: input.draft ? null : setupError ?? worktreeSetupNote(setup?.threadId === thread?.id ? setup : null), setupFailed: setup?.phase === "failed" || setupError !== null };
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
