import type { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  buildPendingUserInputAnswers,
  resolvePendingUserInputAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import { threadChipCopyTarget } from "@t3tools/client-runtime/thread-reference";
import { DEFAULT_TERMINAL_ID, type ContextMenuItem, type DiscoveredLocalServer, type ModelSelection, type OrchestrationV2ThreadShell, type ProviderApprovalDecision, type ScheduledTask, type TerminalSummary, type ThreadId } from "@t3tools/contracts";
import { homedir } from "node:os";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ComposerContextRecord, OrchestrationMessageContext, ProjectEntry } from "@t3tools/contracts";
import type { FeedState, ServerConfigState, ShellState, T3Session, ThreadState, VcsState } from "../client/session.ts";
import { createAlerts, type Alert } from "../model/alerts.ts";
import { applyComposerItem, composerTrigger, cursorAtIndex, indexAtCursor, messageContext, PATH_SEARCH_LIMIT, pathItems, skillItems, slashItems, threadItems, type ComposerItem } from "../model/composerMenu.ts";
import { parseSnooze, pickSnooze, threadHasRuntime, threadMenu, topPinOrderKey, type ThreadActionMenuId } from "../model/threadMenu.ts";
import { draftDefaults, lockedProviderInstance, modelSummary, optionDescriptors, optionValue, optionValueLabel, providerName, RUNTIME_MODES, sameSelection, selectableProviders, withModel, withOption, type DraftThread } from "../model/models.ts";
import { configPath, cycleConfig, saveConfig, type Tui3Config } from "../config.ts";
import { detailsActions, detailsCwd, RUNTIME_MODE_LABELS, threadDetails, type DetailsAction, type GitAction } from "../model/details.ts";
import { paletteEntries, paletteGroups, pickerGroups, type PaletteCommand, type Picker, type PickerItem } from "../model/palette.ts";
import { pullRequestRepository } from "../model/pullRequests.ts";
import { serverSettingLines, settingRows } from "../model/settings.ts";
import { buildTimeline, type Timeline } from "../model/timeline.ts";
import { threadRows, type Section } from "../model/threads.ts";
import { ComposerMenu } from "./ComposerMenu.tsx";
import { ConfirmBar, type Confirmation } from "./ConfirmBar.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { DiffView, type DiffState } from "./DiffView.tsx";
import { DraftView, type DraftLine } from "./DraftView.tsx";
import { editInEditor } from "./editor.ts";
import { Palette } from "./Palette.tsx";
import { QuestionPanel } from "./QuestionPanel.tsx";
import { PullRequestView } from "./PullRequestView.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { useComposerPullRequests, usePullRequests } from "./usePullRequests.ts";
import { attachTerminal } from "./terminalAttach.ts";
import { copyText, desktopNotify, ring } from "./terminalOut.ts";
import { colors } from "./theme.ts";
import { ThreadList } from "./ThreadList.tsx";
import { ThreadView } from "./ThreadView.tsx";

/**
 * "input": typing goes to the composer. "nav": single keys move, scroll, approve.
 * "details": j/k move through the details panel. "settings": j/k move through settings.
 * The rest are overlays with their own input.
 */
type Mode = "input" | "nav" | "filter" | "details" | "palette" | "picker" | "confirm" | "settings" | "pull-request";

/** Holding j/k skims past threads; only subscribe to one you stop on. */
const SUBSCRIBE_DELAY_MS = 120;
/** Opening a thread marks it read once you've stayed this long, as in the web app. */
const VISIT_DELAY_MS = 1_500;
const MAX_COMPOSER_LINES = 8;
/** Sections folded to a count unless you filter or press z, like the web sidebar's. */
const FOLDED_SECTIONS: readonly Section[] = ["snoozed", "settled"];
/** The details column opens by itself on terminals at least this wide. */
const DETAILS_AUTO_WIDTH = 160;
const DETAILS_WIDTH = 38;
/** Below this, the details panel takes the conversation's place instead of a column beside it. */
const MIN_CONVERSATION_WIDTH = 70;

const COMPOSER_KEYS = {
  enter: [
    { name: "return", action: "submit" },
    { name: "return", shift: true, action: "newline" },
  ],
  "ctrl-enter": [
    { name: "return", action: "newline" },
    { name: "return", ctrl: true, action: "submit" },
    { name: "return", shift: true, action: "newline" },
  ],
} as const;
/** The composer's key while a new thread is being drafted. */
const DRAFT_KEY = "draft";

interface QuestionDraft {
  readonly index: number;
  readonly answers: Record<string, PendingUserInputDraftAnswer>;
}

export function App(props: { readonly session: T3Session; readonly config: Tui3Config; readonly attachThreadId?: ThreadId }) {
  const { session, attachThreadId } = props;
  const attached = attachThreadId !== undefined;
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [shell, setShell] = useState<ShellState>(session.getShell());
  // Any thread, listed or not: subagents open here too.
  const [selectedId, setSelectedId] = useState<ThreadId | undefined>(attachThreadId);
  const [mode, setMode] = useState<Mode>(attached ? "input" : "nav");
  const [filter, setFilter] = useState("");
  const [showFolded, setShowFolded] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  /** null follows the terminal width; d sets it for the rest of the session. */
  const [detailsPref, setDetailsPref] = useState<boolean | null>(null);
  const [detailsSelected, setDetailsSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [config, setConfig] = useState(props.config);
  const [settingsIndex, setSettingsIndex] = useState<number | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfigState | null>(null);
  /** A new thread before its first message; the composer sends it. */
  const [draft, setDraft] = useState<DraftThread | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  /** Model changes waiting for each thread's next message, as the web composer holds them. */
  const [pendingModels, setPendingModels] = useState<ReadonlyMap<ThreadId, ModelSelection>>(new Map());
  const [terminals, setTerminals] = useState<FeedState<TerminalSummary> | null>(null);
  /** Idle subagents the shell leaves out, fetched when you open one. */
  const [familyShells, setFamilyShells] = useState<ReadonlyMap<ThreadId, OrchestrationV2ThreadShell>>(new Map());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [composerLines, setComposerLines] = useState(1);
  const [composerEmpty, setComposerEmpty] = useState(true);
  /** The composer's text and cursor (a string index), for the / $ @ menu. */
  const [composerState, setComposerState] = useState({ text: "", cursor: 0 });
  const [menuIndex, setMenuIndex] = useState(0);
  /** The trigger esc closed the menu for; typing on reopens it. */
  const [menuDismissed, setMenuDismissed] = useState<string | null>(null);
  const [pathResults, setPathResults] = useState<{ key: string; entries: readonly ProjectEntry[] } | null>(null);
  /** Mentions per composer (threads, pull requests), sent as the message's context. */
  const mentions = useRef(new Map<string, Map<string, ComposerContextRecord>>());
  const [questionDrafts, setQuestionDrafts] = useState<ReadonlyMap<string, QuestionDraft>>(new Map());
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const composerRef = useRef<TextareaRenderable | null>(null);
  const drafts = useRef(new Map<string, string>());
  /** Where mode returns to when an overlay closes. */
  const returnMode = useRef<Mode>("nav");

  useEffect(() => session.onShell(setShell), [session]);
  // Alerts, from the shell as the web's notification coordinator computes them.
  const onAlert = useRef<(alert: Alert) => void>(() => {});
  const alerts = useMemo(() => createAlerts((alert) => onAlert.current(alert)), []);
  useEffect(() => {
    if (shell.status.type === "live" && shell.snapshot) alerts.observe(shell.snapshot);
    else alerts.clear();
  }, [alerts, shell.status.type, shell.snapshot]);
  // Desktop notifications only while the terminal is in the background, as the web's need an unfocused window.
  const terminalFocused = useRef(true);
  useEffect(() => {
    const onFocus = () => (terminalFocused.current = true);
    const onBlur = () => (terminalFocused.current = false);
    renderer.on("focus", onFocus);
    renderer.on("blur", onBlur);
    return () => {
      renderer.off("focus", onFocus);
      renderer.off("blur", onBlur);
    };
  }, [renderer]);
  // Drives "Working for 12s" and the sidebar's durations.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const allRows = useMemo(() => threadRows(shell.snapshot, { query: filter }), [shell.snapshot, filter]);
  const unfold = showFolded || filter.trim() !== "";
  const rows = useMemo(() => (unfold ? allRows : allRows.filter((row) => !FOLDED_SECTIONS.includes(row.section))), [allRows, unfold]);
  const collapsed = useMemo(
    () => new Map(unfold ? [] : FOLDED_SECTIONS.map((section) => [section, allRows.filter((row) => row.section === section).length] as const)),
    [allRows, unfold],
  );
  // Selection is a thread id, not an index, so the list can reorder underneath it.
  const threadId = selectedId ?? rows[0]?.thread.id;
  const selectedIndex = rows.findIndex((row) => row.thread.id === threadId);
  const threadRow = allRows.find((row) => row.thread.id === threadId);
  const threadShell = threadRow?.thread ?? shell.snapshot?.threads.find((thread) => thread.id === threadId) ?? (threadId ? familyShells.get(threadId) : undefined);
  const composerKey: string = draft ? DRAFT_KEY : (threadId ?? "");
  // Pin the initial selection to a thread, or it would follow whatever sorts first.
  useEffect(() => {
    if (selectedId === undefined && rows[0]) setSelectedId(rows[0].thread.id);
  }, [selectedId, rows]);

  /** A thread you marked unread, left unread until you open it again. */
  const noVisit = useRef<ThreadId | null>(null);
  const openThread = useCallback((id: ThreadId) => {
    noVisit.current = null;
    setSelectedId(id);
    setDiff(null);
    setSettingsIndex(null);
    setDraft(null);
    setDetailsSelected(null);
    setMode((current) => (current === "details" || current === "settings" || current === "pull-request" ? "nav" : current));
  }, []);

  const [watchedId, setWatchedId] = useState(threadId);
  useEffect(() => {
    if (threadId === watchedId) return;
    const timer = setTimeout(() => setWatchedId(threadId), SUBSCRIBE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [threadId, watchedId]);

  const [thread, setThread] = useState<ThreadState | null>(null);
  useEffect(() => {
    setThread(null);
    if (!watchedId || shell.status.type !== "live") return;
    return session.watchThread(watchedId, setThread);
  }, [session, watchedId, shell.status.type]);

  const unread = threadRow?.unread === true;
  useEffect(() => {
    if (!watchedId || !unread || noVisit.current === watchedId) return;
    const timer = setTimeout(() => void session.visit(watchedId).catch(() => {}), VISIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [session, watchedId, unread]);

  const previousTimeline = useRef<{ id: string; timeline: Timeline } | null>(null);
  const timeline = useMemo(() => {
    if (!thread?.projection || !watchedId) return null;
    const previous = previousTimeline.current?.id === watchedId ? previousTimeline.current.timeline : null;
    const next = buildTimeline(thread.projection, { expandAll }, previous);
    previousTimeline.current = { id: watchedId, timeline: next };
    return next;
  }, [thread?.projection, watchedId, expandAll]);
  const current = watchedId === threadId ? timeline : null;
  const pendingApproval = current?.pending.approvals[0];
  const pendingInput = current?.pending.userInputs[0];
  const questionDraft = pendingInput ? (questionDrafts.get(pendingInput.requestId) ?? { index: 0, answers: {} }) : undefined;
  const working = current?.isWorking ?? false;

  // A thread opens at its latest message: once its first snapshot renders, jump to the bottom.
  const loaded = current !== null;
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => scrollRef.current?.scrollTo(scrollRef.current.scrollHeight), 0);
    return () => clearTimeout(timer);
  }, [loaded, watchedId]);

  const projection = watchedId === threadId ? thread?.projection : null;
  const appThread = projection?.thread;
  const title = threadShell?.title ?? appThread?.title ?? "Thread";
  const parentId = (threadShell?.lineage ?? appThread?.lineage)?.parentThreadId ?? null;
  const parent = parentId
    ? { threadId: parentId, title: (shell.snapshot?.threads.find((other) => other.id === parentId) ?? familyShells.get(parentId))?.title ?? "Parent thread" }
    : undefined;

  const move = (delta: number) => {
    // From a subagent, which isn't listed, j/k carry on from its parent's row.
    const parentIndex = rows.findIndex((row) => row.thread.id === parentId);
    const from = selectedIndex >= 0 ? selectedIndex : parentIndex >= 0 ? parentIndex : delta > 0 ? -1 : rows.length;
    const next = rows[Math.min(rows.length - 1, Math.max(0, from + delta))];
    if (next) openThread(next.thread.id);
  };

  // Details: git status for the thread's folder, plus the server-wide servers and automations lists.
  const showDetails = detailsPref ?? width >= DETAILS_AUTO_WIDTH;
  const project = threadShell ? shell.snapshot?.projects.find((candidate) => candidate.id === threadShell.projectId) : undefined;
  const vcsCwd = threadShell ? detailsCwd(threadShell, project) : null;
  const live = shell.status.type === "live";
  useEffect(() => (live ? session.watchServerConfig(setServerConfig) : undefined), [session, live]);
  useEffect(() => (live ? session.watchTerminals(setTerminals) : undefined), [session, live]);
  // An idle subagent isn't in the shell; its family (root, forks, all subagents) is, on servers that serve it.
  const supportsFamilies = serverConfig?.config?.shellThreadFamilies === true;
  const unlisted = threadId !== undefined && !threadShell;
  useEffect(() => {
    if (!unlisted || !threadId || !supportsFamilies || !live) return;
    let cancelled = false;
    session.threadFamily(threadId).then(
      (threads) => {
        if (cancelled) return;
        setFamilyShells((previous) => {
          const next = new Map(previous);
          for (const member of threads) next.set(member.id, member);
          return next;
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [session, unlisted, threadId, supportsFamilies, live]);
  const [vcs, setVcs] = useState<{ cwd: string; state: VcsState } | null>(null);
  useEffect(() => {
    if (!showDetails || !vcsCwd || !live) return;
    return session.watchVcs(vcsCwd, (state) => setVcs({ cwd: vcsCwd, state }));
  }, [session, showDetails, vcsCwd, live]);
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
  const vcsState = vcs?.cwd === vcsCwd ? vcs.state : null;
  // Fetched family members count as shell threads, so lineage can name idle subagents.
  const detailsSnapshot = useMemo(() => {
    const snapshot = shell.snapshot;
    if (!snapshot || familyShells.size === 0) return snapshot;
    const listed = new Set(snapshot.threads.map((member) => member.id));
    return { ...snapshot, threads: [...snapshot.threads, ...[...familyShells.values()].filter((member) => !listed.has(member.id))] };
  }, [shell.snapshot, familyShells]);
  const details = useMemo(
    () =>
      threadShell
        ? threadDetails({
            thread: threadShell,
            project,
            vcs: vcsState,
            snapshot: detailsSnapshot,
            subagents: projection?.subagents ?? [],
            servers: servers?.items ?? [],
            automations: automations?.items ?? [],
            now,
            timestampFormat: config.timestampFormat,
          })
        : null,
    [threadShell, project, vcsState, detailsSnapshot, projection?.subagents, servers, automations, now, config.timestampFormat],
  );
  const actions = useMemo(() => (details ? detailsActions(details) : []), [details]);

  const say = (text: string, bad = false) => {
    setFlash({ text, bad });
    setTimeout(() => setFlash((value) => (value?.text === text ? null : value)), 4000);
  };
  const run = (label: string, action: () => Promise<unknown>) => {
    action().then(
      () => say(label),
      (error) => say(`${label} failed: ${messageOf(error)}`, true),
    );
  };
  onAlert.current = (alert) => {
    const mode = config.notificationMode;
    if (mode === "sound" || mode === "notifications-and-sound") ring();
    const viewing = alert.thread.id === threadId;
    if (terminalFocused.current) {
      if (config.inAppNotificationsEnabled && !viewing) say(`${alert.title}: ${alert.thread.title}`, alert.status === "failed" || alert.status === "limited");
    } else if (mode === "notifications" || mode === "notifications-and-sound") {
      desktopNotify(alert.title, alert.thread.title);
    }
  };

  const respond = (decision: ProviderApprovalDecision) => {
    if (!threadId || !pendingApproval) return say("Nothing is waiting for approval.", true);
    run(decision === "decline" ? "Declined" : "Approved", () => session.respond(threadId, pendingApproval.requestId, decision));
  };

  const confirm = (next: Confirmation) => {
    if (mode !== "confirm" && mode !== "palette") returnMode.current = mode;
    setConfirmMessage("");
    setConfirmation(next);
    setMode("confirm");
  };
  const closeOverlay = () => {
    setConfirmation(null);
    setMode(returnMode.current);
  };

  const openDiff = (path: string | null) => {
    if (!vcsCwd) return;
    const cwd = vcsCwd;
    setDiff({ cwd, path, status: "loading" });
    session.workingTreeDiff(cwd, path ?? undefined, config.diffIgnoreWhitespace).then(
      (source) => setDiff((value) => (value?.cwd === cwd && value.path === path ? { cwd, path, status: "ready", patch: source?.diff ?? "", truncated: source?.truncated ?? false } : value)),
      (error) => setDiff((value) => (value?.cwd === cwd && value.path === path ? { cwd, path, status: "error", error: messageOf(error) } : value)),
    );
  };

  const runGit = (git: GitAction) => {
    if (!vcsCwd || !threadShell) return;
    const cwd = vcsCwd;
    const branch = details?.branch?.name;
    const onDefault = vcsState?.local?.isDefaultRef === true;
    confirm({
      title: `${git.label}?`,
      detail: `${branch ? `On ${branch}` : "In"} · ${details?.workspace.path ?? cwd}${onDefault && git.action !== "create_pr" ? " · this is the default branch" : ""}`,
      ...(git.commits ? { message: { placeholder: "Leave blank to have one written for you" } } : {}),
      confirmLabel: git.label.toLowerCase(),
      run: (message) => {
        say(`${git.label}…`);
        session
          .runGitAction(
            { cwd, action: git.action, threadId: threadShell.id, projectId: threadShell.projectId, ...(git.commits && message.trim() ? { commitMessage: message.trim() } : {}) },
            (event) => {
              if (event.kind === "phase_started") setFlash({ text: `${event.label}…` });
              if (event.kind === "hook_started") setFlash({ text: `Running ${event.hookName} hook…` });
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
    setDetailsSelected(action.id);
    switch (action.kind) {
      case "diff":
        return openDiff(action.path);
      case "git":
        return runGit(action.git);
      case "thread":
        return openThread(action.threadId);
      case "server":
        return stopServer(action.server);
      case "automation":
        return runAutomation(action.task);
    }
  };
  const activateById = (id: string) => {
    const action = actions.find((candidate) => candidate.id === id);
    if (!action) return;
    if (action.kind !== "thread") setMode("details");
    activate(action);
  };
  const moveDetails = (delta: number) => {
    if (actions.length === 0) return;
    const index = actions.findIndex((action) => action.id === detailsSelected);
    const next = actions[index < 0 ? (delta > 0 ? 0 : actions.length - 1) : Math.min(actions.length - 1, Math.max(0, index + delta))];
    if (next) setDetailsSelected(next.id);
  };
  const focusDetails = () => {
    if (!threadShell) return;
    if (!showDetails) setDetailsPref(true);
    if (!actions.some((action) => action.id === detailsSelected)) setDetailsSelected(actions[0]?.id ?? null);
    setMode("details");
  };

  // Pickers: the palette's overlay over a fixed list.
  const openPicker = (next: Picker) => {
    if (mode !== "picker" && mode !== "palette" && mode !== "confirm") returnMode.current = mode === "filter" || mode === "details" ? "nav" : mode;
    setPicker(next);
    setPickerQuery("");
    setPickerIndex(0);
    setMode("picker");
  };
  const pickerView = useMemo(() => (picker ? pickerGroups(picker, pickerQuery) : []), [picker, pickerQuery]);
  const pickerItems = useMemo(() => (picker ? picker.groups.flatMap((group) => group.items) : []), [picker]);
  const pickerEntries = paletteEntries(pickerView);
  const pickItem = (index: number) => {
    const entry = pickerEntries[index];
    if (entry?.kind !== "command") return;
    const item = pickerItems.find((candidate) => candidate.id === entry.command.id);
    setPicker(null);
    setMode(returnMode.current);
    item?.run();
  };

  // Model, options and mode: for the draft, or for the open thread (sent with its next message).
  const providerConfig = serverConfig?.config ?? null;
  const currentModel: ModelSelection | null = draft ? draft.modelSelection : threadShell ? (pendingModels.get(threadShell.id) ?? threadShell.modelSelection) : null;
  const setModel = (selection: ModelSelection) => {
    if (draft) return setDraft({ ...draft, modelSelection: selection });
    if (!threadShell) return;
    const id = threadShell.id;
    const same = sameSelection(providerConfig, selection, threadShell.modelSelection);
    setPendingModels((previous) => {
      const next = new Map(previous);
      if (same) next.delete(id);
      else next.set(id, selection);
      return next;
    });
  };
  const runtimeMode = draft ? draft.runtimeMode : threadShell?.runtimeMode;
  const setRuntime = (next: (typeof RUNTIME_MODES)[number]) => {
    if (draft) return setDraft({ ...draft, runtimeMode: next });
    if (threadShell) run(`Mode: ${RUNTIME_MODE_LABELS[next] ?? next}`, () => session.setRuntimeMode(threadShell.id, next));
  };
  const openModelPicker = () => {
    const selection = currentModel;
    if (!selection) return;
    if (!providerConfig) return say("Still loading the server's providers.", true);
    // A started thread stays on its provider unless the provider supports handing over.
    const locked = draft ? null : lockedProviderInstance(projection);
    const groups: { label: string; items: PickerItem[] }[] = [];
    for (const provider of selectableProviders(providerConfig)) {
      if (locked && provider.instanceId !== locked) continue;
      groups.push({
        label: providerName(provider),
        items: provider.models
          .filter((model) => !model.isLegacy || model.slug === selection.model)
          .map((model) => ({
            id: `model:${provider.instanceId}:${model.slug}`,
            title: model.name,
            ...(provider.instanceId === selection.instanceId && model.slug === selection.model ? { hint: "current" } : {}),
            run: () => setModel(withModel(providerConfig, selection, provider.instanceId, model.slug)),
          })),
      });
    }
    const options: PickerItem[] = optionDescriptors(providerConfig, selection).map((descriptor) => ({
      id: `option:${descriptor.id}`,
      title: `${descriptor.label}: ${optionValueLabel(descriptor, optionValue(selection, descriptor))}`,
      run: () => {
        if (descriptor.type === "boolean") return setModel(withOption(selection, descriptor.id, optionValue(selection, descriptor) !== true));
        openPicker({
          placeholder: descriptor.label,
          groups: [
            {
              label: descriptor.label,
              items: descriptor.options.map((choice) => ({
                id: `choice:${choice.id}`,
                title: choice.label,
                ...(choice.id === optionValue(selection, descriptor) ? { hint: "current" } : choice.description ? { hint: choice.description } : {}),
                run: () => setModel(withOption(selection, descriptor.id, choice.id)),
              })),
            },
          ],
        });
      },
    }));
    if (options.length > 0) groups.unshift({ label: "Options", items: options });
    if (runtimeMode) {
      groups.unshift({
        label: "Mode",
        items: RUNTIME_MODES.map((candidate) => ({
          id: `mode:${candidate}`,
          title: RUNTIME_MODE_LABELS[candidate] ?? candidate,
          ...(candidate === runtimeMode ? { hint: "current" } : {}),
          run: () => setRuntime(candidate),
        })),
      });
    }
    openPicker({ placeholder: locked ? "Model, options and mode (this thread stays on its provider)" : "Model, options and mode", groups });
  };

  // New threads, as the web's: a local draft that becomes a thread when its first message is sent.
  /** The web sidebar's thread menu as a picker: separators become groups, submenus open their own picker. */
  const openThreadMenu = (target: OrchestrationV2ThreadShell) => {
    const menu = threadMenu({ thread: target, config: providerConfig, timestampFormat: config.timestampFormat });
    const toPicker = (title: string, items: readonly ContextMenuItem<ThreadActionMenuId>[]): Picker => {
      const groups: { label: string; items: PickerItem[] }[] = [{ label: title, items: [] }];
      for (const item of items) {
        if (item.separatorBefore && groups[groups.length - 1]!.items.length > 0) groups.push({ label: "", items: [] });
        const hint = item.disabled ? "unavailable" : item.checked ? "current" : item.children ? "›" : undefined;
        groups[groups.length - 1]!.items.push({
          id: `thread-menu:${item.id}`,
          title: item.label,
          ...(hint ? { hint } : {}),
          run: () => {
            if (item.disabled) return say(`${item.label} is unavailable for this thread right now.`, true);
            if (item.children) return openPicker(toPicker(`${target.title || "New thread"} › ${item.label}`, item.children));
            runThreadAction(target, item.id, menu.snoozePresets);
          },
        });
        // A submenu's items are found by typing at the top too: "thread id" finds Copy › Thread ID.
        for (const child of item.disabled ? [] : (item.children ?? [])) {
          if (child.disabled) continue;
          groups[groups.length - 1]!.items.push({ id: `thread-menu:${child.id}`, title: `${item.label} › ${child.label}`, ...(child.checked ? { hint: "current" } : {}), searchOnly: true, run: () => runThreadAction(target, child.id, menu.snoozePresets) });
        }
      }
      return { placeholder: "Thread actions", groups };
    };
    openPicker(toPicker(target.title || "New thread", menu.items));
  };
  const openSelectedThreadMenu = () => threadShell && openThreadMenu(threadShell);

  const runThreadAction = (target: OrchestrationV2ThreadShell, action: ThreadActionMenuId, snoozePresets: ReturnType<typeof threadMenu>["snoozePresets"]) => {
    const id = target.id;
    const title = target.title || "New thread";
    const leave = () => {
      if (threadId === id) setSelectedId(undefined);
    };
    if (action === "snooze:custom") {
      confirm({
        title: `Snooze "${title}"`,
        detail: "For a while (45m, 3h, 2d, 1w) or until a time (17:30).",
        message: { placeholder: "3h" },
        confirmLabel: "snooze",
        run: (text) => {
          const wake = parseSnooze(text);
          if (!wake) return say("Type a duration like 3h or 2d, or a time like 17:30.", true);
          run(`Snoozed until ${wake.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`, () => session.snoozeThread(id, wake.toISOString()));
        },
      });
      return;
    }
    if (action.startsWith("snooze:")) {
      const preset = pickSnooze(snoozePresets, action.slice("snooze:".length), providerConfig, config.timestampFormat);
      if (!preset) return say("That snooze time has passed. Choose another time.", true);
      return run(`Snoozed until ${preset.whenLabel}`, () => session.snoozeThread(id, preset.snoozedUntil));
    }
    switch (action) {
      case "settle":
        return run("Settled", () => session.settleThread(id));
      case "unsettle":
        return run("Un-settled", () => session.unsettleThread(id));
      case "unsnooze":
        return run("Woke the thread", () => session.unsnoozeThread(id));
      case "pin":
        return run("Pinned", () => session.pinThread(id, topPinOrderKey(shell.snapshot)));
      case "unpin":
        return run("Unpinned", () => session.unpinThread(id));
      case "auto-settle:enabled":
      case "auto-settle:disabled":
        return run(action === "auto-settle:enabled" ? "Auto-settle on" : "Auto-settle off", () => session.setAutoSettle(id, action === "auto-settle:enabled"));
      case "regenerate-title":
        return run("Regenerating the title", () => session.regenerateTitle(id));
      case "mark-unread":
        // Opening a thread marks it read; stay unread until you open it again.
        noVisit.current = id;
        return run("Marked unread", () => session.markUnread(id));
      case "rename":
        confirm({
          title: "Rename thread",
          message: { placeholder: title },
          confirmLabel: "rename",
          run: (text) => {
            const next = text.trim();
            if (next && next !== target.title) run("Renamed", () => session.renameThread(id, next));
          },
        });
        setConfirmMessage(target.title);
        return;
      case "new-thread-on-branch": {
        const project = shell.snapshot?.projects.find((candidate) => candidate.id === target.projectId);
        if (!project) return say("The thread's project is gone.", true);
        setDraft({
          ...draftDefaults({ config: providerConfig, project, currentModel: target.modelSelection, projectHasThreads: true }),
          envMode: target.worktreePath ? "worktree" : "local",
          ...(target.worktreePath ? { existingWorktree: { path: target.worktreePath, branch: target.branch } } : {}),
        });
        setDiff(null);
        setSettingsIndex(null);
        setMode("input");
        return;
      }
      case "copy-path": {
        const path = target.worktreePath ?? shell.snapshot?.projects.find((candidate) => candidate.id === target.projectId)?.workspaceRoot;
        if (!path) return say("This thread does not have a workspace path to copy.", true);
        copyText(renderer, path);
        return say(`Path copied: ${path}`);
      }
      case "copy-branch":
        if (!target.branch) return;
        copyText(renderer, target.branch);
        return say(`Branch copied: ${target.branch}`);
      case "copy-thread": {
        const environmentId = providerConfig?.environment.environmentId;
        if (!environmentId) return say("Server details are still loading.", true);
        copyText(renderer, threadChipCopyTarget({ environmentId, threadId: id }, title).value);
        return say(`Thread copied: ${title}`);
      }
      case "copy-thread-id":
        copyText(renderer, id);
        return say(`Thread ID copied: ${id}`);
      case "archive":
        return run("Archived", async () => {
          await session.archiveThread(id);
          leave();
        });
      case "delete":
        // The web confirms deletes by default (confirmThreadDelete).
        confirm({
          title: `Delete thread "${title}"?`,
          detail: `This permanently clears conversation history for this thread.${target.worktreePath ? " Its worktree stays on disk." : ""}`,
          confirmLabel: "delete",
          run: () =>
            run("Deleted", async () => {
              await session.deleteThread(id, threadHasRuntime(target, providerConfig));
              leave();
            }),
        });
        return;
      default:
        return;
    }
  };

  const startDraft = () => {
    const projects = shell.snapshot?.projects ?? [];
    const project = projects.find((candidate) => candidate.id === threadShell?.projectId) ?? projects[0];
    if (!project) return say("No projects on this server yet; add one in T3 Code.", true);
    setDraft(
      draftDefaults({
        config: providerConfig,
        project,
        currentModel: threadShell?.modelSelection ?? null,
        projectHasThreads: shell.snapshot?.threads.some((candidate) => candidate.projectId === project.id) ?? false,
      }),
    );
    setDiff(null);
    setSettingsIndex(null);
    setMode("input");
  };
  const draftProject = draft ? shell.snapshot?.projects.find((candidate) => candidate.id === draft.projectId) : undefined;
  const openProjectPicker = () => {
    if (!draft) return;
    openPicker({
      placeholder: "Project",
      groups: [
        {
          label: "Projects",
          items: (shell.snapshot?.projects ?? []).map((candidate) => ({
            id: `project:${candidate.id}`,
            title: candidate.title,
            hint: candidate.id === draft.projectId ? "current" : candidate.workspaceRoot.replace(homedir(), "~"),
            run: () =>
              setDraft(
                draftDefaults({
                  config: providerConfig,
                  project: candidate,
                  currentModel: draft.modelSelection,
                  projectHasThreads: shell.snapshot?.threads.some((member) => member.projectId === candidate.id) ?? false,
                }),
              ),
          })),
        },
      ],
    });
  };
  const toggleWorkspace = () => {
    if (!draft) return;
    const { existingWorktree: _, ...rest } = draft;
    setDraft({ ...rest, envMode: draft.existingWorktree ? "local" : draft.envMode === "local" ? "worktree" : "local" });
  };
  const launchDraft = (text: string, context?: OrchestrationMessageContext) => {
    if (!draft || !draftProject) return;
    const launching = draft;
    const project = draftProject;
    say("Starting thread…");
    void (async () => {
      let workspaceStrategy: { type: "root" } | { type: "existing_worktree"; worktreePath: string } | { type: "worktree"; baseRef: string; startFromOrigin?: boolean } = { type: "root" };
      if (launching.existingWorktree) workspaceStrategy = { type: "existing_worktree", worktreePath: launching.existingWorktree.path };
      else if (launching.envMode === "worktree") {
        // A worktree starts from the default branch; outside a git repository it runs in place, as the web's.
        const refs = await session.defaultRef(project.workspaceRoot);
        if (refs.isRepo && refs.ref) workspaceStrategy = { type: "worktree", baseRef: refs.ref.name, startFromOrigin: providerConfig?.settings.newWorktreesStartFromOrigin ?? true };
      }
      return session.launchThread({
        projectId: launching.projectId,
        title: deriveThreadTitleSeed({ text, attachments: [] }),
        generateTitle: true,
        modelSelection: launching.modelSelection,
        runtimeMode: launching.runtimeMode,
        interactionMode: "default",
        workspaceStrategy,
        text,
        context,
      });
    })().then(
      (id) => {
        drafts.current.delete(DRAFT_KEY);
        openThread(id);
        say("Thread started");
      },
      (error) => say(`Could not start the thread: ${messageOf(error)}`, true),
    );
  };

  // The thread's terminals, as the web's terminal drawer: attach to one, or open the first.
  const threadTerminals = threadShell ? (terminals?.items ?? []).filter((terminal) => terminal.threadId === threadShell.id) : [];
  const enterTerminal = (terminal: { terminalId: string; cwd: string; worktreePath: string | null; label?: string }) => {
    if (!threadShell) return;
    attachTerminal(renderer, session, { threadId: threadShell.id, terminalId: terminal.terminalId, cwd: terminal.cwd, worktreePath: terminal.worktreePath, label: terminal.label || terminal.terminalId }, (message) => {
      if (message) say(message, true);
    });
  };
  const openTerminal = () => {
    if (!threadShell) return say("Open a thread first.", true);
    const cwd = threadShell.worktreePath ?? project?.workspaceRoot;
    if (!cwd) return say("This thread has no folder to open a terminal in.", true);
    const fresh = (id: string) => ({ terminalId: id, cwd, worktreePath: threadShell.worktreePath });
    if (threadTerminals.length === 0) return enterTerminal(fresh(DEFAULT_TERMINAL_ID));
    if (threadTerminals.length === 1 && threadTerminals[0]) return enterTerminal(threadTerminals[0]);
    const taken = new Set(threadTerminals.map((terminal) => terminal.terminalId));
    let next = 1;
    while (taken.has(`term-${next}`)) next += 1;
    openPicker({
      placeholder: "Terminal",
      groups: [
        {
          label: "Terminals",
          items: threadTerminals.map((terminal) => ({
            id: `terminal:${terminal.terminalId}`,
            title: terminal.label || terminal.terminalId,
            hint: terminal.status === "running" ? (terminal.hasRunningSubprocess ? "busy" : "running") : terminal.status,
            run: () => enterTerminal(terminal),
          })),
        },
        { label: "New", items: [{ id: "terminal:new", title: "New terminal", run: () => enterTerminal(fresh(`term-${next}`)) }] },
      ],
    });
  };

  /** The composer's text in $EDITOR. */
  const openEditor = () => {
    const composer = composerRef.current;
    if (!composer) return;
    const edited = editInEditor(renderer, composer.plainText);
    if (edited === null) return say("The editor exited with an error; the message is unchanged.", true);
    composer.setText(edited);
    composer.gotoBufferEnd();
    setMode("input");
  };

  const settingsRows = settingRows(config);
  const cycleSetting = (index: number) => {
    const row = settingsRows[index];
    if (!row) return;
    setSettingsIndex(index);
    const next = cycleConfig(config, row.key);
    setConfig(next);
    saveConfig(next).catch((error) => say(`Could not save settings: ${messageOf(error)}`, true));
  };
  const openSettings = () => {
    setDiff(null);
    setSettingsIndex(0);
    setMode("settings");
  };
  const closeSettings = () => {
    setSettingsIndex(null);
    setMode("nav");
  };

  const clearComposer = () => {
    composerRef.current?.setText("");
    if (threadId) drafts.current.delete(threadId);
    mentions.current.delete(composerKey);
    setComposerLines(1);
    setComposerEmpty(true);
  };

  /** Moves the question flow on: the next question, or the answers once all are in. */
  const advanceQuestion = (draft: QuestionDraft) => {
    if (!threadId || !pendingInput) return;
    const question = pendingInput.questions[draft.index];
    if (!question || resolvePendingUserInputAnswer(question, draft.answers[question.id]) === null) {
      setQuestionDrafts((map) => new Map(map).set(pendingInput.requestId, draft));
      return say("Pick an option or type an answer.", true);
    }
    if (draft.index + 1 < pendingInput.questions.length) {
      setQuestionDrafts((map) => new Map(map).set(pendingInput.requestId, { ...draft, index: draft.index + 1 }));
      return;
    }
    const answers = buildPendingUserInputAnswers(pendingInput.questions, draft.answers);
    if (!answers) return say("Some questions are unanswered.", true);
    setQuestionDrafts((map) => new Map(map).set(pendingInput.requestId, draft));
    run("Answered", () => session.answer(threadId, pendingInput.requestId, answers));
  };

  const pickOption = (optionIndex: number) => {
    if (!pendingInput || !questionDraft) return;
    const question = pendingInput.questions[questionDraft.index];
    const option = question?.options[optionIndex];
    if (!question || !option) return;
    const draft = { ...questionDraft, answers: { ...questionDraft.answers, [question.id]: togglePendingUserInputOptionSelection(question, questionDraft.answers[question.id], option.value ?? option.label) } };
    setQuestionDrafts((map) => new Map(map).set(pendingInput.requestId, draft));
    // Single choice moves on by itself, after a beat to show the pick.
    if (!question.multiSelect) setTimeout(() => advanceQuestion(draft), 200);
  };

  /** Enter in the composer; `alternate` is alt+enter, which flips steer and queue. */
  const submit = (alternate = false) => {
    const composer = composerRef.current;
    const raw = composer?.plainText ?? "";
    // A trailing backslash continues onto a new line, for terminals that can't send shift+enter.
    if (!alternate && config.sendShortcut === "enter" && composer && raw.endsWith("\\")) {
      composer.setText(raw.slice(0, -1));
      composer.gotoBufferEnd();
      composer.newLine();
      return;
    }
    const text = raw.trim();
    const context = messageContext(text, mentions.current.get(composerKey) ?? new Map());
    if (draft) {
      if (!text) return;
      clearComposer();
      return launchDraft(text, context);
    }
    if (!threadId) return;
    if (pendingInput && questionDraft) {
      const question = pendingInput.questions[questionDraft.index];
      if (!question) return;
      const answer = text ? setPendingUserInputCustomAnswer(question, questionDraft.answers[question.id], text) : questionDraft.answers[question.id];
      clearComposer();
      return advanceQuestion({ ...questionDraft, answers: { ...questionDraft.answers, ...(answer ? { [question.id]: answer } : {}) } });
    }
    if (!text) return;
    clearComposer();
    if (pendingApproval) {
      // As in the web composer: the message declines the request and redirects the agent.
      if (pendingApproval.supportsFeedback) return run("Declined with feedback", () => session.respond(threadId, pendingApproval.requestId, "decline", text));
      return run("Declined and redirected", () => session.sendMessage(threadId, text, "steer", undefined, context));
    }
    const dispatchMode = resolveComposerDispatchMode({ running: working, alternateModifier: alternate, activeTurnDefault: config.followUpBehavior });
    const pendingModel = pendingModels.get(threadId);
    if (pendingModel) {
      setPendingModels((previous) => {
        const next = new Map(previous);
        next.delete(threadId);
        return next;
      });
    }
    run(dispatchMode === "queue" ? "Queued" : dispatchMode === "steer" ? "Steered" : "Sent", () => session.sendMessage(threadId, text, dispatchMode, pendingModel, context));
  };

  const loadEarlier = () => {
    if (!watchedId) return;
    session.loadEarlier(watchedId).catch((error) => say(`Could not load earlier turns: ${messageOf(error)}`, true));
  };

  const quit = () => {
    void session.stop().finally(() => {
      renderer.destroy();
      process.exit(0);
    });
  };

  const scrollPage = (direction: 1 | -1) => scrollRef.current?.scrollBy(direction * Math.max(1, height - 10));

  // Pull requests: the P view, link/unlink/watch, a draft checked out from one.
  const pullRequests = usePullRequests({
    session,
    renderer,
    threadShell,
    project: draft ? draftProject : project,
    projects: shell.snapshot?.projects ?? [],
    serverConfig: providerConfig,
    confirm,
    openPicker,
    say,
    run,
    showView: () => {
      setDiff(null);
      setSettingsIndex(null);
      setMode("pull-request");
    },
    hideView: () => setMode("nav"),
    startDraftFromPullRequest: (targetProject, prepared) => {
      setDraft({
        ...draftDefaults({
          config: providerConfig,
          project: targetProject,
          currentModel: threadShell?.modelSelection ?? null,
          projectHasThreads: shell.snapshot?.threads.some((candidate) => candidate.projectId === targetProject.id) ?? false,
        }),
        envMode: prepared.worktreePath ? "worktree" : "local",
        ...(prepared.worktreePath ? { existingWorktree: { path: prepared.worktreePath, branch: prepared.branch } } : {}),
      });
      setDiff(null);
      setSettingsIndex(null);
      setMode("input");
    },
  });

  // The command palette: everything the keys do, plus what the details panel offers.
  const commands: (PaletteCommand & { readonly run: () => void })[] = [];
  const command = (id: string, label: string, action: () => void, extra: Omit<PaletteCommand, "id" | "title"> = {}) => commands.push({ id, title: label, run: action, ...extra });
  if (pendingApproval) {
    command("approve", "Approve request", () => respond("accept"), { shortcut: "y" });
    command("approve-session", "Always allow this session", () => respond("acceptForSession"), { shortcut: "Y" });
    command("decline", "Decline request", () => respond("decline"), { shortcut: "n" });
  }
  if (threadId && pendingInput?.dismissible) command("dismiss", "Dismiss question", () => run("Dismissed", () => session.dismissQuestion(threadId, pendingInput.requestId)), { shortcut: "x" });
  if (threadId) command("type", "Write a message", () => setMode("input"), { shortcut: "i", keywords: ["compose", "send", "steer"] });
  if (threadId && working) command("stop", "Stop thread", () => run("Stop requested", () => session.stopThread(threadId)), { shortcut: "S", keywords: ["interrupt", "cancel"] });
  if (details?.changes && details.changes.files.length > 0) command("diff", "View uncommitted changes", () => openDiff(null), { keywords: ["diff", "changes"] });
  for (const action of actions) {
    if (action.kind === "git") command(action.id, `Git: ${action.git.label}`, () => runGit(action.git), { keywords: ["commit", "push", "pull request", "pr"] });
    if (action.kind === "server") command(action.id, `Stop server ${action.server.url}`, () => stopServer(action.server), { keywords: ["port", "kill"] });
    if (action.kind === "automation") {
      command(action.id, `Run automation: ${action.task.title}`, () => runAutomation(action.task), { keywords: ["scheduled", "task"] });
      command(`${action.id}:toggle`, `${action.task.enabled ? "Turn off" : "Turn on"} automation: ${action.task.title}`, () => toggleAutomation(action.task), { keywords: ["scheduled", "task", "enable", "disable"] });
    }
  }
  if (parent) command("parent", `Go to parent: ${parent.title}`, () => openThread(parent.threadId), { shortcut: "u" });
  command("details", showDetails ? "Hide thread details" : "Show thread details", () => setDetailsPref(!showDetails), { shortcut: "d", keywords: ["panel", "info"] });
  if (threadShell) command("focus-details", "Focus thread details", focusDetails, { shortcut: "l" });
  command("expand", expandAll ? "Collapse work" : "Expand all work", () => setExpandAll(!expandAll), { shortcut: "e", keywords: ["fold", "tool calls"] });
  if (thread?.history.hasMore) command("earlier", "Load earlier turns", loadEarlier, { shortcut: "o", keywords: ["history", "older"] });
  if (!attached) {
    command("filter", "Filter threads", () => setMode("filter"), { shortcut: "/", keywords: ["search"] });
    command("settled", showFolded ? "Hide settled threads" : "Show settled threads", () => setShowFolded(!showFolded), { shortcut: "z", keywords: ["snoozed", "archive"] });
  }
  if (threadShell) command("thread-menu", "Thread actions…", openSelectedThreadMenu, { shortcut: ".", keywords: ["settle", "pin", "snooze", "rename", "archive", "delete", "copy", "unread", "menu"] });
  command("new-thread", "New thread", startDraft, { shortcut: "c", keywords: ["create", "start", "chat"] });
  if (draft) {
    command("draft-project", "New thread: choose project", openProjectPicker, { shortcut: "p" });
    command("draft-workspace", draft.envMode === "local" && !draft.existingWorktree ? "New thread: use a new worktree" : "New thread: run in the project folder", toggleWorkspace, { shortcut: "w", keywords: ["worktree", "local", "branch"] });
    command("draft-cancel", "Cancel new thread", () => setDraft(null), { keywords: ["discard"] });
  }
  if (currentModel) command("model", "Change model, options or mode", openModelPicker, { shortcut: "m", keywords: ["provider", "thinking", "reasoning", "effort", "speed", "fast", "access", "approval"] });
  if (threadShell && !draft) command("terminal", "Open terminal", openTerminal, { shortcut: "ctrl+j", keywords: ["shell", "console"] });
  if (threadId || draft) command("editor", "Write the message in $EDITOR", openEditor, { shortcut: "ctrl+g", keywords: ["vim", "editor", "compose"] });
  for (const prCommand of pullRequests.commands) commands.push(prCommand);
  command("settings", "Settings", openSettings, { keywords: ["preferences", "config", "options", "notifications", "alerts"] });
  command("quit", "Quit tui3", quit, { shortcut: "q", keywords: ["exit"] });

  const commandKey = commands.map((candidate) => `${candidate.id}:${candidate.title}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- commands are rebuilt each render; commandKey tracks what changed.
  const groups = useMemo(() => (mode === "palette" ? paletteGroups({ query: paletteQuery, commands, snapshot: shell.snapshot, now }) : []), [mode, paletteQuery, commandKey, shell.snapshot]);
  const entries = paletteEntries(groups);
  const openPalette = () => {
    if (mode !== "palette" && mode !== "confirm") returnMode.current = mode === "filter" ? "nav" : mode;
    setPaletteQuery("");
    setPaletteIndex(0);
    setMode("palette");
  };
  const pick = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    setMode(returnMode.current === "details" ? "nav" : returnMode.current);
    if (entry.kind === "thread") return openThread(entry.threadId);
    commands.find((candidate) => candidate.id === entry.command.id)?.run();
  };

  /** Keys that work in every mode. Returns true when handled. */
  const globalKey = (key: KeyEvent): boolean => {
    if (key.ctrl && key.name === "c") return quit(), true;
    if (key.ctrl && key.name === "k") return openPalette(), true;
    if ((key.ctrl && key.name === "j") || key.name === "linefeed") return openTerminal(), true;
    if (key.ctrl && key.name === "g" && (threadId || draft)) return openEditor(), true;
    // One-line inputs keep ctrl+u and ctrl+d for editing.
    const lineInput = mode === "filter" || mode === "palette" || mode === "confirm";
    if (key.name === "pagedown" || (!lineInput && key.ctrl && key.name === "d")) return scrollPage(1), true;
    if (key.name === "pageup" || (!lineInput && key.ctrl && key.name === "u")) return scrollPage(-1), true;
    if (!attached && ((key.ctrl && key.name === "n") || (key.meta && key.name === "down"))) return move(1), true;
    if (!attached && ((key.ctrl && key.name === "p") || (key.meta && key.name === "up"))) return move(-1), true;
    if (mode === "input" && key.meta && key.name === "return") return submit(true), true;
    return false;
  };

  // The / $ @ # menu: the web composer's suggestions for the trigger under the cursor.
  const composerCwd = draft ? (draftProject?.workspaceRoot ?? null) : (threadShell?.worktreePath ?? project?.workspaceRoot ?? null);
  const composerProvider = currentModel ? providerConfig?.providers.find((candidate) => candidate.instanceId === currentModel.instanceId) : undefined;
  const trigger = mode === "input" && (threadId || draft) ? composerTrigger(composerState.text, composerState.cursor) : null;
  const triggerKey = trigger ? `${composerKey}:${trigger.kind}:${trigger.rangeStart}:${trigger.query}` : null;
  const pathKey = trigger?.kind === "path" && trigger.query.trim() && composerCwd ? `${composerCwd}\u0000${trigger.query.trim()}` : null;
  useEffect(() => {
    if (!pathKey) return;
    const [cwd, query] = pathKey.split("\u0000") as [string, string];
    // Debounced as the web's path search is.
    const timer = setTimeout(() => {
      session.searchEntries(cwd, query, PATH_SEARCH_LIMIT).then(
        (entries) => setPathResults({ key: pathKey, entries }),
        () => setPathResults({ key: pathKey, entries: [] }),
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [session, pathKey]);
  const composerPullRequests = useComposerPullRequests({
    session,
    query: trigger?.kind === "pull-request" ? trigger.query : null,
    projectId: providerConfig ? (draft ? draft.projectId : (threadShell?.projectId ?? null)) : null,
    repository: providerConfig ? pullRequestRepository(draft ? draftProject : project) : null,
    links: threadShell?.pullRequests,
  });
  const menu = ((): { items: ComposerItem[]; empty: string; loading: boolean } | null => {
    if (!trigger || triggerKey === menuDismissed) return null;
    switch (trigger.kind) {
      case "slash-command":
      case "slash-model":
        return { items: slashItems({ provider: composerProvider, cwd: composerCwd, text: composerState.text, trigger }), empty: "No matching command.", loading: false };
      case "skill":
        return { items: skillItems(composerProvider, composerCwd, trigger.query), empty: "No skills found. Try / to browse provider commands.", loading: false };
      case "path": {
        if (!trigger.query.trim()) return { items: [], empty: "Type to search files, folders and threads.", loading: false };
        const threads = threadItems({ snapshot: shell.snapshot, environmentId: providerConfig?.environment.environmentId ?? null, excludeThreadId: draft ? null : (threadId ?? null), query: trigger.query, now });
        const fresh = pathResults?.key === pathKey;
        return { items: [...threads, ...(fresh ? pathItems(pathResults.entries) : [])], empty: fresh ? "No matching files or folders." : "Searching…", loading: !fresh };
      }
      case "pull-request":
        return composerPullRequests;
      default:
        return null;
    }
  })();
  const menuOpen = menu !== null;
  const menuSelected = menu ? Math.min(menuIndex, Math.max(0, menu.items.length - 1)) : 0;
  useEffect(() => setMenuIndex(0), [triggerKey]);
  // A different composer (another thread, or the draft) mounts with its own text.
  useEffect(() => {
    const timer = setTimeout(syncComposerState, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncComposerState reads the ref.
  }, [composerKey]);
  const syncComposerState = () => {
    const composer = composerRef.current;
    if (!composer) return;
    const text = composer.plainText;
    const { row, col } = composer.logicalCursor;
    setComposerState({ text, cursor: indexAtCursor(text, row, col) });
  };
  const chooseMenuItem = (item: ComposerItem | undefined) => {
    const composer = composerRef.current;
    if (!item || !trigger || !composer) return;
    const next = applyComposerItem(composerState.text, trigger, item.replacement ?? "");
    composer.setText(next.text);
    const at = cursorAtIndex(next.text, next.cursor);
    composer.setCursor(at.row, at.col);
    if (item.record) {
      const records = mentions.current.get(composerKey) ?? new Map<string, ComposerContextRecord>();
      records.set(item.record.contextId, item.record);
      mentions.current.set(composerKey, records);
    }
    syncComposerState();
    setComposerLines(composerLineCount(composer));
    if (item.action === "model") openModelPicker();
  };
  /** Keys the menu takes while it's open; the rest go to the message box. */
  const menuKey = (key: KeyEvent): boolean => {
    if (!menu) return false;
    if (key.name === "escape") return setMenuDismissed(triggerKey), true;
    // Enter waits for a search in flight rather than sending the half-typed mention.
    if (menu.loading && key.name === "return") return true;
    if (menu.items.length === 0) return false;
    if (key.name === "down" || (key.ctrl && key.name === "n")) return setMenuIndex(Math.min(menu.items.length - 1, menuSelected + 1)), true;
    if (key.name === "up" || (key.ctrl && key.name === "p")) return setMenuIndex(Math.max(0, menuSelected - 1)), true;
    if (key.name === "tab" || (key.name === "return" && !key.shift && !key.meta)) return chooseMenuItem(menu.items[menuSelected]), true;
    return false;
  };

  useKeyboard((key) => {
    if (mode === "input" && menuKey(key)) return key.preventDefault();
    if (mode === "picker") {
      if (key.ctrl && key.name === "c") return quit();
      if (key.name === "escape") {
        setPicker(null);
        setMode(returnMode.current);
      } else if (key.name === "down" || (key.ctrl && key.name === "n")) setPickerIndex((index) => Math.min(pickerEntries.length - 1, index + 1));
      else if (key.name === "up" || (key.ctrl && key.name === "p")) setPickerIndex((index) => Math.max(0, index - 1));
      else return;
      return key.preventDefault();
    }
    if (mode === "palette") {
      if (key.ctrl && key.name === "c") return quit();
      if (key.name === "escape" || (key.ctrl && key.name === "k")) setMode(returnMode.current);
      else if (key.name === "down" || (key.ctrl && key.name === "n")) setPaletteIndex((index) => Math.min(entries.length - 1, index + 1));
      else if (key.name === "up" || (key.ctrl && key.name === "p")) setPaletteIndex((index) => Math.max(0, index - 1));
      else return;
      return key.preventDefault();
    }
    if (mode === "confirm") {
      if (key.ctrl && key.name === "c") return quit();
      if (key.name === "escape") {
        closeOverlay();
        return key.preventDefault();
      }
      // Without a message box, enter confirms here; with one, the box's submit does.
      if (key.name === "return" && !confirmation?.message) {
        const pending = confirmation;
        closeOverlay();
        pending?.run("");
        return key.preventDefault();
      }
      return;
    }
    if (globalKey(key)) return key.preventDefault();
    const digit = /^[1-9]$/.test(key.name) && !key.ctrl && !key.meta ? Number(key.name) - 1 : -1;
    if (digit >= 0 && pendingInput && (mode === "nav" || (mode === "input" && composerEmpty))) {
      pickOption(digit);
      return key.preventDefault();
    }
    if (mode === "input" || mode === "filter") {
      if (key.name === "escape") {
        setMode("nav");
        key.preventDefault();
      }
      return;
    }
    const scroll = scrollRef.current;
    if (mode === "pull-request") {
      if (pullRequests.handleKey(key, scroll)) return key.preventDefault();
      return;
    }
    if (mode === "settings") {
      const index = settingsIndex ?? 0;
      switch (key.name) {
        case "j":
        case "down":
          return setSettingsIndex(Math.min(settingsRows.length - 1, index + 1));
        case "k":
        case "up":
          return setSettingsIndex(Math.max(0, index - 1));
        case "return":
        case "space":
          cycleSetting(index);
          return key.preventDefault();
        case "escape":
        case "q":
        case "h":
        case "left":
          return closeSettings();
      }
      return;
    }
    if (mode === "details") {
      switch (key.name) {
        case "j":
        case "down":
          return moveDetails(1);
        case "k":
        case "up":
          return moveDetails(-1);
        case "return":
        case "space": {
          const action = actions.find((candidate) => candidate.id === detailsSelected);
          if (action) activate(action);
          return key.preventDefault();
        }
        case "t": {
          const action = actions.find((candidate) => candidate.id === detailsSelected);
          if (action?.kind === "automation") toggleAutomation(action.task);
          return;
        }
        case "escape":
          if (diff) return setDiff(null);
          setDetailsSelected(null);
          return setMode("nav");
        case "h":
        case "left":
          setDetailsSelected(null);
          return setMode("nav");
      }
    }
    switch (key.name) {
      case "q":
        if (diff) return setDiff(null);
        return quit();
      case "escape":
        if (diff) setDiff(null);
        else if (draft) setDraft(null);
        return;
      case "c":
        return startDraft();
      case "m":
        return openModelPicker();
      case ".":
        return openSelectedThreadMenu();
      case "p":
        if (key.shift) return pullRequests.open();
        if (draft) openProjectPicker();
        return;
      case "w":
        if (draft) toggleWorkspace();
        return;
      case "j":
      case "down":
        return attached || diff ? scroll?.scrollBy(1) : move(1);
      case "k":
      case "up":
        return attached || diff ? scroll?.scrollBy(-1) : move(-1);
      case "g":
        return key.shift ? scroll?.scrollTo(scroll.scrollHeight) : scroll?.scrollTo(0);
      case "d":
        return setDetailsPref(!showDetails);
      case "l":
      case "right":
        return focusDetails();
      case "u":
        if (parent) openThread(parent.threadId);
        return;
      case "e":
        return setExpandAll((value) => !value);
      case "o":
        return loadEarlier();
      case "z":
        return setShowFolded((value) => !value);
      case "y":
        return respond(key.shift ? "acceptForSession" : "accept");
      case "n":
        return respond("decline");
      case "x":
        if (threadId && pendingInput?.dismissible) run("Dismissed", () => session.dismissQuestion(threadId, pendingInput.requestId));
        return;
      case "s":
        if (threadId && key.shift) run("Stop requested", () => session.stopThread(threadId));
        return;
      case ":":
        openPalette();
        return key.preventDefault();
      case "/":
        if (!attached) setMode("filter");
        return key.preventDefault();
      case "i":
      case "return":
      case "tab":
        if (threadId || draft) setMode("input");
        return key.preventDefault();
    }
  });

  const status =
    shell.status.type === "error"
      ? `error: ${shell.status.message}`
      : shell.status.type === "connecting"
        ? "connecting…"
        : shell.status.type === "reconnecting"
          ? "reconnecting…"
          : (shell.serverUrl ?? "");
  const listWidth = attached ? 0 : Math.min(46, Math.max(28, Math.floor(width * 0.3)));
  const detailsColumn = showDetails && width - listWidth - DETAILS_WIDTH >= MIN_CONVERSATION_WIDTH;
  const detailsInPlace = showDetails && !detailsColumn;
  const composerHeight = Math.min(MAX_COMPOSER_LINES, composerLines) + 2;
  const placeholder =
    mode !== "input"
      ? "Press i to type"
      : draft
        ? "What should the new thread do?"
        : pendingApproval
          ? pendingApproval.supportsFeedback
            ? "Send feedback to decline this request"
            : "Send a message to decline and redirect the agent"
          : pendingInput
            ? "Type your own answer, or leave this blank to use the selected option"
            : working
              ? config.followUpBehavior === "queue"
                ? "Queue a message for after this run (alt+enter to steer instead)"
                : "Steer the agent (alt+enter to queue instead)"
              : "Ask anything";
  // The model with its options, then the mode when it isn't full access; click or m to change.
  const pendingModel = !draft && threadShell ? pendingModels.get(threadShell.id) : undefined;
  const footer =
    currentModel && runtimeMode
      ? [
          providerConfig ? modelSummary(providerConfig, currentModel) : currentModel.model === "default" ? "" : currentModel.model,
          runtimeMode === "full-access" ? "" : (RUNTIME_MODE_LABELS[runtimeMode] ?? runtimeMode),
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const draftLines: DraftLine[] = draft
    ? [
        { key: "project", label: "Project", value: draftProject?.title ?? "—", shortcut: "p", onPick: openProjectPicker },
        { key: "model", label: "Model", value: modelSummary(providerConfig, draft.modelSelection), shortcut: "m", onPick: openModelPicker },
        { key: "mode", label: "Mode", value: RUNTIME_MODE_LABELS[draft.runtimeMode] ?? draft.runtimeMode, shortcut: "m", onPick: openModelPicker },
        { key: "workspace", label: "Runs in", value: draft.existingWorktree ? `the ${draft.existingWorktree.branch ?? "thread's"} worktree` : draft.envMode === "worktree" ? "a new worktree from the default branch" : "the project folder", shortcut: "w", onPick: toggleWorkspace },
      ]
    : [];
  const detailsPanel = (inPlace: boolean) => (
    <DetailsPanel
      details={details}
      // Idle subagents are left out of the shell, which is where details come from; newer servers serve them on request.
      {...(threadId && !threadShell ? { empty: supportsFamilies ? "Loading details…" : "No details for idle subagent threads on this server. u goes to the parent." } : {})}
      width={inPlace ? width - listWidth : DETAILS_WIDTH}
      loading={vcsState?.status !== "live"}
      inPlace={inPlace}
      selected={mode === "details" || (mode === "confirm" && returnMode.current === "details") ? detailsSelected : null}
      onActivate={activateById}
    />
  );

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={colors.bg}>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1} flexShrink={0}>
        <text fg={colors.accent}>
          <strong>tui3</strong>
        </text>
        <text fg={shell.status.type === "live" ? colors.faint : colors.warn}>{`  ${status}`}</text>
        <box flexGrow={1} />
        <text fg={colors.faint}>ctrl+k commands</text>
      </box>
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {attached ? null : (
          <ThreadList
            rows={rows}
            collapsed={collapsed}
            selected={selectedIndex}
            focused={mode === "nav" || mode === "filter"}
            width={listWidth}
            height={height - 2}
            filter={filter}
            filtering={mode === "filter"}
            now={now}
            onFilter={setFilter}
            onFilterDone={() => setMode("nav")}
            onPick={(id) => {
              openThread(id);
              setMode("nav");
            }}
            onMenu={(id) => {
              const target = allRows.find((row) => row.thread.id === id)?.thread;
              if (target) openThreadMenu(target);
            }}
            onUnfold={() => setShowFolded(true)}
          />
        )}
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          {settingsIndex !== null ? (
            <SettingsView
              rows={settingsRows}
              server={serverSettingLines(serverConfig?.config ?? null)}
              serverStatus={serverConfig?.status ?? "loading"}
              selected={settingsIndex}
              path={configPath().replace(homedir(), "~")}
              onCycle={(index) => {
                setMode("settings");
                cycleSetting(index);
              }}
            />
          ) : mode === "pull-request" && pullRequests.view ? (
            <PullRequestView view={pullRequests.view} scrollRef={scrollRef} />
          ) : diff ? (
            <DiffView diff={diff} scrollRef={scrollRef} />
          ) : draft ? (
            <DraftView lines={draftLines} />
          ) : threadId && detailsInPlace ? (
            <box flexGrow={1} minHeight={0} flexDirection="column">
              {detailsPanel(true)}
            </box>
          ) : threadId ? (
            <ThreadView
              key={watchedId}
              project={threadRow?.projectName ?? ""}
              title={title}
              detail={threadShell?.branch ?? ""}
              timeline={current}
              history={watchedId === threadId ? (thread?.history ?? null) : null}
              loading={watchedId !== threadId || thread?.status === "loading"}
              error={thread?.error}
              workspaceRoot={threadShell?.worktreePath ?? undefined}
              now={now}
              scrollRef={scrollRef}
              parent={parent}
              onOpenThread={openThread}
            />
          ) : (
            <box flexGrow={1} paddingLeft={2} paddingTop={1}>
              <text fg={colors.muted}>{shell.snapshot ? "No thread selected." : "Waiting for threads…"}</text>
            </box>
          )}
          {mode !== "confirm" && pendingInput && questionDraft ? <QuestionPanel request={pendingInput} index={questionDraft.index} draft={questionDraft.answers[pendingInput.questions[questionDraft.index]?.id ?? ""]} /> : null}
          {mode === "confirm" && confirmation ? (
            <ConfirmBar
              confirmation={confirmation}
              message={confirmMessage}
              onMessage={setConfirmMessage}
              onSubmit={() => {
                closeOverlay();
                confirmation.run(confirmMessage);
              }}
            />
          ) : null}
          {menu ? <ComposerMenu items={menu.items} selected={menuSelected} empty={menu.empty} width={width - listWidth - (detailsColumn ? DETAILS_WIDTH : 0) - 2} onPick={(index) => chooseMenuItem(menu.items[index])} /> : null}
          {threadId || draft ? (
            <box
              border
              borderStyle="rounded"
              borderColor={mode === "input" ? colors.borderFocused : colors.border}
              height={composerHeight}
              flexShrink={0}
              marginLeft={1}
              marginRight={1}
              paddingLeft={1}
              paddingRight={1}
              onMouseDown={() => setMode("input")}
            >
              <textarea
                key={composerKey}
                ref={composerRef}
                focused={mode === "input"}
                initialValue={drafts.current.get(composerKey) ?? ""}
                placeholder={placeholder}
                placeholderColor={colors.faint}
                textColor={colors.text}
                wrapMode="word"
                keyBindings={[...COMPOSER_KEYS[config.sendShortcut]]}
                onSubmit={() => submit()}
                onCursorChange={syncComposerState}
                onContentChange={() => {
                  syncComposerState();
                  const composer = composerRef.current;
                  const text = composer?.plainText ?? "";
                  if (text) drafts.current.set(composerKey, text);
                  else drafts.current.delete(composerKey);
                  // Wrapped lines count too, so a long paragraph grows the box.
                  setComposerLines(composer ? composerLineCount(composer) : 1);
                  setComposerEmpty(text.trim() === "");
                }}
              />
            </box>
          ) : null}
          {threadId || draft ? (
            <box flexDirection="row" height={1} flexShrink={0} paddingLeft={2} paddingRight={2} onMouseDown={openModelPicker}>
              <text fg={colors.faint}>{footer}</text>
              {pendingModel ? <text fg={colors.accent}>{"  · next message"}</text> : null}
            </box>
          ) : null}
        </box>
        {detailsColumn ? detailsPanel(false) : null}
      </box>
      <box flexDirection="row" paddingLeft={2} height={1} flexShrink={0}>
        {flash ? (
          <text fg={flash.bad ? colors.bad : colors.good}>{flash.text}</text>
        ) : menuOpen ? (
          <text fg={colors.faint}>↑/↓ move · tab or enter choose · esc close</text>
        ) : (
          <text fg={colors.faint}>{hints(mode, { draft: draft !== null, config, approval: Boolean(pendingApproval), question: Boolean(pendingInput), working, attached, diff: diff !== null, parent: parent !== undefined })}</text>
        )}
      </box>
      {mode === "palette" ? (
        <Palette
          query={paletteQuery}
          groups={groups}
          selected={Math.min(paletteIndex, Math.max(0, entries.length - 1))}
          width={width}
          height={height}
          onQuery={(value) => {
            setPaletteQuery(value);
            setPaletteIndex(0);
          }}
          onSubmit={() => pick(Math.min(paletteIndex, entries.length - 1))}
          onPick={pick}
        />
      ) : null}
      {mode === "picker" && picker ? (
        <Palette
          query={pickerQuery}
          placeholder={picker.placeholder}
          groups={pickerView}
          selected={Math.min(pickerIndex, Math.max(0, pickerEntries.length - 1))}
          width={width}
          height={height}
          onQuery={(value) => {
            setPickerQuery(value);
            setPickerIndex(0);
          }}
          onSubmit={() => pickItem(Math.min(pickerIndex, pickerEntries.length - 1))}
          onPick={pickItem}
        />
      ) : null}
    </box>
  );
}

function hints(
  mode: Mode,
  state: { readonly draft: boolean; readonly config: Tui3Config; readonly approval: boolean; readonly question: boolean; readonly working: boolean; readonly attached: boolean; readonly diff: boolean; readonly parent: boolean },
): string {
  if (mode === "filter") return "enter done · esc close";
  if (mode === "palette") return "↑/↓ move · enter run · esc close";
  if (mode === "picker") return "↑/↓ move · enter choose · esc close";
  if (mode === "confirm") return "enter confirm · esc cancel";
  if (mode === "details") return "j/k move · enter open · t toggle automation · esc back";
  if (mode === "settings") return "j/k move · enter change · esc close";
  if (mode === "pull-request") return "j/k scroll · o open · r refresh · c comment · R review · a actions · w watch · u unlink · esc close";
  if (mode === "input") {
    const send = state.config.sendShortcut === "enter" ? "enter" : "ctrl+enter";
    const other = state.config.followUpBehavior === "steer" ? "queue" : "steer";
    const newline = state.config.sendShortcut === "enter" ? "shift+enter or \\ newline" : "enter newline";
    const parts = [state.working ? `${send} ${state.config.followUpBehavior} · alt+enter ${other}` : `${send} send`, newline, "ctrl+g editor", "esc navigate"];
    if (state.question) parts.unshift("1-9 pick");
    if (state.approval) parts.unshift("approval waiting: esc, then y/n");
    if (!state.attached) parts.push("ctrl+n/p thread");
    return parts.join(" · ");
  }
  if (state.diff) return "j/k scroll · esc close diff · l details";
  if (state.draft) return "i write the first message · p project · m model & mode · w worktree · esc cancel";
  const parts = state.attached ? ["j/k scroll"] : ["j/k threads", "/ filter"];
  parts.push("i type", "c new", ". actions", "m model", "ctrl+j terminal", "l details");
  if (state.parent) parts.push("u parent");
  parts.push("ctrl+k commands", "q quit");
  if (state.question) parts.unshift("1-9 pick · x dismiss");
  if (state.approval) parts.unshift("y approve · Y always · n decline");
  return parts.join(" · ");
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The composer's height in lines, wrapped lines included. The wrapped count can lag a
 * programmatic change, so the hard lines, each wrapped at the box's width, are a floor.
 */
function composerLineCount(composer: TextareaRenderable): number {
  const width = Math.max(1, composer.width);
  const estimate = composer.plainText.split("\n").reduce((lines, line) => lines + Math.max(1, Math.ceil(Bun.stringWidth(line) / width)), 0);
  return Math.max(estimate, composer.virtualLineCount);
}

function firstLine(text: string): string {
  const line = (text.trim().split("\n")[0] ?? "").replace(/\s+/g, " ");
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}
