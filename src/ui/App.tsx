import type { KeyEvent, MouseEvent, ScrollBoxRenderable, Selection, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  buildPendingUserInputAnswers,
  resolvePendingUserInputAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import { type DiscoveredLocalServer, type OrchestrationV2ThreadShell, type ProviderApprovalDecision, type ScheduledTask, type ThreadId } from "@t3tools/contracts";
import { homedir } from "node:os";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ComposerContextRecord, ProjectEntry } from "@t3tools/contracts";
import type { FeedState, ServerConfigState, ShellState, T3Session, ThreadState, VcsState } from "../client/session.ts";
import { createAlerts, type Alert } from "../model/alerts.ts";
import { applyComposerItem, composerTrigger, cursorAtIndex, indexAtCursor, messageContext, PATH_SEARCH_LIMIT, pathItems, skillItems, slashItems, threadItems, type ComposerItem } from "../model/composerMenu.ts";
import { modelSummary } from "../model/models.ts";
import { configPath, cycleConfig, saveConfig, type Tui3Config } from "../config.ts";
import { detailsActions, detailsCwd, RUNTIME_MODE_LABELS, threadDetails, type DetailsAction, type GitAction } from "../model/details.ts";
import { paletteEntries, paletteGroups, pickerGroups, type PaletteCommand, type Picker, type PickerItem } from "../model/palette.ts";
import { pullRequestRepository } from "../model/pullRequests.ts";
import { serverSettingLines, settingRows } from "../model/settings.ts";
import { resetCreditOutcome, usageLimits, usageSummaryLines } from "../model/usage.ts";
import { buildTimeline, type Timeline } from "../model/timeline.ts";
import type { Section } from "../model/threads.ts";
import { ComposerMenu } from "./ComposerMenu.tsx";
import { ConfirmBar, type Confirmation } from "./ConfirmBar.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { DiffView, type DiffState } from "./DiffView.tsx";
import { DraftView } from "./DraftView.tsx";
import { useDraft } from "./useDraft.ts";
import { useModelPicker } from "./useModelPicker.ts";
import { useThreadMenu } from "./useThreadMenu.ts";
import { editInEditor } from "./editor.ts";
import { Palette } from "./Palette.tsx";
import { QuestionPanel } from "./QuestionPanel.tsx";
import { QueuePanel } from "./QueuePanel.tsx";
import { SecretPanel } from "./SecretPanel.tsx";
import { PullRequestView } from "./PullRequestView.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { useWorkspace } from "./useWorkspace.ts";
import { useComposerPullRequests, usePullRequests } from "./usePullRequests.ts";
import { copyText, desktopNotify, ring } from "./terminalOut.ts";
import { colors } from "./theme.ts";
import { ThreadList } from "./ThreadList.tsx";
import { useTurns } from "./useTurns.ts";
import { ThreadView, type ConversationMouse, type ConversationTarget } from "./ThreadView.tsx";
import { Button, ResizeHandle } from "./Button.tsx";
import { HintBar } from "./HintBar.tsx";
import { bindingFor, commandsFor, fromCommand, hinted, hintsFor, keys, type Binding } from "../model/keymap.ts";
import { useEvent } from "./useEvent.ts";
import { useQueue } from "./useQueue.ts";
import { useSecretRequest } from "./useSecretRequest.ts";
import { canStopSubagent } from "../model/subagents.ts";
import { useThreadLibrary } from "./useThreadLibrary.ts";
import { usePaletteSearch } from "./usePaletteSearch.ts";
import { useThreadFind } from "./useThreadFind.ts";
import { ThreadFindBar } from "./ThreadFindBar.tsx";
import { mergeThreadShells, messageMatchGroups } from "../model/search.ts";
import { useAttachments } from "./useAttachments.ts";
import { useAutomations } from "./useAutomations.ts";
import { useUsageSummary } from "./useUsage.ts";

/**
 * "input": typing goes to the composer. "nav": single keys move, scroll, approve.
 * "details": j/k move through the details panel. "settings": j/k move through settings.
 * The rest are overlays with their own input.
 */
type Mode = "input" | "nav" | "filter" | "details" | "palette" | "picker" | "confirm" | "settings" | "find" | "pull-request";

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
  /** Folds opened one at a time by a click, for the open thread. */
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  /** The thread list's width once its border is dragged; null follows the window. */
  const [listWidthPref, setListWidthPref] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  /** null follows the terminal width; d sets it for the rest of the session. */
  const [detailsPref, setDetailsPref] = useState<boolean | null>(null);
  const [detailsSelected, setDetailsSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [config, setConfig] = useState(props.config);
  const [settingsIndex, setSettingsIndex] = useState<number | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfigState | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
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

  const library = useThreadLibrary(session, shell.snapshot, filter);
  const allRows = library.allRows;
  useEffect(() => { if (!attached) setSelectedId(undefined); }, [library.archived]);
  const unfold = library.archived || showFolded || filter.trim() !== "";
  const rows = useMemo(() => (unfold ? allRows : allRows.filter((row) => !FOLDED_SECTIONS.includes(row.section))), [allRows, unfold]);
  const collapsed = useMemo(
    () => new Map(unfold ? [] : FOLDED_SECTIONS.map((section) => [section, allRows.filter((row) => row.section === section).length] as const)),
    [allRows, unfold],
  );
  // Selection is a thread id, not an index, so the list can reorder underneath it.
  const threadId = selectedId ?? rows[0]?.thread.id;
  const selectedIndex = rows.findIndex((row) => row.thread.id === threadId);
  const threadRow = allRows.find((row) => row.thread.id === threadId);
  const threadShell = threadRow?.thread ?? shell.snapshot?.threads.find((thread) => thread.id === threadId) ?? library.archive?.threads.find((thread) => thread.id === threadId) ?? library.merged?.threads.find((thread) => thread.id === threadId) ?? (threadId ? familyShells.get(threadId) : undefined);
  const newThread = useDraft({
    session,
    snapshot: shell.snapshot,
    config: serverConfig?.config ?? null,
    thread: threadShell,
    openPicker: (next) => openPicker(next),
    say: (text, bad) => say(text, bad),
    onStart: () => {
      setDiff(null);
      setSettingsIndex(null);
      setMode("input");
    },
    onLaunched: (id) => {
      drafts.current.delete(DRAFT_KEY);
      openThread(id);
    },
  });
  const draft = newThread.draft;
  const composerKey: string = draft ? DRAFT_KEY : (threadId ?? "");
  const activeComposerKey = useRef(composerKey);
  activeComposerKey.current = composerKey;
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
    newThread.cancel();
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
    const next = buildTimeline(thread.projection, { expandAll: expandAll || mode === "find", expanded: expandedIds, historyComplete: !thread.history.hasMore }, previous);
    previousTimeline.current = { id: watchedId, timeline: next };
    return next;
  }, [thread?.projection, thread?.history.hasMore, watchedId, expandAll, expandedIds, mode === "find"]);
  useEffect(() => setExpandedIds(new Set()), [watchedId]);
  const current = watchedId === threadId ? timeline : null;
  const find = useThreadFind(session, watchedId, thread, current, mode === "find");
  const openFind = () => { setDiff(null); setSettingsIndex(null); setMode("find"); };
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
  // Taking the mouse costs the terminal's own drag-to-select, so a drag selects here and copies on release.
  const copySelection = useEvent((selection: Selection) => {
    const text = selection.getSelectedText();
    if (!text.trim()) return;
    copyText(renderer, text);
    say(`Copied ${text.length === 1 ? "1 character" : `${text.length} characters`}`);
  });
  useEffect(() => {
    renderer.on("selection", copySelection);
    return () => {
      renderer.off("selection", copySelection);
    };
  }, [renderer, copySelection]);
  const run = (label: string, action: () => Promise<unknown>) => {
    action().then(
      () => say(label),
      (error) => say(`${label} failed: ${messageOf(error)}`, true),
    );
  };
  const models = useModelPicker({
    session,
    config: serverConfig?.config ?? null,
    draft,
    updateDraft: newThread.update,
    thread: threadShell,
    projection,
    openPicker: (next) => openPicker(next),
    run,
    say,
  });
  const queue = useQueue({
    session,
    threadId: draft ? undefined : threadId,
    projection,
    composer: () => composerRef.current,
    openQuestionCount: current?.pending.userInputs.length ?? 0,
    modelSelection: models.pendingFor(threadId),
    run,
    say,
    toInput: () => setMode("input"),
  });
  const secret = useSecretRequest({ session, projection: draft ? null : projection, questionPending: pendingInput !== undefined });
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

  // Attachments, usage and automation editing: each hook owns its slice; App wires it in below.
  const attachCwd = draft ? (shell.snapshot?.projects.find((candidate) => candidate.id === draft.projectId)?.workspaceRoot ?? null) : (threadShell?.worktreePath ?? project?.workspaceRoot ?? null);
  const attach = useAttachments({
    session,
    composerKey,
    cwd: attachCwd,
    maxFileBytes: serverConfig?.config ? (serverConfig.config.environment.capabilities.fileAttachments?.maxUploadBytes ?? null) : undefined,
    confirm,
    say,
  });
  const usage = useUsageSummary(session, settingsIndex !== null && live);
  const usageInfo = useMemo(() => usageLimits(serverConfig?.config ?? null, now), [serverConfig, now]);
  const useResetCredit = (credit: (typeof usageInfo.credits)[number]) =>
    confirm({
      title: "Use a reset credit?",
      detail: "This redeems one credit on your account and clears the current rate-limit windows. It cannot be undone.",
      confirmLabel: "use credit",
      run: () =>
        session.consumeResetCredit(credit.input).then(
          (result) => say(resetCreditOutcome(result)),
          (error) => say(`Could not use the reset credit: ${messageOf(error)}`, true),
        ),
    });
  const automationDefaults = (() => {
    const projects = shell.snapshot?.projects ?? [];
    const projectId = threadShell?.projectId ?? draft?.projectId ?? projects[0]?.id;
    const modelSelection = threadShell?.modelSelection ?? draft?.modelSelection ?? serverConfig?.config?.settings.defaultModelSelection ?? undefined;
    return projectId && modelSelection ? { projectId, threadId: threadShell?.id ?? "", modelSelection, runtimeMode: threadShell?.runtimeMode ?? draft?.runtimeMode ?? ("full-access" as const) } : null;
  })();
  const automationEditing = useAutomations({ session, renderer, projects: shell.snapshot?.projects ?? [], defaults: automationDefaults, confirm, run, say });

  const openDiff = (path: string | null) => {
    if (!vcsCwd) return;
    const cwd = vcsCwd;
    setDiff({ cwd, path, status: "loading" });
    session.workingTreeDiff(cwd, path ?? undefined, config.diffIgnoreWhitespace).then(
      (source) => setDiff((value) => (value?.cwd === cwd && value.path === path ? { cwd, path, status: "ready", patch: source?.diff ?? "", ...(source ? { source: { cwd, sourceKind: source.kind, baseRef: source.baseRef, headRef: source.headRef } } : {}), truncated: source?.truncated ?? false } : value)),
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

  const providerConfig = serverConfig?.config ?? null;
  const draftProject = newThread.project;
  const currentModel = models.current;
  const runtimeMode = models.runtimeMode;
  const threadMenu = useThreadMenu({
    session,
    renderer,
    snapshot: shell.snapshot,
    config: providerConfig,
    timestampFormat: config.timestampFormat,
    thread: threadShell,
    openPicker,
    confirm: (confirmation, prefill) => {
      confirm(confirmation);
      if (prefill) setConfirmMessage(prefill);
    },
    run,
    say,
    openThread,
    openFind,
    left: (id) => {
      if (threadId === id) setSelectedId(undefined);
    },
    keepUnread: (id) => (noVisit.current = id),
    startDraftOn: (target) => {
      const targetProject = shell.snapshot?.projects.find((candidate) => candidate.id === target.projectId);
      if (!targetProject) return say("The thread's project is gone.", true);
      newThread.start({ project: targetProject, model: target.modelSelection, worktree: target.worktreePath ? { path: target.worktreePath, branch: target.branch } : null });
    },
  });

  const workspace = useWorkspace({ session, renderer, live, thread: threadShell, project, serverConfig: serverConfig?.config ?? null, draft: draft !== null, diff, openPicker, confirm, run, say });

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
    const attachedFiles = attach.pending;
    const context = messageContext(text, mentions.current.get(composerKey) ?? new Map());
    if (draft) {
      if (!text && attachedFiles.length === 0) return;
      const taken = attach.take();
      clearComposer();
      return newThread.launch(text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, context, taken);
    }
    if (!threadId) return;
    if (pendingInput && questionDraft) {
      if (attachedFiles.length > 0) return say("Attachments can't go with a question answer here; remove them first from the palette.", true);
      const question = pendingInput.questions[questionDraft.index];
      if (!question) return;
      const answer = text ? setPendingUserInputCustomAnswer(question, questionDraft.answers[question.id], text) : questionDraft.answers[question.id];
      clearComposer();
      return advanceQuestion({ ...questionDraft, answers: { ...questionDraft.answers, ...(answer ? { [question.id]: answer } : {}) } });
    }
    if ((queue.editing || attachedFiles.length === 0) && queue.submit(text)) return;
    if (!text && attachedFiles.length === 0) return;
    if (pendingApproval && attachedFiles.length > 0) return say("Send approval feedback without attachments or added context.", true);
    clearComposer();
    const taken = attach.take();
    const sendText = text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT;
    if (pendingApproval) {
      // As in the web composer: the message declines the request and redirects the agent.
      if (pendingApproval.supportsFeedback) return run("Declined with feedback", () => session.respond(threadId, pendingApproval.requestId, "decline", text));
      return run("Declined and redirected", () => session.sendMessage(threadId, sendText, "steer", undefined, context, taken));
    }
    const dispatchMode = resolveComposerDispatchMode({ running: working, alternateModifier: alternate, activeTurnDefault: config.followUpBehavior });
    const pendingModel = models.take(threadId);
    run(dispatchMode === "queue" ? "Queued" : dispatchMode === "steer" ? "Steered" : "Sent", () => session.sendMessage(threadId, sendText, dispatchMode, pendingModel, context, taken));
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

  const turns = useTurns({ session, threadId, projection, timeline: current, config: providerConfig, cwd: vcsCwd, ignoreWhitespace: config.diffIgnoreWhitespace, enabled: draft === null, diff, setDiff, scrollRef, confirm, say,
    showConversation: () => { setMode("nav"); setDetailsPref((value) => width < MIN_CONVERSATION_WIDTH + DETAILS_WIDTH ? false : value); },
    restorePrompt: (id, text) => {
      const previous = id === activeComposerKey.current ? composerRef.current?.plainText ?? "" : drafts.current.get(id) ?? "";
      const next = text ? previous ? `${previous}\n\n${text}` : text : previous;
      drafts.current.set(id, next);
      if (id === activeComposerKey.current) { composerRef.current?.setText(next); setMode("input"); }
    },
  });

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
    startDraftFromPullRequest: (targetProject, prepared) => newThread.start({ project: targetProject, worktree: prepared.worktreePath ? { path: prepared.worktreePath, branch: prepared.branch } : null }),
  });

  // The command palette: everything the keys do, plus what the details panel offers.
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
    if (item.action === "model") models.open();
  };
  // Keys. Each state has its bindings in hint order; the first one that takes a key runs it.
  // The same bindings name the hints, make them clickable, and give the palette its shortcuts.
  const hasComposer = threadId !== undefined || draft !== null;
  const scrollBy = (lines: number) => scrollRef.current?.scrollBy(lines);
  const toInput = () => {
    if (hasComposer) setMode("input");
  };
  const dismissQuestion = threadId && pendingInput?.dismissible ? () => run("Dismissed", () => session.dismissQuestion(threadId, pendingInput.requestId)) : null;
  const leaveDetails = () => {
    setDetailsSelected(null);
    setMode("nav");
  };
  const selectedAction = () => actions.find((candidate) => candidate.id === detailsSelected);

  // Keys that work wherever there's no line input to type into.
  const quitKey: Binding = { keys: ["ctrl+c"], run: quit };
  const paletteKey: Binding = { keys: ["ctrl+k"], run: openPalette };
  const terminalKey: Binding = { keys: ["ctrl+j"], run: workspace.openTerminal };
  const editorKey: Binding | null = hasComposer ? { keys: ["ctrl+g"], run: openEditor, command: { id: "editor", title: "Write the message in $EDITOR", keywords: ["vim", "editor", "compose"] } } : null;
  const nextThreadKey: Binding = { keys: ["ctrl+n", "alt+↓"], label: "ctrl+n/p", run: () => move(1) };
  const previousThreadKey: Binding = { keys: ["ctrl+p", "alt+↑"], run: () => move(-1) };
  // One-line inputs keep ctrl+u and ctrl+d for editing.
  const lineInput = mode === "filter";
  const globalKeys = keys(
    quitKey,
    paletteKey,
    terminalKey,
    editorKey,
    { keys: lineInput ? ["pagedown"] : ["pagedown", "ctrl+d"], run: () => scrollPage(1) },
    { keys: lineInput ? ["pageup"] : ["pageup", "ctrl+u"], run: () => scrollPage(-1) },
    !attached && nextThreadKey,
    !attached && previousThreadKey,
  );

  const digitKeys = pendingInput ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit): Binding => ({ keys: [String(digit)], run: () => pickOption(digit - 1) })) : [];
  const pickHint: Binding = { keys: [], label: "1-9", hint: "pick" };

  // Navigation: single keys move, open and act on the thread.
  const scrollDiffDown: Binding = { keys: ["j", "↓"], label: "j/k", run: () => scrollBy(1), hint: "scroll" };
  const closeDiff: Binding = { keys: ["esc", "q"], run: () => setDiff(null), hint: "close diff" };
  const typeKey: Binding = { keys: ["i", "enter", "tab"], run: toInput, hint: "type", ...(threadId ? { command: { id: "type", title: "Write a message", keywords: ["compose", "send", "steer"] } } : {}) };
  const projectKey = newThread.keys?.project;
  const modelKey = models.key;
  const worktreeKey = newThread.keys?.workspace;
  const detailsKey: Binding = { keys: ["l", "→"], run: focusDetails, hint: "details", ...(threadShell ? { command: { id: "focus-details", title: "Focus thread details" } } : {}) };
  const cancelDraftKey = newThread.keys?.cancel;
  const navKeys = keys(
    diff && [scrollDiffDown, { keys: ["k", "↑"], run: () => scrollBy(-1) }, closeDiff],
    turns.bindings,
    pendingApproval && [
      { keys: ["y"], run: () => respond("accept"), hint: "approve", command: { id: "approve", title: "Approve request" } },
      { keys: ["Y"], run: () => respond("acceptForSession"), hint: "always", command: { id: "approve-session", title: "Always allow this session" } },
      { keys: ["n"], run: () => respond("decline"), hint: "decline", command: { id: "decline", title: "Decline request" } },
    ],
    !diff && secret.bindings,
    pendingInput && pickHint,
    digitKeys,
    dismissQuestion && { keys: ["x"], run: dismissQuestion, hint: "dismiss", command: { id: "dismiss", title: "Dismiss question" } },
    queue.keys.nav,
    library.commands(threadId).map((command) => fromCommand(command)),
    workspace.commands.map((command) => fromCommand(command)),
    threadId && !draft && { keys: ["f"], run: openFind, command: { id: "find", title: "Find in thread", keywords: ["search", "messages", "plans"] } },
    // Only P is a navigation key; the rest are the PR view's own (below).
    pullRequests.commands.filter((command) => command.id === "pull-requests").map((command) => fromCommand(command)),
    { keys: ["j", "↓"], label: "j/k", run: () => (attached ? scrollBy(1) : move(1)), hint: attached ? "scroll" : "threads" },
    { keys: ["k", "↑"], run: () => (attached ? scrollBy(-1) : move(-1)) },
    !attached && { keys: ["/"], run: () => setMode("filter"), hint: "filter", command: { id: "filter", title: "Filter threads", keywords: ["search"] } },
    typeKey,
    projectKey,
    { keys: ["c"], run: () => newThread.start(), hint: "new", command: { id: "new-thread", title: "New thread", keywords: ["create", "start", "chat"] } },
    hasComposer && attach.commands.map((command) => fromCommand(command, command.id === "attach-file" ? "attach" : undefined)),
    threadMenu.key,
    modelKey,
    worktreeKey,
    hinted(terminalKey, "terminal"),
    detailsKey,
    parent && { keys: ["u"], run: () => openThread(parent.threadId), hint: "parent", command: { id: "parent", title: `Go to parent: ${parent.title}` } },
    hinted(paletteKey, "commands"),
    { keys: ["q"], run: quit, hint: "quit", command: { id: "quit", title: "Quit tui3", keywords: ["exit"] } },
    { keys: ["d"], run: () => setDetailsPref(!showDetails), command: { id: "details", title: showDetails ? "Hide thread details" : "Show thread details", keywords: ["panel", "info"] } },
    { keys: ["e"], run: () => setExpandAll((value) => !value), command: { id: "expand", title: expandAll ? "Collapse work" : "Expand all work", keywords: ["fold", "tool calls"] } },
    thread?.history.hasMore && { keys: ["o"], run: loadEarlier, command: { id: "earlier", title: "Load earlier turns", keywords: ["history", "older"] } },
    !attached && { keys: ["z"], run: () => setShowFolded((value) => !value), command: { id: "settled", title: showFolded ? "Hide settled threads" : "Show settled threads", keywords: ["snoozed", "archive"] } },
    threadId && working && { keys: ["S"], run: () => run("Stop requested", () => session.stopThread(threadId)), command: { id: "stop", title: "Stop thread", keywords: ["interrupt", "cancel"] } },
    { keys: ["g"], run: () => scrollRef.current?.scrollTo(0) },
    { keys: ["G"], run: () => scrollRef.current?.scrollTo(scrollRef.current.scrollHeight) },
    { keys: [":"], run: openPalette },
    cancelDraftKey,
  );
  // A diff and a draft name their own few keys; everything else names the lot.
  const navHints = diff
    ? [scrollDiffDown, closeDiff, detailsKey]
    : draft
      ? keys(hinted(typeKey, "write the first message"), projectKey, modelKey && hinted(modelKey, "model & mode"), worktreeKey, cancelDraftKey)
      : navKeys;

  // Commands only the palette runs.
  const paletteOnly = keys(
    editorKey,
    queue.keys.input,
    queue.keys.palette,
    (projection?.subagents ?? []).filter((agent) => threadId && canStopSubagent(agent)).map((agent): Binding => ({ keys: [], run: () => run("Stop requested", () => session.stopSubagent(agent)), command: { id: `stop-subagent:${agent.id}`, title: `Stop subagent: ${agent.title ?? "subagent"}`, keywords: ["interrupt", "cancel", "kill"] } })),
    details?.changes && details.changes.files.length > 0 && { keys: [], run: () => openDiff(null), command: { id: "diff", title: "View uncommitted changes", keywords: ["diff", "changes"] } },
    actions.flatMap((action): Binding[] => {
      if (action.kind === "git") return [{ keys: [], run: () => runGit(action.git), command: { id: action.id, title: `Git: ${action.git.label}`, keywords: ["commit", "push", "pull request", "pr"] } }];
      if (action.kind === "server") return [{ keys: [], run: () => stopServer(action.server), command: { id: action.id, title: `Stop server ${action.server.url}`, keywords: ["port", "kill"] } }];
      if (action.kind !== "automation") return [];
      const task = action.task;
      return [
        { keys: [], run: () => runAutomation(task), command: { id: action.id, title: `Run automation: ${task.title}`, keywords: ["scheduled", "task"] } },
        { keys: [], run: () => toggleAutomation(task), command: { id: `${action.id}:toggle`, title: `${task.enabled ? "Turn off" : "Turn on"} automation: ${task.title}`, keywords: ["scheduled", "task", "enable", "disable"] } },
        { keys: [], run: () => automationEditing.editAutomation(task), command: { id: `${action.id}:edit`, title: `Edit automation: ${task.title}`, keywords: ["scheduled", "task", "editor"] } },
        { keys: [], run: () => automationEditing.deleteAutomation(task), command: { id: `${action.id}:delete`, title: `Delete automation: ${task.title}`, keywords: ["scheduled", "task", "remove"] } },
      ];
    }),
    { keys: [], run: automationEditing.newAutomation, command: { id: "new-automation", title: "New automation", keywords: ["scheduled", "task", "create", "editor"] } },
    usageInfo.credits.map((credit, index): Binding => ({ keys: [], run: () => useResetCredit(credit), command: { id: `reset-credit:${index}`, title: `Use reset credit: ${credit.label}`, keywords: ["usage", "limit", "reset", "credit"] } })),
    // The PR view's keys are its own; the palette shows them without taking them here.
    pullRequests.commands.map((command): Binding => ({ ...fromCommand(command), keys: [], ...(command.shortcut ? { label: command.shortcut } : {}) })),
    { keys: [], run: openSettings, command: { id: "settings", title: "Settings", keywords: ["preferences", "config", "options", "notifications", "alerts"] } },
  );
  const commands = commandsFor([...navKeys, ...paletteOnly]);

  // The composer. Enter and newlines are the textarea's own; their hints only explain.
  const sendKey = config.sendShortcut === "enter" ? "enter" : "ctrl+enter";
  const inputKeys = keys(
    pendingApproval && { keys: [], label: "approval waiting:", hint: "esc, then y/n" },
    pendingInput && pickHint,
    pendingInput && composerEmpty && digitKeys,
    { keys: [], label: sendKey, hint: working ? config.followUpBehavior : "send" },
    working && { keys: [], label: "alt+enter", hint: config.followUpBehavior === "steer" ? "queue" : "steer" },
    { keys: ["alt+enter"], run: () => submit(true) },
    queue.keys.input,
    { keys: [], label: config.sendShortcut === "enter" ? "shift+enter or \\" : "enter", hint: "newline" },
    editorKey && hinted(editorKey, "editor"),
    { keys: ["esc"], run: () => setMode("nav"), hint: "navigate" },
    !attached && hinted(nextThreadKey, "thread"),
  );
  const menuKeys = menu
    ? keys(
        { keys: [], label: "↑/↓", hint: "move" },
        menu.items.length > 0 && [
          { keys: ["↓", "ctrl+n"], run: () => setMenuIndex(Math.min(menu.items.length - 1, menuSelected + 1)) },
          { keys: ["↑", "ctrl+p"], run: () => setMenuIndex(Math.max(0, menuSelected - 1)) },
        ],
        // Enter waits for a search in flight rather than sending the half-typed mention.
        menu.loading && { keys: ["enter"], run: () => {} },
        menu.items.length > 0 ? { keys: ["tab", "enter"], label: "tab or enter", hint: "choose", run: () => chooseMenuItem(menu.items[menuSelected]) } : { keys: [], label: "tab or enter", hint: "choose" },
        { keys: ["esc"], run: () => setMenuDismissed(triggerKey), hint: "close" },
      )
    : [];

  // Lists and overlays.
  const listMove = (step: (delta: number) => void): Binding[] => [
    { keys: [], label: "↑/↓", hint: "move" },
    { keys: ["↓", "ctrl+n"], run: () => step(1) },
    { keys: ["↑", "ctrl+p"], run: () => step(-1) },
  ];
  const detailsKeys = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => moveDetails(1), hint: "move" },
    { keys: ["k", "↑"], run: () => moveDetails(-1) },
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
    { keys: ["esc"], run: () => (diff ? setDiff(null) : leaveDetails()), hint: "back" },
    { keys: ["h", "←"], run: leaveDetails },
  );
  const settingsKeys = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => setSettingsIndex(Math.min(settingsRows.length - 1, (settingsIndex ?? 0) + 1)), hint: "move" },
    { keys: ["k", "↑"], run: () => setSettingsIndex(Math.max(0, (settingsIndex ?? 0) - 1)) },
    { keys: ["enter", "space"], run: () => cycleSetting(settingsIndex ?? 0), hint: "change" },
    { keys: ["esc", "q", "h", "←"], run: closeSettings, hint: "close" },
  );
  const prCommand = (prefix: string) => pullRequests.commands.find((command) => command.id.startsWith(prefix));
  const prKey = (key: string, prefix: string, hint: string): Binding | null => {
    const command = prCommand(prefix);
    return command ? { keys: [key], run: command.run, hint } : null;
  };
  const pullRequestKeys = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => scrollBy(1), hint: "scroll" },
    { keys: ["k", "↑"], run: () => scrollBy(-1) },
    { keys: ["g"], run: () => scrollRef.current?.scrollTo(0) },
    { keys: ["G"], run: () => scrollRef.current?.scrollTo(scrollRef.current.scrollHeight) },
    prKey("o", "pr-open", "open"),
    prKey("r", "pr-refresh", "refresh"),
    prKey("c", "pr-comment", "comment"),
    prKey("R", "pr-review", "review"),
    prKey("a", "pr-actions", "actions"),
    prKey("w", "watch-pull-request", "watch"),
    prKey("u", "unlink-pull-request", "unlink"),
    { keys: ["esc", "q"], run: pullRequests.close, hint: "close" },
  );
  const findKeys = keys(
    { keys: ["enter"], run: () => find.step(1), hint: "next match" },
    { keys: ["shift+enter"], run: () => find.step(-1), hint: "previous" },
    { keys: ["ctrl+n"], label: "ctrl+n/p", run: () => find.step(1), hint: "match" },
    { keys: ["ctrl+p"], run: () => find.step(-1) },
    { keys: ["esc"], run: () => setMode("nav"), hint: "close find" },
    quitKey,
    paletteKey,
  );
  const closePicker = () => {
    setPicker(null);
    setMode(returnMode.current);
  };
  const confirmNow = () => {
    const pending = confirmation;
    closeOverlay();
    pending?.run("");
  };

  /** The bindings for the current state, most specific first, and the ones the hint bar names. */
  const keymap = ((): { readonly layers: readonly (readonly Binding[])[]; readonly hints: readonly Binding[] } => {
    switch (mode) {
      case "find":
        return { layers: [findKeys], hints: findKeys };
      case "picker": {
        const pickerKeys = [...listMove((delta) => setPickerIndex((index) => Math.max(0, Math.min(pickerEntries.length - 1, index + delta)))), { keys: [], label: "enter", hint: "choose" }, { keys: ["esc"], run: closePicker, hint: "close" }, quitKey];
        return { layers: [pickerKeys], hints: pickerKeys };
      }
      case "palette": {
        const paletteKeys = [...listMove((delta) => setPaletteIndex((index) => Math.max(0, Math.min(entries.length - 1, index + delta)))), { keys: [], label: "enter", hint: "run" }, { keys: ["esc", "ctrl+k"], run: () => setMode(returnMode.current), hint: "close" }, quitKey];
        return { layers: [paletteKeys], hints: paletteKeys };
      }
      case "confirm": {
        // Without a message box, enter confirms here; with one, the box's submit does.
        const confirmKeys = [confirmation?.message ? { keys: [], label: "enter", hint: "confirm" } : { keys: ["enter"], run: confirmNow, hint: "confirm" }, { keys: ["esc"], run: closeOverlay, hint: "cancel" }, quitKey];
        return { layers: [confirmKeys], hints: confirmKeys };
      }
    }
    // The secret field takes every key while it's focused.
    if (secret.focused) return { layers: [secret.bindings, [quitKey]], hints: secret.bindings };
    switch (mode) {
      case "input":
        if (menu) return { layers: [menuKeys, inputKeys, globalKeys], hints: menuKeys };
        if (queue.editing) return { layers: [queue.keys.editing, inputKeys, globalKeys], hints: queue.keys.editing };
        return { layers: [inputKeys, globalKeys], hints: inputKeys };
      case "filter": {
        const filterKeys = [{ keys: [], label: "enter", hint: "done" }, { keys: ["esc"], run: () => setMode("nav"), hint: "close" }];
        return { layers: [filterKeys, globalKeys], hints: filterKeys };
      }
      case "settings":
        return { layers: [settingsKeys, globalKeys], hints: settingsKeys };
      case "pull-request":
        return { layers: [pullRequestKeys, globalKeys], hints: pullRequestKeys };
      case "details":
        return { layers: [detailsKeys, globalKeys, navKeys], hints: detailsKeys };
      default:
        if (queue.focused) return { layers: [queue.keys.focused, globalKeys, navKeys], hints: queue.keys.focused };
        return { layers: [globalKeys, navKeys], hints: navHints };
    }
  })();

  const handleKey = (key: KeyEvent) => {
    // A key ends a mouse selection; it was copied when the drag ended.
    if (renderer.hasSelection) renderer.clearSelection();
    for (const layer of keymap.layers) {
      const binding = bindingFor(layer, key);
      if (binding?.run) {
        binding.run();
        return key.preventDefault();
      }
    }
    if (secret.focused && mode !== "find" && mode !== "picker" && mode !== "palette" && mode !== "confirm") {
      secret.type(key);
      key.preventDefault();
    }
  };
  useKeyboard(handleKey);

  const paletteSearch = usePaletteSearch(session, library.merged, paletteQuery, mode === "palette");
  const paletteSnapshot = useMemo(() => mergeThreadShells(library.merged, paletteSearch.result?.threads ?? []), [library.merged, paletteSearch.result]);
  const commandKey = commands.map((candidate) => `${candidate.id}:${candidate.title}:${candidate.shortcut ?? ""}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- commands are rebuilt each render; commandKey tracks what changed.
  const groups = useMemo(() => (mode === "palette" ? messageMatchGroups(paletteGroups({ query: paletteQuery, commands, snapshot: paletteSnapshot, now }), paletteSearch.result, paletteSnapshot, paletteQuery, now) : []), [mode, paletteQuery, commandKey, paletteSnapshot, paletteSearch.result]);
  const entries = paletteEntries(groups);

  // The mouse in the conversation: stable callbacks, since its rows are memoized.
  const conversationMouse: ConversationMouse = {
    respond: useEvent((decision: ProviderApprovalDecision) => respond(decision)),
    selectTurn: useEvent((messageId: string) => turns.select(messageId)),
    toggleFold: useEvent((id: string) =>
      setExpandedIds((previous) => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    ),
    loadEarlier: useEvent(() => loadEarlier()),
    menu: useEvent((target: ConversationTarget) => openConversationMenu(target)),
  };
  const copy = (label: string, text: string) => {
    copyText(renderer, text);
    say(`Copied ${label}`);
  };
  /** The right-click menu on a message or command, as a picker like the thread menu. */
  const openConversationMenu = (target: ConversationTarget) => {
    const items: PickerItem[] =
      target.kind === "command"
        ? [
            { id: "copy-command", title: "Copy command", run: () => copy("the command", target.command) },
            ...(target.output ? [{ id: "copy-output", title: "Copy output", run: () => copy("the output", target.output) }] : []),
          ]
        : [
            { id: "copy-message", title: "Copy message", run: () => copy("the message", target.text) },
            ...(target.role === "user" ? turns.menuFor(target.messageId) : []),
          ];
    if (target.kind === "message" && target.role === "user") turns.select(target.messageId);
    openPicker({ placeholder: target.kind === "command" ? "Command" : target.role === "user" ? "Your message" : "Message", groups: [{ label: truncateLabel(target.kind === "command" ? target.command : target.text, 60), items }] });
  };
  /** The right-click menu in the pull request view: its palette commands, as a picker. */
  const openPullRequestMenu = () =>
    openPicker({
      placeholder: "Pull request",
      groups: [{ label: "Pull request", items: pullRequests.commands.filter((candidate) => candidate.id.startsWith("pr-") || candidate.id.startsWith("watch-") || candidate.id.startsWith("unlink-")).map((candidate) => ({ id: candidate.id, title: candidate.title, ...(candidate.shortcut ? { hint: candidate.shortcut } : {}), run: candidate.run })) }],
    });
  /** A click in the conversation, a diff or the PR view takes the keys there, out of the composer or details. */
  const focusConversation = (event: MouseEvent) => {
    if (event.button !== 0 || (mode !== "input" && mode !== "details")) return;
    setDetailsSelected(null);
    setMode("nav");
  };

  const status =
    shell.status.type === "error"
      ? `error: ${shell.status.message}`
      : shell.status.type === "connecting"
        ? "connecting…"
        : shell.status.type === "reconnecting"
          ? "reconnecting…"
          : (shell.serverUrl ?? "");
  const listWidth = attached ? 0 : clampListWidth(listWidthPref ?? Math.min(46, Math.max(28, Math.floor(width * 0.3))), width);
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
            : queue.placeholder
              ? queue.placeholder
              : working
              ? config.followUpBehavior === "queue"
                ? "Queue a message for after this run (alt+enter to steer instead)"
                : "Steer the agent (alt+enter to queue instead)"
              : "Ask anything";
  // The model with its options, then the mode when it isn't full access; click or m to change.
  const pendingModel = draft ? undefined : models.pendingFor(threadShell?.id);
  const footer =
    currentModel && runtimeMode
      ? [
          providerConfig ? modelSummary(providerConfig, currentModel) : currentModel.model === "default" ? "" : currentModel.model,
          runtimeMode === "full-access" ? "" : (RUNTIME_MODE_LABELS[runtimeMode] ?? runtimeMode),
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
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
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={colors.bg}
      {...(resizing
        ? {
            onMouseDrag: (event: MouseEvent) => setListWidthPref(clampListWidth(event.x, width)),
            onMouseUp: () => setResizing(false),
            onMouseDragEnd: () => setResizing(false),
          }
        : {})}
    >
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1} flexShrink={0}>
        <text fg={colors.accent}>
          <strong>tui3</strong>
        </text>
        <text fg={shell.status.type === "live" ? colors.faint : colors.warn}>{`  ${status}`}</text>
        {usageInfo.note ? <text fg={colors.warn} wrapMode="none">{`  ${usageInfo.note}`}</text> : null}
        <box flexGrow={1} />
        <Button label="commands" shortcut="ctrl+k" onPress={openPalette} />
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
              if (target) threadMenu.open(target);
            }}
            onUnfold={() => setShowFolded(true)}
            showMore={unfold && library.hasOlder}
            onShowMore={() => void library.loadOlder()}
            shelfStatus={library.error ?? (library.loading ? "Loading…" : library.archived ? "Archived threads · A to go back" : null)}
          />
        )}
        {attached ? null : <ResizeHandle active={resizing} onStart={() => setResizing(true)} onReset={() => setListWidthPref(null)} />}
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          <box flexDirection="column" flexGrow={1} minHeight={0} onMouseDown={focusConversation}>
          {settingsIndex !== null ? (
            <SettingsView
              rows={settingsRows}
              server={serverSettingLines(serverConfig?.config ?? null)}
              serverStatus={serverConfig?.status ?? "loading"}
              usage={[...usageInfo.lines, ...usageSummaryLines(usage.summary), ...(usage.failed && !usage.summary ? [{ label: "Last 30 days", value: "could not read usage" }] : [])]}
              selected={settingsIndex}
              path={configPath().replace(homedir(), "~")}
              onCycle={(index) => {
                setMode("settings");
                cycleSetting(index);
              }}
            />
          ) : mode === "pull-request" && pullRequests.view ? (
            <PullRequestView view={pullRequests.view} scrollRef={scrollRef} onOpenUrl={() => pullRequests.commands.find((candidate) => candidate.id === "pr-open")?.run()} onMenu={openPullRequestMenu} onClose={pullRequests.close} />
          ) : diff ? (
            <DiffView diff={diff} scrollRef={scrollRef} selected={turns.diffContext.selected} expanded={turns.diffContext.expanded} onFile={turns.diffContext.click} />
          ) : draft ? (
            <DraftView lines={newThread.lines(models.open)} />
          ) : threadId && detailsInPlace && mode !== "find" ? (
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
              findQuery={find.open ? find.query.trim() : ""}
              findMatch={find.match}
              selectedMessageId={turns.selectedMessageId}
              session={session}
              streamCommandOutput={live && providerConfig?.environment.capabilities.commandOutputStreaming === true}
              history={watchedId === threadId ? (thread?.history ?? null) : null}
              loading={watchedId !== threadId || thread?.status === "loading"}
              error={thread?.error}
              workspaceRoot={threadShell?.worktreePath ?? undefined}
              now={now}
              scrollRef={scrollRef}
              parent={parent}
              onOpenThread={openThread}
              mouse={conversationMouse}
            />
          ) : (
            <box flexGrow={1} paddingLeft={2} paddingTop={1}>
              <text fg={colors.muted}>{shell.snapshot ? "No thread selected." : "Waiting for threads…"}</text>
            </box>
          )}
          </box>
          {workspace.note ? <text fg={workspace.setupFailed ? colors.bad : colors.muted}>{workspace.note}</text> : null}
          {find.open ? <ThreadFindBar query={find.query} focused={mode === "find"} data={find.data} pending={find.pending} error={find.error} onQuery={find.onQuery} onStep={find.step} onClose={() => setMode("nav")} /> : null}
          {mode !== "confirm" && secret.request ? <SecretPanel request={secret.request} value={secret.value} error={secret.error} busy={secret.busy} actions={secret.actions} /> : null}
          {queue.queued.length > 0 ? <QueuePanel queued={queue.queued} focus={queue.focus} editingRunId={queue.editingRunId} held={queue.queue?.held ?? false} width={width - listWidth - (detailsColumn ? DETAILS_WIDTH : 0) - 3} actions={queue.actions} /> : null}
          {mode !== "confirm" && pendingInput && questionDraft ? <QuestionPanel
              request={pendingInput}
              index={questionDraft.index}
              draft={questionDraft.answers[pendingInput.questions[questionDraft.index]?.id ?? ""]}
              onPick={pickOption}
              onNext={() => advanceQuestion(questionDraft)}
              onDismiss={threadId && pendingInput.dismissible ? () => run("Dismissed", () => session.dismissQuestion(threadId, pendingInput.requestId)) : undefined}
            /> : null}
          {mode === "confirm" && confirmation ? (
            <ConfirmBar
              confirmation={confirmation}
              message={confirmMessage}
              onMessage={setConfirmMessage}
              onSubmit={() => {
                closeOverlay();
                confirmation.run(confirmMessage);
              }}
              onCancel={closeOverlay}
            />
          ) : null}
          {menu ? <ComposerMenu items={menu.items} selected={menuSelected} empty={menu.empty} width={width - listWidth - (detailsColumn ? DETAILS_WIDTH : 0) - 2} onPick={(index) => chooseMenuItem(menu.items[index])} /> : null}
          {attach.pending.length > 0 ? (
            <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0} paddingLeft={2} paddingRight={2}>
              <text fg={colors.muted}>Attached:</text>
              {attach.pending.map((attachment) => (
                <Button key={attachment.id} label={`${attachment.name} ✕`} onPress={() => attach.remove(attachment)} />
              ))}
              <Button label="+ file" shortcut="a" onPress={attach.attachFile} />
            </box>
          ) : null}
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
            <box flexDirection="row" height={1} flexShrink={0} paddingLeft={2} paddingRight={2} onMouseDown={models.open}>
              <text fg={colors.faint}>{footer}</text>
              {pendingModel ? <text fg={colors.accent}>{"  · next message"}</text> : null}
            </box>
          ) : null}
        </box>
        {detailsColumn ? detailsPanel(false) : null}
      </box>
      <box flexDirection="row" paddingLeft={2} height={1} flexShrink={0}>
        {flash ? <text fg={flash.bad ? colors.bad : colors.good}>{flash.text}</text> : <HintBar hints={hintsFor(keymap.hints)} />}
      </box>
      {mode === "palette" ? (
        <Palette
          query={paletteQuery}
          status={paletteSearch.error ?? (paletteSearch.pending ? "Searching messages…" : null)}
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
          onMove={(step) => setPaletteIndex((index) => Math.max(0, Math.min(entries.length - 1, index + step)))}
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
          onMove={(step) => setPickerIndex((index) => Math.max(0, Math.min(pickerEntries.length - 1, index + step)))}
        />
      ) : null}
    </box>
  );
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

/** The thread list keeps room for itself and for the conversation. */
function clampListWidth(columns: number, width: number): number {
  return Math.max(20, Math.min(columns, width - MIN_CONVERSATION_WIDTH));
}

function truncateLabel(text: string, width: number): string {
  const line = firstLine(text);
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
}

function firstLine(text: string): string {
  const line = (text.trim().split("\n")[0] ?? "").replace(/\s+/g, " ");
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}
