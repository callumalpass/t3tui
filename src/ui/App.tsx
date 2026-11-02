import { decodePasteBytes, type KeyEvent, type MouseEvent, type PasteEvent, type ScrollBoxRenderable, type Selection, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import type { OrchestrationV2ThreadShell, ProviderApprovalDecision, ThreadId, TurnItemId } from "@t3tools/contracts";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { parseFileUrlHref, resolvePathLinkTarget, splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatAttachment, OrchestrationMessageContext } from "@t3tools/contracts";
import type { ServerConfigState, ShellState, T3Session, ThreadState } from "../client/session.ts";
import { createAlerts, type Alert } from "../model/alerts.ts";
import { pastedImagePath } from "../model/attachments.ts";
import { isWebUrl, pathAt } from "../model/links.ts";
import { modelSummary } from "../model/models.ts";
import { configPath, cycleConfig, saveConfig, type T3tuiConfig } from "../config.ts";
import { saveLayout, type Layout } from "../layout.ts";
import { RUNTIME_MODE_LABELS } from "../model/details.ts";
import { paletteEntries, paletteGroups, pickerGroups, type Picker, type PickerItem } from "../model/palette.ts";
import { pullRequestRepository } from "../model/pullRequests.ts";
import { serverSettingLines, settingRows } from "../model/settings.ts";
import { resetCreditOutcome, usageLimits, usageSummaryLines } from "../model/usage.ts";
import { buildTimeline, liveWorkEntryLabel, type Timeline } from "../model/timeline.ts";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { statusLabel, type Section } from "../model/threads.ts";
import { ComposerMenu } from "./ComposerMenu.tsx";
import { ConfirmBar, type Confirmation } from "./ConfirmBar.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { DiffView, type DiffState } from "./DiffView.tsx";
import { DraftView } from "./DraftView.tsx";
import { useComposerMenu } from "./useComposerMenu.ts";
import { useDetails } from "./useDetails.ts";
import { useDraft } from "./useDraft.ts";
import { useModelPicker } from "./useModelPicker.ts";
import { useQuestion } from "./useQuestion.ts";
import { useThreadMenu } from "./useThreadMenu.ts";
import { editorCommand, scratchFile } from "./editor.ts";
import { TerminalPane } from "./TerminalPane.tsx";
import { usePanes, type Placement } from "./usePanes.ts";
import { Palette } from "./Palette.tsx";
import { ApprovalPanel } from "./ApprovalPanel.tsx";
import { LiveStatus } from "./LiveStatus.tsx";
import { QuestionPanel } from "./QuestionPanel.tsx";
import { QueuePanel } from "./QueuePanel.tsx";
import { SecretPanel } from "./SecretPanel.tsx";
import { PullRequestView } from "./PullRequestView.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { useWorkspace } from "./useWorkspace.ts";
import { usePullRequests } from "./usePullRequests.ts";
import { rendererClipboard, type Clipboard } from "./clipboard.ts";
import { composerText, useComposerChips } from "./useComposerChips.ts";
import { openInBrowser, screenTextAt } from "./links.ts";
import { desktopNotify, ring } from "./terminalOut.ts";
import { colors, statusColor, useMarkdownStyle } from "./theme.ts";
import { BAR, NO_BORDER } from "./edges.ts";
import { ThreadList } from "./ThreadList.tsx";
import { useTurns } from "./useTurns.ts";
import { ThreadView, type ConversationMouse, type ConversationTarget } from "./ThreadView.tsx";
import { Button, ResizeHandle, Tab, Tabs } from "./Button.tsx";
import { HintBar } from "./HintBar.tsx";
import { bindingFor, commandsFor, fromCommand, hinted, hintsFor, keys, type Binding } from "../model/keymap.ts";
import { firstLine, truncate } from "./text.ts";
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
 * "pane": every key but ctrl+\ goes to the program in the terminal pane.
 * The rest are overlays with their own input.
 */
type Mode = "input" | "nav" | "filter" | "details" | "palette" | "picker" | "confirm" | "settings" | "find" | "pull-request" | "pane";

/** Holding j/k skims past threads; only subscribe to one you stop on. */
const SUBSCRIBE_DELAY_MS = 120;
/** Opening a thread marks it read once you've stayed this long, as in the web app. */
const VISIT_DELAY_MS = 1_500;
const MAX_COMPOSER_LINES = 8;
/** Sections folded to a count unless you filter or press z, like the web sidebar's. */
const FOLDED_SECTIONS: readonly Section[] = ["snoozed", "settled"];
const DETAILS_WIDTH = 38;
/** The narrowest the details column can be dragged. */
const MIN_DETAILS_WIDTH = 28;
/** Below this, the details panel takes the conversation's place instead of a column beside it. */
const MIN_CONVERSATION_WIDTH = 70;
/** The fewest rows the terminal drawer keeps, and leaves the conversation; with less room it takes the conversation's place. */
const MIN_DRAWER_ROWS = 6;
const MIN_CONVERSATION_ROWS = 10;
/** The drawer's default share of the conversation's height, and the message editor's of the window's. */
const DRAWER_SHARE = 0.4;
/** The conversation this wide or wider shows diffs side by side. */
const SPLIT_DIFF_WIDTH = 140;

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

export function App(props: { readonly session: T3Session; readonly config: T3tuiConfig; readonly layout?: Layout; readonly attachThreadId?: ThreadId; readonly clipboard?: Clipboard }) {
  const { session, attachThreadId } = props;
  const attached = attachThreadId !== undefined;
  const renderer = useRenderer();
  const [clipboard] = useState(() => props.clipboard ?? rendererClipboard(renderer));
  const markdownStyle = useMarkdownStyle();
  const { width, height } = useTerminalDimensions();
  const [shell, setShell] = useState<ShellState>(session.getShell());
  // Any thread, listed or not: subagents open here too.
  const [selectedId, setSelectedId] = useState<ThreadId | undefined>(attachThreadId);
  const [mode, setMode] = useState<Mode>(attached ? "input" : "nav");
  const [filter, setFilter] = useState("");
  const [showFolded, setShowFolded] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  /** Side-by-side diffs, once toggled for the session; null follows the conversation's width. */
  const [splitDiffPref, setSplitDiffPref] = useState<boolean | null>(null);
  /** Folds opened one at a time by a click, for the open thread. */
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  /** The thread list's and details column's widths once their edges are dragged; null follows the window. */
  const [listWidthPref, setListWidthPref] = useState<number | null>(props.layout?.listWidth ?? null);
  const [detailsWidthPref, setDetailsWidthPref] = useState<number | null>(props.layout?.detailsWidth ?? null);
  const [listHidden, setListHidden] = useState(props.layout?.listHidden ?? false);
  const [detailsPref, setDetailsPrefState] = useState<boolean | null>(props.layout?.details ?? null);
  const [drawerHeightPref, setDrawerHeightPref] = useState<number | null>(props.layout?.drawerHeight ?? null);
  const [placement, setPlacement] = useState<Placement>(props.layout?.terminalPlacement ?? "bottom");
  const layoutNow = useRef<Layout>({ listWidth: listWidthPref, detailsWidth: detailsWidthPref, listHidden, details: detailsPref, drawerHeight: drawerHeightPref, terminalPlacement: placement });
  layoutNow.current = { listWidth: listWidthPref, detailsWidth: detailsWidthPref, listHidden, details: detailsPref, drawerHeight: drawerHeightPref, terminalPlacement: placement };
  /** Kept for the next run; a failed save only costs that. */
  const saveLayoutNow = (change: Partial<Layout> = {}) => void saveLayout({ ...layoutNow.current, ...change }).catch(() => {});
  const setDetailsPref = (show: boolean) => {
    setDetailsPrefState(show);
    saveLayoutNow({ details: show });
  };
  const toggleList = () => {
    setListHidden(!listHidden);
    saveLayoutNow({ listHidden: !listHidden });
  };
  const showList = !attached && !listHidden;
  /** The edge being dragged. */
  const [resizing, setResizing] = useState<"list" | "details" | "drawer" | null>(null);
  /** Where a drag of the drawer's edge started, and the drawer's height then. */
  const drawerDrag = useRef({ y: 0, height: 0 });
  const [diff, setDiff] = useState<DiffState | null>(null);
  /** The conversation's height, for the column when it takes that place; and with the drawer under it, for the drawer. */
  const [contentHeight, setContentHeight] = useState(0);
  const [areaHeight, setAreaHeight] = useState(0);
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
    if (!watchedId) return;
    // The session resubscribes after a reconnect; meanwhile the thread stays on screen.
    return session.watchThread(watchedId, setThread);
  }, [session, watchedId]);

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
  const working = current?.isWorking ?? false;
  // The status line above the composer: the timeline's working/thinking rows live here now.
  const liveRow = current?.rows.findLast((row) => row.kind === "work-live");
  const liveTool = liveRow?.kind === "work-live" ? truncate(firstLine(liveWorkEntryLabel(liveRow.entry, threadShell?.worktreePath ?? undefined, liveRow.active)), 60) : null;
  const liveVerb = current?.rows.some((row) => row.kind === "working" && row.compacting) ? "Compacting" : !liveRow && current?.rows.some((row) => row.kind === "thinking") ? "Thinking" : "Working";
  const liveSince = current?.workStartedAt ? Date.parse(current.workStartedAt) : NaN;
  const liveLabel = Number.isFinite(liveSince) ? `${liveVerb} for ${formatWorkingDurationLabel(now - liveSince)}` : `${liveVerb}…`;

  // A thread opens at its latest message: once its first snapshot renders, jump to the bottom.
  const loaded = current !== null;
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => scrollToEnd(scrollRef.current), 0);
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

  const project = threadShell ? shell.snapshot?.projects.find((candidate) => candidate.id === threadShell.projectId) : undefined;
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
  // Fetched family members count as shell threads, so lineage can name idle subagents.
  const detailsSnapshot = useMemo(() => {
    const snapshot = shell.snapshot;
    if (!snapshot || familyShells.size === 0) return snapshot;
    const listed = new Set(snapshot.threads.map((member) => member.id));
    return { ...snapshot, threads: [...snapshot.threads, ...[...familyShells.values()].filter((member) => !listed.has(member.id))] };
  }, [shell.snapshot, familyShells]);
  const say = (text: string, bad = false) => {
    setFlash({ text, bad });
    // Errors stay longer: they're longer, and they matter more.
    setTimeout(() => setFlash((value) => (value?.text === text ? null : value)), bad ? 8000 : 4000);
  };
  // Taking the mouse costs the terminal's own drag-to-select, so a drag selects here and copies on release.
  const copySelection = useEvent((selection: Selection) => {
    const text = selection.getSelectedText();
    if (!text.trim()) return;
    void clipboard.copy(text).then((copied) => (copied ? say("Copied") : say("Could not reach the clipboard.", true)));
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
  const questions = useQuestion({ session, threadId, request: pendingInput, run, say });
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
    clipboard,
    composerKey,
    cwd: attachCwd,
    maxFileBytes: serverConfig?.config ? (serverConfig.config.environment.capabilities.fileAttachments?.maxUploadBytes ?? null) : undefined,
    confirm,
    say,
  });
  const chips = useComposerChips({ composerRef, composerKey, pending: attach.pending, remove: attach.remove });
  const usage = useUsageSummary(session, settingsIndex !== null && live);
  const usageInfo = useMemo(() => usageLimits(serverConfig?.config ?? null, now), [serverConfig, now]);
  const spendResetCredit = (credit: (typeof usageInfo.credits)[number]) =>
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

  const panel = useDetails({
    session,
    live,
    width,
    pref: detailsPref,
    setPref: setDetailsPref,
    thread: threadShell,
    project,
    snapshot: detailsSnapshot,
    projection: projection ?? null,
    serverConfig: serverConfig?.config ?? null,
    now,
    config,
    diff,
    setDiff,
    automations: automationEditing,
    confirm,
    run,
    say,
    progress: (text) => setFlash({ text }),
    openThread,
    editFile: (path, cwd) => editFile(path, cwd),
    focus: (focused) => setMode(focused ? "details" : "nav"),
  });

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
    clipboard,
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

  const workspace = useWorkspace({
    session,
    renderer,
    live,
    thread: threadShell,
    project,
    serverConfig: serverConfig?.config ?? null,
    draft: draft !== null,
    diff,
    openPicker,
    openPane: (target) => panes.openTerminal(target),
    confirm,
    run,
    say,
  });
  const panes = usePanes({
    threadId: draft ? undefined : threadId,
    terminals: workspace.tabs,
    placement,
    column: panel.show,
    columnPref: detailsPref,
    setColumnPref: setDetailsPrefState,
    focused: mode === "pane",
    focus: (focused) => setMode((current) => (focused ? "pane" : current === "pane" ? "nav" : current)),
    say,
  });
  const movePlacement = () => {
    const next = placement === "bottom" ? "side" : "bottom";
    setPlacement(next);
    saveLayoutNow({ terminalPlacement: next });
  };
  useEffect(() => {
    if (mode === "details") panes.setColumnTab("details");
  }, [mode]);

  /** The composer's text in $EDITOR, in the composer's place; what's saved comes back when it exits. */
  const openEditor = () => {
    const composer = composerRef.current;
    if (!composer) return;
    const key = composerKey;
    const file = scratchFile(composerText(composer));
    panes.openMessage({
      kind: "local",
      id: `message:${file.path}`,
      title: "Message · save and quit to bring it back",
      command: editorCommand(file.path),
      onExit: (code) => {
        const edited = code === 0 ? file.read() : null;
        file.remove();
        if (edited === null) return say("The editor exited with an error; the message is unchanged.", true);
        putMessage(key, edited);
        setMode((current) => (current === "pane" ? "input" : current));
      },
    });
  };
  /** A workspace file in $EDITOR, in the column's Editor tab, when the workspace is on this machine. */
  const editFile = (path: string, cwd: string | null) => {
    const file = cwd ? resolvePathLinkTarget(path, cwd) : path;
    if (!existsSync(file)) return say(`${path} isn't on this machine.`, true);
    panes.openEditor({ kind: "local", id: `edit:${file}`, title: `Editing ${path}`, command: editorCommand(file), cwd: cwd ?? undefined, onExit: () => {} });
  };

  /** A click on a link opens it in the browser; on a path to a workspace file, in the column's editor. A drag doesn't. */
  const openAt = (x: number, y: number) => {
    if (renderer.getSelection()?.getSelectedText()) return;
    const url = renderer.getLinkAt(x, y);
    if (url && isWebUrl(url)) return openInBrowser(url, (reason) => say(`Could not open the browser (${reason}): ${url}`, true));
    const shown = url ? null : screenTextAt(renderer, x, y);
    const raw = url ? (url.startsWith("file:") ? decodeURIComponent(parseFileUrlHref(url)?.path ?? "") : url) : shown && pathAt(shown.text, shown.index);
    if (!raw || !attachCwd) return;
    const { path } = splitFilePathPosition(resolvePathLinkTarget(raw, attachCwd));
    const inside = relative(attachCwd, path);
    if (existsSync(path) && statSync(path).isFile()) editFile(inside.startsWith("..") || isAbsolute(inside) ? path : inside, attachCwd);
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

  /** Replaces a composer's text, the open one's or a stored draft's. */
  const putMessage = (key: string, text: string) => {
    const composer = composerRef.current;
    if (key !== activeComposerKey.current || !composer) return void drafts.current.set(key, text);
    chips.replaceText(composer, text);
    composer.gotoBufferEnd();
    setComposerLines(composerLineCount(composer));
    setComposerEmpty(text.trim() === "");
  };

  /**
   * A message that didn't go comes back to its composer, as the web's does: its text, its
   * attachments and its mentions, unless something new was typed there meanwhile.
   */
  const restoreMessage = (key: string, text: string, context: OrchestrationMessageContext | undefined, attachments: readonly ChatAttachment[]) => {
    const composer = composerRef.current;
    if (key === activeComposerKey.current && composer) {
      if (composerText(composer).trim()) return;
      chips.replaceText(composer, text);
      composer.gotoBufferEnd();
      setComposerLines(composerLineCount(composer));
      setComposerEmpty(text === "");
    } else {
      if (drafts.current.get(key)?.trim()) return;
      drafts.current.set(key, text);
    }
    composerMenu.remember(key, context);
    attach.restore(key, attachments);
  };
  /** Sends; on failure says why and puts the message back. */
  const send = (label: string, text: string, context: OrchestrationMessageContext | undefined, attachments: readonly ChatAttachment[], action: () => Promise<unknown>) => {
    const key = composerKey;
    action().then(
      () => say(label),
      (error) => {
        say(`Not sent: ${messageOf(error)}`, true);
        restoreMessage(key, text, context, attachments);
      },
    );
  };

  const clearComposer = () => {
    if (composerRef.current) chips.replaceText(composerRef.current, "");
    if (threadId) drafts.current.delete(threadId);
    composerMenu.forget();
    setComposerLines(1);
    setComposerEmpty(true);
  };

  /** Enter in the composer; `alternate` is alt+enter, which flips steer and queue. */
  const submit = (alternate = false) => {
    const composer = composerRef.current;
    const raw = composer ? composerText(composer) : "";
    // A trailing backslash continues onto a new line, for terminals that can't send shift+enter.
    if (!alternate && config.sendShortcut === "enter" && composer && raw.endsWith("\\")) {
      composer.gotoBufferEnd();
      composer.deleteCharBackward();
      composer.newLine();
      return;
    }
    const text = raw.trim();
    // As the web's: refused up front while disconnected, and the message stays put.
    if (!live && (text || attach.pending.length > 0)) return say("Not connected: message not sent. Reconnecting; try again once it's connected.", true);
    const attachedFiles = attach.pending;
    const context = composerMenu.context(text);
    if (draft) {
      if (!text && attachedFiles.length === 0) return;
      const taken = attach.take();
      clearComposer();
      return newThread.launch(text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, context, taken, () => restoreMessage(DRAFT_KEY, text, context, taken));
    }
    if (!threadId) return;
    if (questions.request) {
      if (attachedFiles.length > 0) return say("Attachments can't go with a question answer here; remove them first from the palette.", true);
      if (!questions.question) return;
      clearComposer();
      return questions.answer(text);
    }
    if ((queue.editing || attachedFiles.length === 0) && queue.submit(text)) return;
    if (!text && attachedFiles.length === 0) return;
    if (pendingApproval && attachedFiles.length > 0) return say("Send approval feedback without attachments or added context.", true);
    clearComposer();
    const taken = attach.take();
    const sendText = text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT;
    if (pendingApproval) {
      // As in the web composer: the message declines the request and redirects the agent.
      if (pendingApproval.supportsFeedback) return send("Declined with feedback", text, context, taken, () => session.respond(threadId, pendingApproval.requestId, "decline", text));
      return send("Declined and redirected", text, context, taken, () => session.sendMessage(threadId, sendText, "steer", undefined, context, taken));
    }
    const dispatchMode = resolveComposerDispatchMode({ running: working, alternateModifier: alternate, activeTurnDefault: config.followUpBehavior });
    const pendingModel = models.take(threadId);
    send(dispatchMode === "queue" ? "Queued" : dispatchMode === "steer" ? "Steered" : "Sent", text, context, taken, () => session.sendMessage(threadId, sendText, dispatchMode, pendingModel, context, taken));
  };

  const loadEarlier = () => {
    if (!watchedId) return;
    session.loadEarlier(watchedId).catch((error) => say(`Could not load earlier turns: ${messageOf(error)}`, true));
  };

  const quit = () => {
    void session.stop().finally(() => {
      renderer.destroy();
      void renderer.closed.finally(() => process.exit(0));
    });
  };

  const scrollPage = (direction: 1 | -1) => scrollRef.current?.scrollBy(direction * Math.max(1, height - 10));

  const turns = useTurns({ session, threadId, projection, timeline: current, config: providerConfig, cwd: panel.cwd, ignoreWhitespace: config.diffIgnoreWhitespace, enabled: draft === null, diff, setDiff, scrollRef, confirm, say,
    showConversation: () => { setMode("nav"); setDetailsPrefState((value) => (width < MIN_CONVERSATION_WIDTH + DETAILS_WIDTH ? false : value)); },
    restorePrompt: (id, text) => {
      const previous = id === activeComposerKey.current && composerRef.current ? composerText(composerRef.current) : drafts.current.get(id) ?? "";
      const next = text ? previous ? `${previous}\n\n${text}` : text : previous;
      drafts.current.set(id, next);
      if (id === activeComposerKey.current && composerRef.current) { chips.replaceText(composerRef.current, next); setMode("input"); }
    },
  });

  // Pull requests: the P view, link/unlink/watch, a draft checked out from one.
  const pullRequests = usePullRequests({
    session,
    renderer,
    clipboard,
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
  const composerMenu = useComposerMenu({
    session,
    composerRef,
    composerKey,
    active: mode === "input" && (threadId !== undefined || draft !== null),
    cwd: composerCwd,
    provider: currentModel ? providerConfig?.providers.find((candidate) => candidate.instanceId === currentModel.instanceId) : undefined,
    snapshot: shell.snapshot,
    environmentId: providerConfig?.environment.environmentId ?? null,
    threadId: draft ? null : (threadId ?? null),
    now,
    pullRequests: {
      projectId: providerConfig ? (draft ? draft.projectId : (threadShell?.projectId ?? null)) : null,
      repository: providerConfig ? pullRequestRepository(draft ? draftProject : project) : null,
      links: threadShell?.pullRequests,
    },
    onChosen: (item) => {
      if (composerRef.current) setComposerLines(composerLineCount(composerRef.current));
      if (item.action === "model") models.open();
    },
  });
  const menu = composerMenu.menu;
  // Keys. Each state has its bindings in hint order; the first one that takes a key runs it.
  // The same bindings name the hints, make them clickable, and give the palette its shortcuts.
  const hasComposer = threadId !== undefined || draft !== null;
  const scrollBy = (lines: number) => scrollRef.current?.scrollBy(lines);
  const toInput = () => {
    if (hasComposer) setMode("input");
  };
  // Keys that work wherever there's no line input to type into.
  const quitKey: Binding = { keys: ["ctrl+c"], run: quit };
  const paletteKey: Binding = { keys: ["ctrl+k"], run: openPalette };
  const terminalKey: Binding = { keys: ["ctrl+j"], run: () => panes.toggleTerminal(workspace.openTerminal) };
  const paneKey = panes.keys.pane;
  const editorKey: Binding | null = hasComposer ? { keys: ["ctrl+g"], run: openEditor, command: { id: "editor", title: "Write the message in $EDITOR", keywords: ["vim", "editor", "compose"] } } : null;
  const nextThreadKey: Binding = { keys: ["ctrl+n", "alt+↓"], label: "ctrl+n/p", run: () => move(1) };
  const previousThreadKey: Binding = { keys: ["ctrl+p", "alt+↑"], run: () => move(-1) };
  // Anywhere with a text field, ctrl+u and ctrl+d edit (delete to line start, delete forward); page up/down still scroll.
  const lineInput = mode === "filter" || mode === "input" || mode === "find" || mode === "palette" || mode === "picker" || mode === "confirm";
  const globalKeys = keys(
    paneKey,
    quitKey,
    paletteKey,
    terminalKey,
    editorKey,
    panes.keys.tabs,
    { keys: lineInput ? ["pagedown"] : ["pagedown", "ctrl+d"], run: () => scrollPage(1) },
    { keys: lineInput ? ["pageup"] : ["pageup", "ctrl+u"], run: () => scrollPage(-1) },
    !attached && nextThreadKey,
    !attached && previousThreadKey,
  );

  // Navigation: single keys move, open and act on the thread.
  const scrollDiffDown: Binding = { keys: ["j", "↓"], label: "j/k", run: () => scrollBy(1), hint: "scroll" };
  const closeDiff: Binding = { keys: ["esc", "q"], run: () => setDiff(null), hint: "close diff" };
  const typeKey: Binding = { keys: ["i", "enter", "tab"], run: toInput, hint: "type", ...(threadId ? { command: { id: "type", title: "Write a message", keywords: ["compose", "send", "steer"] } } : {}) };
  const projectKey = newThread.keys?.project;
  const modelKey = models.key;
  const worktreeKey = newThread.keys?.workspace;
  const detailsKey = panel.keys.focus;
  const cancelDraftKey = newThread.keys?.cancel;
  const navKeys = keys(
    shell.status.type === "reconnecting" && { keys: ["r"], run: () => session.retryNow(), hint: "reconnect now", command: { id: "reconnect", title: "Reconnect now", keywords: ["retry", "connection", "server"] } },
    diff && [scrollDiffDown, { keys: ["k", "↑"], run: () => scrollBy(-1) }, closeDiff],
    turns.bindings,
    pendingApproval && [
      { keys: ["y"], run: () => respond("accept"), hint: "approve", command: { id: "approve", title: "Approve request" } },
      { keys: ["Y"], run: () => respond("acceptForSession"), hint: "always", command: { id: "approve-session", title: "Always allow this session" } },
      { keys: ["n"], run: () => respond("decline"), hint: "decline", command: { id: "decline", title: "Decline request" } },
    ],
    !diff && secret.bindings,
    questions.keys?.pick,
    questions.keys?.digits,
    questions.keys?.dismiss,
    queue.keys.nav,
    library.commands(threadId).map((command) => fromCommand(command)),
    workspace.commands.map((command) => fromCommand(command)),
    threadId && !draft && { keys: ["f"], run: openFind, command: { id: "find", title: "Find in thread", keywords: ["search", "messages", "plans"] } },
    // Only P is a navigation key; the rest are the PR view's own (below).
    pullRequests.commands.filter((command) => command.id === "pull-requests").map((command) => fromCommand(command)),
    { keys: ["j", "↓"], label: "j/k", run: () => (attached ? scrollBy(1) : move(1)), hint: attached ? "scroll" : "threads" },
    { keys: ["k", "↑"], run: () => (attached ? scrollBy(-1) : move(-1)) },
    !attached && { keys: ["/"], run: () => setMode("filter"), hint: "filter", command: { id: "filter", title: "Filter threads", keywords: ["search"] } },
    !attached && { keys: ["B"], run: toggleList, command: { id: "thread-list", title: listHidden ? "Show thread list" : "Hide thread list", keywords: ["sidebar", "panel", "threads"] } },
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
    { keys: ["q"], run: quit, hint: "quit", command: { id: "quit", title: "Quit t3tui", keywords: ["exit"] } },
    panel.keys.toggle,
    panes.keys.column.map((binding) => ({ ...binding, run: () => {
      if (mode === "details") panel.leave();
      binding.run?.();
    } })),
    { keys: ["e"], run: () => setExpandAll((value) => !value), command: { id: "expand", title: expandAll ? "Collapse work" : "Expand all work", keywords: ["fold", "tool calls"] } },
    thread?.history.hasMore && { keys: ["o"], run: loadEarlier, command: { id: "earlier", title: "Load earlier turns", keywords: ["history", "older"] } },
    !attached && { keys: ["z"], run: () => setShowFolded((value) => !value), command: { id: "settled", title: showFolded ? "Hide settled threads" : "Show settled threads", keywords: ["snoozed", "archive"] } },
    threadId && working && { keys: ["S"], run: () => run("Stop requested", () => session.stopThread(threadId)), command: { id: "stop", title: "Stop thread", keywords: ["interrupt", "cancel"] } },
    { keys: ["g"], run: () => scrollRef.current?.scrollTo(0) },
    { keys: ["G"], run: () => scrollToEnd(scrollRef.current) },
    { keys: [":"], run: openPalette },
    cancelDraftKey,
  );
  // A diff and a draft name their own few keys; everything else names the lot.
  const navHints = keys(
    paneKey,
    diff
      ? [scrollDiffDown, closeDiff, detailsKey]
      : draft
        ? keys(hinted(typeKey, "write the first message"), projectKey, modelKey && hinted(modelKey, "model & mode"), worktreeKey, cancelDraftKey)
        : navKeys,
  );

  // Commands only the palette runs.
  const paletteOnly = keys(
    editorKey,
    panes.terminal && { keys: [], run: panes.hideTerminal, command: { id: "pane-close", title: "Hide the terminal", keywords: ["detach", "drawer", "close"] } },
    threadId && !draft && { keys: [], run: movePlacement, command: { id: "terminal-placement", title: placement === "bottom" ? "Move terminal to the side" : "Move terminal below", keywords: ["drawer", "column", "right", "bottom", "layout"] } },
    { keys: [], run: () => setSplitDiffPref(!splitDiff), command: { id: "split-diff", title: "Toggle split diff", keywords: ["side by side", "unified", "diff view"] } },
    queue.keys.input,
    queue.keys.palette,
    (projection?.subagents ?? []).filter((agent) => threadId && canStopSubagent(agent)).map((agent): Binding => ({ keys: [], run: () => run("Stop requested", () => session.stopSubagent(agent)), command: { id: `stop-subagent:${agent.id}`, title: `Stop subagent: ${agent.title ?? "subagent"}`, keywords: ["interrupt", "cancel", "kill"] } })),
    panel.keys.commands,
    { keys: [], run: automationEditing.newAutomation, command: { id: "new-automation", title: "New automation", keywords: ["scheduled", "task", "create", "editor"] } },
    usageInfo.credits.map((credit, index): Binding => ({ keys: [], run: () => spendResetCredit(credit), command: { id: `reset-credit:${index}`, title: `Use reset credit: ${credit.label}`, keywords: ["usage", "limit", "reset", "credit"] } })),
    // The PR view's keys are its own; the palette shows them without taking them here.
    pullRequests.commands.map((command): Binding => ({ ...fromCommand(command), keys: [], ...(command.shortcut ? { label: command.shortcut } : {}) })),
    { keys: [], run: openSettings, command: { id: "settings", title: "Settings", keywords: ["preferences", "config", "options", "notifications", "alerts"] } },
  );
  const commands = commandsFor(keys(paneKey, navKeys, paletteOnly));

  // The composer. Enter and newlines are the textarea's own; their hints only explain.
  const sendKey = config.sendShortcut === "enter" ? "enter" : "ctrl+enter";
  const inputKeys = keys(
    pendingApproval && { keys: [], label: "approval waiting:", hint: "esc, then y/n" },
    questions.keys?.pick,
    composerEmpty && questions.keys?.digits,
    { keys: [], label: sendKey, hint: working ? config.followUpBehavior : "send" },
    working && { keys: [], label: "alt+enter", hint: config.followUpBehavior === "steer" ? "queue" : "steer" },
    { keys: ["alt+enter"], run: () => submit(true) },
    queue.keys.input,
    { keys: [], label: config.sendShortcut === "enter" ? "shift+enter or \\" : "enter", hint: "newline" },
    editorKey && hinted(editorKey, "editor"),
    { keys: ["ctrl+v"], run: () => attach.paste((text) => composerRef.current?.insertText(text)) },
    { keys: ["esc"], run: () => setMode("nav"), hint: "navigate" },
    !attached && hinted(nextThreadKey, "thread"),
  );
  const menuKeys = composerMenu.bindings;

  // Lists and overlays.
  const listMove = (step: (delta: number) => void): Binding[] => [
    { keys: [], label: "↑/↓", hint: "move" },
    { keys: ["↓", "ctrl+n"], run: () => step(1) },
    { keys: ["↑", "ctrl+p"], run: () => step(-1) },
  ];
  const detailsKeys = panel.keys.focused;
  const settingsKeys = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => setSettingsIndex(Math.min(settingsRows.length - 1, (settingsIndex ?? 0) + 1)), hint: "move" },
    { keys: ["k", "↑"], run: () => setSettingsIndex(Math.max(0, (settingsIndex ?? 0) - 1)) },
    { keys: ["enter", "space"], run: () => cycleSetting(settingsIndex ?? 0), hint: "change" },
    { keys: ["esc", "q", "h", "←"], run: closeSettings, hint: "close" },
  );
  const pullRequestKeys = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => scrollBy(1), hint: "scroll" },
    { keys: ["k", "↑"], run: () => scrollBy(-1) },
    { keys: ["g"], run: () => scrollRef.current?.scrollTo(0) },
    { keys: ["G"], run: () => scrollToEnd(scrollRef.current) },
    pullRequests.viewKeys,
  );
  const findKeys = keys(
    find.bindings,
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
    // In the drawer, ctrl+j hides it again, as it leaves a terminal attached full screen.
    if (mode === "pane" && paneKey) return { layers: [keys(panes.keys.focused, panes.focusedPane === "terminal" && terminalKey)], hints: [paneKey] };
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
    if (secret.focused && mode !== "find" && mode !== "picker" && mode !== "palette" && mode !== "confirm" && mode !== "pane") {
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
    openTurnDiff: useEvent((checkpointTurnCount: number) => turns.openTurnDiff(checkpointTurnCount)),
    click: useEvent((x: number, y: number) => openAt(x, y)),
  };
  const copy = (label: string, text: string) => {
    void clipboard.copy(text);
    say(`Copied ${label}`);
  };
  /** Long output stays on the server until it's asked for. */
  const copyOmittedOutput = (source: { readonly threadId: ThreadId; readonly itemId: TurnItemId }) => () => {
    say("Fetching the output…");
    session.turnItem(source.threadId, source.itemId).then(
      (item) => (item?.type === "command_execution" && item.output ? copy("the output", item.output) : say("The command left no output.")),
      (error) => say(`Could not fetch the output: ${error instanceof Error ? error.message : String(error)}`, true),
    );
  };
  /** The right-click menu on a message or command, as a picker like the thread menu. */
  const openConversationMenu = (target: ConversationTarget) => {
    const items: PickerItem[] =
      target.kind === "command"
        ? [
            { id: "copy-command", title: "Copy command", run: () => copy("the command", target.command) },
            ...(target.output ? [{ id: "copy-output", title: "Copy output", run: () => copy("the output", target.output) }] : target.omitted && target.source ? [{ id: "copy-output", title: "Copy output", run: copyOmittedOutput(target.source) }] : []),
          ]
        : [
            { id: "copy-message", title: "Copy message", run: () => copy("the message", target.text) },
            ...(target.checkpointTurnCount !== undefined ? [{ id: "turn-diff", title: "View changes from this turn", run: () => turns.openTurnDiff(target.checkpointTurnCount!) }] : []),
            ...(target.role === "user" ? turns.menuFor(target.messageId) : []),
          ];
    if (target.kind === "message" && target.role === "user") turns.select(target.messageId);
    openPicker({ placeholder: target.kind === "command" ? "Command" : target.role === "user" ? "Your message" : "Message", groups: [{ label: truncate(firstLine(target.kind === "command" ? target.command : target.text), 60), items }] });
  };
  /** The right-click menu in the pull request view: its palette commands, as a picker. */
  const openPullRequestMenu = () =>
    openPicker({
      placeholder: "Pull request",
      groups: [{ label: "Pull request", items: pullRequests.commands.filter((candidate) => candidate.id.startsWith("pr-") || candidate.id.startsWith("watch-") || candidate.id.startsWith("unlink-")).map((candidate) => ({ id: candidate.id, title: candidate.title, ...(candidate.shortcut ? { hint: candidate.shortcut } : {}), run: candidate.run })) }],
    });
  /** A click in the conversation, a diff or the PR view takes the keys there, out of the composer or details. */
  const focusConversation = (event: MouseEvent) => {
    if (event.button !== 0 || (mode !== "input" && mode !== "details" && mode !== "pane")) return;
    panel.leave();
  };

  const status = connectionLabel(shell, now);
  // The header names the open thread (a draft opens none), with the list's status word for it.
  const headerStatus = !draft && threadRow ? statusLabel(threadRow, now) : null;
  const headerProject = threadRow?.projectName ? truncate(threadRow.projectName, 24) : "";
  const headerRoom = width - 18 - (headerProject ? headerProject.length + 3 : 0) - (headerStatus ? headerStatus.text.length + 2 : 0) - (shell.status.type !== "live" ? status.length + 2 : 0) - (usageInfo.note ? usageInfo.note.length + 2 : 0);
  const headerTitle = truncate(title, Math.max(8, headerRoom));
  const listWidth = !showList ? 0 : clampListWidth(listWidthPref ?? Math.min(46, Math.max(28, Math.floor(width * 0.3))), width);
  // Room for the details column and its edge beside the conversation; a dragged width gives way to the conversation first.
  const detailsRoom = width - listWidth - 1 - MIN_CONVERSATION_WIDTH;
  const detailsWidth = Math.min(detailsWidthPref ?? DETAILS_WIDTH, Math.max(DETAILS_WIDTH, detailsRoom));
  // The right-hand column, with its tabs, goes beside the conversation, or in its place when there's no room.
  // It stays in the tree while it holds a program, hidden or not, so the program keeps running.
  const columnInPlace = detailsWidth > detailsRoom;
  const columnMounted = panel.show || panes.editor !== null || (placement === "side" && panes.terminal !== null);
  // In the conversation's place, Details gives way to a diff, settings and the like, as the conversation does.
  const detailsGivesWay = settingsIndex !== null || (mode === "pull-request" && pullRequests.view !== null) || diff !== null || draft !== null || mode === "find" || !threadId;
  const columnVisible = panel.show && !(columnInPlace && panes.columnTab === "details" && detailsGivesWay);
  const rightColumn = columnVisible && !columnInPlace;
  // The drawer leaves the conversation some rows, or takes its place when it can't.
  const drawer = placement === "bottom" ? panes.terminal : null;
  // The edge above it takes a row too.
  const drawerRoom = areaHeight - MIN_CONVERSATION_ROWS - 1;
  const drawerInPlace = drawer !== null && drawerRoom < MIN_DRAWER_ROWS;
  const drawerHeight = Math.max(MIN_DRAWER_ROWS, Math.min(drawerRoom, drawerHeightPref ?? Math.round(areaHeight * DRAWER_SHARE)));
  const conversationHidden = (columnVisible && columnInPlace) || drawerInPlace;
  const conversationWidth = width - (showList ? listWidth + 1 : 0) - (rightColumn ? detailsWidth + 1 : 0);
  const splitDiff = splitDiffPref ?? conversationWidth >= SPLIT_DIFF_WIDTH;
  // The block's height: a row of padding on top, the text, then the model line inside it.
  // Padding row, text, a blank row, then the model line.
  const composerHeight = Math.min(MAX_COMPOSER_LINES, composerLines) + 3;
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
  // The name reads quiet; the effort and mode after it are the parts worth a colour.
  const pendingModel = draft ? undefined : models.pendingFor(threadShell?.id);
  const footerParts = ((): { readonly name: string; readonly rest: string } => {
    if (!currentModel || !runtimeMode) return { name: "", rest: "" };
    const summary = providerConfig ? modelSummary(providerConfig, currentModel) : currentModel.model === "default" ? "" : currentModel.model;
    const [name = "", ...options] = summary.split(" · ");
    const mode = runtimeMode === "full-access" ? "" : (RUNTIME_MODE_LABELS[runtimeMode] ?? runtimeMode);
    return { name, rest: [...options, mode].filter(Boolean).join(" · ") };
  })();
  const composerBarColor = mode === "input" ? colors.accent : colors.border;
  // The thread's terminal, in the drawer or the column, with a tab for each of its terminals.
  const terminalTarget = panes.terminal;
  const terminalPane = terminalTarget ? (
    <TerminalPane
      key={`${terminalTarget.threadId}:${terminalTarget.terminalId}`}
      program={{ kind: "server", id: terminalTarget.terminalId, target: terminalTarget }}
      session={session}
      focused={panes.focusedPane === "terminal"}
      header={
        <Tabs tabs={panes.tabs.map((tab) => ({ id: tab.terminalId, label: tab.label }))} active={terminalTarget.terminalId} onPick={(id) => panes.selectTab(panes.tabs.findIndex((tab) => tab.terminalId === id))}>
          <Tab label="+" onPress={workspace.newTerminal} />
        </Tabs>
      }
      onFocus={() => panes.enter("terminal")}
      onClose={(note) => panes.terminalEnded(terminalTarget, note)}
    />
  ) : null;
  const detailsPanel = (inPlace: boolean) => (
    <DetailsPanel
      details={panel.details}
      // Idle subagents are left out of the shell, which is where details come from; newer servers serve them on request.
      {...(threadId && !threadShell ? { empty: supportsFamilies ? "Loading details…" : "No details for idle subagent threads on this server. u goes to the parent." } : {})}
      width={inPlace ? width - listWidth : detailsWidth}
      loading={panel.loading}
      unfolded={panel.unfolded}
      inPlace={inPlace}
      selected={mode === "details" || (mode === "confirm" && returnMode.current === "details") ? panel.selected : null}
      onActivate={panel.activateById}
      onEdit={panel.edit}
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
            onMouseDrag: (event: MouseEvent) =>
              resizing === "list"
                ? setListWidthPref(clampListWidth(event.x, width))
                : resizing === "details"
                  ? setDetailsWidthPref(Math.max(MIN_DETAILS_WIDTH, Math.min(width - event.x - 1, detailsRoom)))
                  : setDrawerHeightPref(Math.max(MIN_DRAWER_ROWS, Math.min(drawerRoom, drawerDrag.current.height + drawerDrag.current.y - event.y))),
            onMouseUp: () => {
              setResizing(null);
              saveLayoutNow();
            },
            onMouseDragEnd: () => {
              setResizing(null);
              saveLayoutNow();
            },
          }
        : {})}
    >
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1} flexShrink={0} backgroundColor={colors.bg} overflow="hidden">
        {!draft && threadId ? (
          <>
            {headerProject ? <text fg={colors.faint} wrapMode="none" flexShrink={0}>{`${headerProject} / `}</text> : null}
            <text fg={colors.text} wrapMode="none">
              <strong>{headerTitle}</strong>
            </text>
            {headerStatus ? <text fg={statusColor(headerStatus.tone)} wrapMode="none" flexShrink={0}>{`  ${headerStatus.text}`}</text> : null}
          </>
        ) : (
          <text fg={colors.faint}>t3tui</text>
        )}
        {shell.status.type !== "live" ? <text fg={colors.warn} wrapMode="none" onMouseDown={() => session.retryNow()}>{`  ${status}`}</text> : null}
        {usageInfo.note ? <text fg={colors.warn} wrapMode="none">{`  ${usageInfo.note}`}</text> : null}
        <box flexGrow={1} />
        <Button label="ctrl+k" shortcut="commands" plain onPress={openPalette} />
      </box>
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {!showList ? null : (
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
        {!showList ? null : <ResizeHandle active={resizing === "list"} onStart={() => setResizing("list")} onReset={() => {
              setListWidthPref(null);
              saveLayoutNow({ listWidth: null });
            }} />}
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          <box flexDirection="column" flexGrow={1} minHeight={0} onSizeChange={function (this: { height: number }) { setAreaHeight(this.height); }}>
          <box flexDirection="column" flexGrow={1} minHeight={0} visible={!drawerInPlace} onMouseDown={focusConversation} onSizeChange={function (this: { height: number }) { setContentHeight(this.height); }}>
          {conversationHidden ? null : settingsIndex !== null ? (
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
            <DiffView diff={diff} split={splitDiff} scrollRef={scrollRef} selected={turns.diffContext.selected} expanded={turns.diffContext.expanded} onFile={turns.diffContext.click} />
          ) : draft ? (
            <DraftView lines={newThread.lines(models.open)} />
          ) : threadId ? (
            <ThreadView
              key={watchedId}
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
              timestampFormat={config.timestampFormat}
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
          {drawer ? (
            <>
              {drawerInPlace ? null : (
                <ResizeHandle
                  horizontal
                  active={resizing === "drawer"}
                  onStart={(event) => {
                    drawerDrag.current = { y: event.y, height: drawerHeight };
                    setResizing("drawer");
                  }}
                  onReset={() => {
                    setDrawerHeightPref(null);
                    saveLayoutNow({ drawerHeight: null });
                  }}
                />
              )}
              <box flexDirection="column" minHeight={0} {...(drawerInPlace ? { flexGrow: 1, flexShrink: 1 } : { height: drawerHeight, flexShrink: 0 })}>
                {terminalPane}
              </box>
            </>
          ) : null}
          </box>
          {workspace.note ? <text fg={workspace.setupFailed ? colors.bad : colors.muted}>{workspace.note}</text> : null}
          {find.open ? <ThreadFindBar query={find.query} focused={mode === "find"} data={find.data} pending={find.pending} error={find.error} onQuery={find.onQuery} onStep={find.step} onClose={() => setMode("nav")} /> : null}
          {mode !== "confirm" && secret.request ? <SecretPanel request={secret.request} value={secret.value} error={secret.error} busy={secret.busy} actions={secret.actions} /> : null}
          {queue.queued.length > 0 ? <QueuePanel queued={queue.queued} focus={queue.focus} editingRunId={queue.editingRunId} held={queue.queue?.held ?? false} width={width - listWidth - (rightColumn ? detailsWidth + 1 : 0) - 3} actions={queue.actions} /> : null}
          {mode !== "confirm" && questions.request && questions.draft ? <QuestionPanel
              request={questions.request}
              index={questions.draft.index}
              draft={questions.draft.answers[questions.question?.id ?? ""]}
              onPick={questions.pick}
              onNext={questions.next}
              onDismiss={questions.dismiss}
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
          {menu ? <ComposerMenu items={menu.items} selected={composerMenu.selected} empty={menu.empty} width={width - listWidth - (rightColumn ? detailsWidth + 1 : 0) - 2} onPick={composerMenu.pick} /> : null}
          {attach.pending.length > 0 ? (
            <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0} paddingLeft={2} paddingRight={2}>
              <text fg={colors.muted}>Attached:</text>
              {attach.pending.map((attachment) => (
                <Button key={attachment.id} label={`${attachment.name} ✕`} onPress={() => attach.remove(attachment)} />
              ))}
              <Button label="+ file" shortcut="a" onPress={attach.attachFile} />
            </box>
          ) : null}
          {working && threadId && !draft && !pendingApproval ? <LiveStatus label={liveLabel} tool={liveTool} /> : null}
          {panes.message ? (
            <box flexDirection="column" flexShrink={0} marginTop={1} height={Math.max(MIN_DRAWER_ROWS, Math.round((height - 2) * DRAWER_SHARE))}>
              <TerminalPane
                key={panes.message.id}
                program={panes.message}
                session={session}
                focused={panes.focusedPane === "message"}
                header={<text fg={panes.focusedPane === "message" ? colors.text : colors.muted} wrapMode="none" flexGrow={1}>{panes.message.title}</text>}
                onFocus={() => panes.enter("message")}
                onClose={panes.messageClosed}
              />
            </box>
          ) : null}
          {threadId || draft ? (
            <box flexDirection="column" flexShrink={0} marginTop={1} marginLeft={1} marginRight={1} visible={!panes.message}>
              {pendingApproval && !draft ? (
                <box marginBottom={1} flexShrink={0}>
                  <ApprovalPanel approval={pendingApproval} onRespond={respond} />
                </box>
              ) : null}
              <box
                border={["left"]}
                customBorderChars={BAR}
                borderColor={composerBarColor}
                backgroundColor={colors.element}
                height={composerHeight}
                flexShrink={0}
                flexDirection="column"
                paddingTop={1}
                paddingLeft={2}
                paddingRight={2}
                onMouseDown={() => setMode("input")}
              >
                <textarea
                  key={composerKey}
                  ref={composerRef}
                  focused={mode === "input"}
                  flexGrow={1}
                  initialValue={drafts.current.get(composerKey) ?? ""}
                  placeholder={placeholder}
                  placeholderColor={colors.faint}
                  textColor={colors.text}
                  backgroundColor={colors.element}
                  focusedBackgroundColor={colors.element}
                  wrapMode="word"
                  keyBindings={[...COMPOSER_KEYS[config.sendShortcut]]}
                  syntaxStyle={markdownStyle}
                  onSubmit={() => submit()}
                  onPaste={(event: PasteEvent) => {
                    const text = decodePasteBytes(event.bytes);
                    // An empty paste is how terminals pass on a copied image they can't send as text.
                    const path = text.trim() ? pastedImagePath(text, attachCwd) : null;
                    if (text.trim() && !(path && existsSync(path))) return;
                    event.preventDefault();
                    if (path) attach.attachPath(path);
                    else attach.paste();
                  }}
                  onCursorChange={composerMenu.sync}
                  onContentChange={() => {
                    composerMenu.sync();
                    chips.sync();
                    const composer = composerRef.current;
                    const text = composer ? composerText(composer) : "";
                    if (text) drafts.current.set(composerKey, text);
                    else drafts.current.delete(composerKey);
                    // Wrapped lines count too, so a long paragraph grows the box.
                    setComposerLines(composer ? composerLineCount(composer) : 1);
                    setComposerEmpty(text.trim() === "");
                  }}
                />
                <box
                  flexDirection="row"
                  height={1}
                  flexShrink={0}
                  marginTop={1}
                  onMouseDown={(event: MouseEvent) => {
                    event.stopPropagation();
                    models.open();
                  }}
                >
                  <text fg={colors.muted}>{footerParts.name}</text>
                  {footerParts.rest ? (
                    <>
                      <text fg={colors.muted}>{footerParts.name ? " · " : ""}</text>
                      <text fg={colors.warn}>{footerParts.rest}</text>
                    </>
                  ) : null}
                  {pendingModel ? <text fg={colors.accent}>{"  · next message"}</text> : null}
                </box>
              </box>
              <box height={1} flexShrink={0} border={["left"]} borderColor={composerBarColor} customBorderChars={{ ...NO_BORDER, vertical: "╹" }}>
                <box height={1} border={["bottom"]} borderColor={colors.element} customBorderChars={{ ...NO_BORDER, horizontal: "▀" }} />
              </box>
            </box>
          ) : null}
        </box>
        {rightColumn ? (
          <ResizeHandle active={resizing === "details"} onStart={() => setResizing("details")} onReset={() => {
            setDetailsWidthPref(null);
            saveLayoutNow({ detailsWidth: null });
          }} />
        ) : null}
        {/* One place in the tree beside the conversation or in its place, so a narrower window doesn't restart its programs. */}
        {columnMounted ? (
          <box
            visible={columnVisible}
            flexDirection="column"
            minHeight={0}
            overflow="hidden"
            backgroundColor={columnInPlace ? colors.bg : colors.panel}
            {...(columnInPlace ? { position: "absolute", left: showList ? listWidth + 1 : 0, right: 0, top: 0, height: contentHeight } : { width: detailsWidth, flexShrink: 0 })}
          >
            {panes.columnTabs.length > 1 ? (
              <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={colors.panel}>
                <Tabs tabs={panes.columnTabs} active={panes.columnTab} onPick={(id) => panes.setColumnTab(id as typeof panes.columnTab)} />
                <text fg={colors.faint} wrapMode="none" flexShrink={0}>{"{ }"}</text>
              </box>
            ) : null}
            {panes.columnTab === "details" ? detailsPanel(columnInPlace) : null}
            {panes.editor ? (
              <box flexDirection="column" flexGrow={1} minHeight={0} visible={panes.columnTab === "editor"}>
                <TerminalPane
                  key={panes.editor.id}
                  program={panes.editor}
                  session={session}
                  focused={panes.focusedPane === "editor"}
                  header={<text fg={panes.focusedPane === "editor" ? colors.text : colors.muted} wrapMode="none" flexGrow={1}>{truncate(panes.editor.title, Math.max(8, (columnInPlace ? width - listWidth : detailsWidth) - 17))}</text>}
                  onFocus={() => panes.enter("editor")}
                  onClose={panes.editorClosed}
                />
              </box>
            ) : null}
            {placement === "side" && panes.terminal ? (
              <box flexDirection="column" flexGrow={1} minHeight={0} visible={panes.columnTab === "terminal"}>
                {terminalPane}
              </box>
            ) : null}
          </box>
        ) : null}
      </box>
      <box flexDirection="row" paddingLeft={2} height={1} flexShrink={0}>
        {flash ? <text fg={flash.bad ? colors.bad : colors.good}>{flash.text}</text> : <HintBar hints={hintsFor(keymap.hints)} width={width - 2} />}
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
/** Scrolls to the last line; OpenTUI 0.8 rejects a target past the end. */
function scrollToEnd(box: ScrollBoxRenderable | null): void {
  box?.scrollTo(Math.max(0, box.scrollHeight - box.viewport.height));
}

function clampListWidth(columns: number, width: number): number {
  return Math.max(20, Math.min(columns, width - MIN_CONVERSATION_WIDTH));
}

/** The header's connection note, as the web words it: what failed, and when it tries again. */
function connectionLabel(shell: ShellState, now: number): string {
  const status = shell.status;
  if (status.type === "live") return shell.serverUrl ?? "";
  if (status.type === "connecting") return "connecting…";
  const wait = status.retryAt === null ? 0 : Math.max(0, Math.ceil((status.retryAt - now) / 1000));
  return `couldn't connect, ${wait > 0 ? `retrying in ${wait}s` : "retrying…"} · ${truncate(firstLine(status.message), 60)}`;
}
