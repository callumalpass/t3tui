import type { DiscoveredLocalServer, OrchestrationProjectShell, OrchestrationV2ShellSnapshot, OrchestrationV2Subagent, OrchestrationV2ThreadShell, ScheduledTask, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import type { FeedState, T3Session, VcsState } from "../client/session.ts";
import type { Tui3Config } from "../config.ts";
import { detailsActions, detailsCwd, threadDetails, type DetailsAction, type GitAction } from "../model/details.ts";
import { keys, type Binding } from "../model/keymap.ts";
import type { Automations } from "./useAutomations.ts";
import type { Confirmation } from "./ConfirmBar.tsx";
import type { DiffState } from "./DiffView.tsx";
import { firstLine } from "./text.ts";

/** The details column opens by itself on terminals at least this wide. */
const AUTO_WIDTH = 160;

/**
 * The thread's details panel: git status for its folder, plus the server-wide servers and
 * automations lists, and what each row does when it's opened.
 */
export function useDetails(deps: {
  readonly session: T3Session;
  readonly live: boolean;
  readonly width: number;
  readonly thread: OrchestrationV2ThreadShell | undefined;
  readonly project: OrchestrationProjectShell | undefined;
  /** The shell, with fetched subagent families, so lineage can name idle subagents. */
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  readonly subagents: readonly OrchestrationV2Subagent[];
  readonly now: number;
  readonly config: Tui3Config;
  readonly diff: DiffState | null;
  readonly setDiff: (update: DiffState | null | ((value: DiffState | null) => DiffState | null)) => void;
  readonly automations: Automations;
  readonly confirm: (confirmation: Confirmation) => void;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  readonly say: (text: string, bad?: boolean) => void;
  /** A step of a running git action, shown until the next. */
  readonly progress: (text: string) => void;
  readonly openThread: (id: ThreadId) => void;
  /** The panel takes the keys, or gives them back. */
  readonly focus: (focused: boolean) => void;
}) {
  const { session, live, thread, project, config, confirm, run, say, setDiff } = deps;
  /** null follows the terminal width; d sets it for the rest of the session. */
  const [pref, setPref] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const show = pref ?? deps.width >= AUTO_WIDTH;
  const cwd = thread ? detailsCwd(thread, project) : null;

  const [vcs, setVcs] = useState<{ cwd: string; state: VcsState } | null>(null);
  useEffect(() => {
    if (!show || !cwd || !live) return;
    return session.watchVcs(cwd, (state) => setVcs({ cwd, state }));
  }, [session, show, cwd, live]);
  const [servers, setServers] = useState<FeedState<DiscoveredLocalServer> | null>(null);
  const [automations, setAutomations] = useState<FeedState<ScheduledTask> | null>(null);
  useEffect(() => {
    if (!live) return;
    const stopServers = session.watchServers(setServers);
    const stopAutomations = session.watchAutomations(setAutomations);
    return () => {
      stopServers();
      stopAutomations();
    };
  }, [session, live]);
  const vcsState = vcs?.cwd === cwd ? vcs.state : null;
  // Another thread starts with nothing selected.
  useEffect(() => setSelected(null), [thread?.id]);

  const details = useMemo(
    () =>
      thread
        ? threadDetails({
            thread,
            project,
            vcs: vcsState,
            snapshot: deps.snapshot,
            subagents: deps.subagents,
            servers: servers?.items ?? [],
            automations: automations?.items ?? [],
            now: deps.now,
            timestampFormat: config.timestampFormat,
          })
        : null,
    [thread, project, vcsState, deps.snapshot, deps.subagents, servers, automations, deps.now, config.timestampFormat],
  );
  const actions = useMemo(() => (details ? detailsActions(details) : []), [details]);

  /** The folder's uncommitted changes, or one file's. */
  const openDiff = (path: string | null) => {
    if (!cwd) return;
    const at = cwd;
    setDiff({ cwd: at, path, status: "loading" });
    session.workingTreeDiff(at, path ?? undefined, config.diffIgnoreWhitespace).then(
      (source) => setDiff((value) => (value?.cwd === at && value.path === path ? { cwd: at, path, status: "ready", patch: source?.diff ?? "", ...(source ? { source: { cwd: at, sourceKind: source.kind, baseRef: source.baseRef, headRef: source.headRef } } : {}), truncated: source?.truncated ?? false } : value)),
      (error) => setDiff((value) => (value?.cwd === at && value.path === path ? { cwd: at, path, status: "error", error: messageOf(error) } : value)),
    );
  };

  const runGit = (git: GitAction) => {
    if (!cwd || !thread) return;
    const at = cwd;
    const branch = details?.branch?.name;
    const onDefault = vcsState?.local?.isDefaultRef === true;
    confirm({
      title: `${git.label}?`,
      detail: `${branch ? `On ${branch}` : "In"} · ${details?.workspace.path ?? at}${onDefault && git.action !== "create_pr" ? " · this is the default branch" : ""}`,
      ...(git.commits ? { message: { placeholder: "Leave blank to have one written for you" } } : {}),
      confirmLabel: git.label.toLowerCase(),
      run: (message) => {
        say(`${git.label}…`);
        session
          .runGitAction(
            { cwd: at, action: git.action, threadId: thread.id, projectId: thread.projectId, ...(git.commits && message.trim() ? { commitMessage: message.trim() } : {}) },
            (event) => {
              if (event.kind === "phase_started") deps.progress(`${event.label}…`);
              if (event.kind === "hook_started") deps.progress(`Running ${event.hookName} hook…`);
            },
          )
          .then(
            (result) => say(result.toast.description ? `${result.toast.title}: ${result.toast.description}` : result.toast.title),
            (error) => say(`${git.label} failed: ${messageOf(error)}`, true),
          );
      },
    });
  };

  const stopServer = (server: DiscoveredLocalServer) =>
    confirm({
      title: `Stop ${server.url}?`,
      ...(server.processName ? { detail: `${server.processName}${server.pid ? ` (pid ${server.pid})` : ""}` } : {}),
      confirmLabel: "stop",
      run: () => run("Server stopped", () => session.stopServer(server)),
    });
  const runAutomation = (task: ScheduledTask) =>
    confirm({ title: `Run "${task.title}" now?`, detail: firstLine(task.prompt), confirmLabel: "run", run: () => run("Automation started", () => session.runAutomationNow(task.id)) });
  const toggleAutomation = (task: ScheduledTask) => run(task.enabled ? "Automation turned off" : "Automation turned on", () => session.setAutomationEnabled(task.id, !task.enabled));

  const activate = (action: DetailsAction) => {
    setSelected(action.id);
    switch (action.kind) {
      case "diff":
        return openDiff(action.path);
      case "git":
        return runGit(action.git);
      case "thread":
        return deps.openThread(action.threadId);
      case "server":
        return stopServer(action.server);
      case "automation":
        return runAutomation(action.task);
    }
  };
  /** A click on a row. */
  const activateById = (id: string) => {
    const action = actions.find((candidate) => candidate.id === id);
    if (!action) return;
    if (action.kind !== "thread") deps.focus(true);
    activate(action);
  };
  const move = (delta: number) => {
    if (actions.length === 0) return;
    const index = actions.findIndex((action) => action.id === selected);
    const next = actions[index < 0 ? (delta > 0 ? 0 : actions.length - 1) : Math.min(actions.length - 1, Math.max(0, index + delta))];
    if (next) setSelected(next.id);
  };
  const focus = () => {
    if (!thread) return;
    if (!show) setPref(true);
    if (!actions.some((action) => action.id === selected)) setSelected(actions[0]?.id ?? null);
    deps.focus(true);
  };
  const leave = () => {
    setSelected(null);
    deps.focus(false);
  };
  const selectedAction = () => actions.find((candidate) => candidate.id === selected);

  const focusKey: Binding = { keys: ["l", "→"], run: focus, hint: "details", ...(thread ? { command: { id: "focus-details", title: "Focus thread details" } } : {}) };
  const toggleKey: Binding = { keys: ["d"], run: () => setPref(!show), command: { id: "details", title: show ? "Hide thread details" : "Show thread details", keywords: ["panel", "info"] } };
  /** What the panel's rows do, for the palette. */
  const commands = keys(
    details?.changes && details.changes.files.length > 0 && { keys: [], run: () => openDiff(null), command: { id: "diff", title: "View uncommitted changes", keywords: ["diff", "changes"] } },
    actions.flatMap((action): Binding[] => {
      if (action.kind === "git") return [{ keys: [], run: () => runGit(action.git), command: { id: action.id, title: `Git: ${action.git.label}`, keywords: ["commit", "push", "pull request", "pr"] } }];
      if (action.kind === "server") return [{ keys: [], run: () => stopServer(action.server), command: { id: action.id, title: `Stop server ${action.server.url}`, keywords: ["port", "kill"] } }];
      if (action.kind !== "automation") return [];
      const task = action.task;
      return [
        { keys: [], run: () => runAutomation(task), command: { id: action.id, title: `Run automation: ${task.title}`, keywords: ["scheduled", "task"] } },
        { keys: [], run: () => toggleAutomation(task), command: { id: `${action.id}:toggle`, title: `${task.enabled ? "Turn off" : "Turn on"} automation: ${task.title}`, keywords: ["scheduled", "task", "enable", "disable"] } },
        { keys: [], run: () => deps.automations.editAutomation(task), command: { id: `${action.id}:edit`, title: `Edit automation: ${task.title}`, keywords: ["scheduled", "task", "editor"] } },
        { keys: [], run: () => deps.automations.deleteAutomation(task), command: { id: `${action.id}:delete`, title: `Delete automation: ${task.title}`, keywords: ["scheduled", "task", "remove"] } },
      ];
    }),
  );
  /** While the panel has the keys. */
  const focused = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => move(1), hint: "move" },
    { keys: ["k", "↑"], run: () => move(-1) },
    {
      keys: ["enter", "space"],
      run: () => {
        const action = selectedAction();
        if (action) activate(action);
      },
      hint: "open",
    },
    {
      keys: ["t"],
      run: () => {
        const action = selectedAction();
        if (action?.kind === "automation") toggleAutomation(action.task);
      },
      hint: "toggle automation",
    },
    { keys: ["esc"], run: () => (deps.diff ? setDiff(null) : leave()), hint: "back" },
    { keys: ["h", "←"], run: leave },
  );

  return { show, setPref, cwd, details, loading: vcsState?.status !== "live", selected, activateById, leave, keys: { focus: focusKey, toggle: toggleKey, commands, focused } };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
