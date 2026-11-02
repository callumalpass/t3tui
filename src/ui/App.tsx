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
import type { DiscoveredLocalServer, ProviderApprovalDecision, ScheduledTask, ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FeedState, ShellState, T3Session, ThreadState, VcsState } from "../client/session.ts";
import { detailsActions, detailsCwd, RUNTIME_MODE_LABELS, threadDetails, type DetailsAction, type GitAction } from "../model/details.ts";
import { paletteEntries, paletteGroups, type PaletteCommand } from "../model/palette.ts";
import { buildTimeline, type Timeline } from "../model/timeline.ts";
import { threadRows, type Section } from "../model/threads.ts";
import { ConfirmBar, type Confirmation } from "./ConfirmBar.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { DiffView, type DiffState } from "./DiffView.tsx";
import { Palette } from "./Palette.tsx";
import { QuestionPanel } from "./QuestionPanel.tsx";
import { colors } from "./theme.ts";
import { ThreadList } from "./ThreadList.tsx";
import { ThreadView } from "./ThreadView.tsx";

/**
 * "input": typing goes to the composer. "nav": single keys move, scroll, approve.
 * "details": j/k move through the details panel. The rest are overlays with their own input.
 */
type Mode = "input" | "nav" | "filter" | "details" | "palette" | "confirm";

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

const COMPOSER_KEYS = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
] as const;

interface QuestionDraft {
  readonly index: number;
  readonly answers: Record<string, PendingUserInputDraftAnswer>;
}

export function App(props: { readonly session: T3Session; readonly attachThreadId?: ThreadId }) {
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [composerLines, setComposerLines] = useState(1);
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [questionDrafts, setQuestionDrafts] = useState<ReadonlyMap<string, QuestionDraft>>(new Map());
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const composerRef = useRef<TextareaRenderable | null>(null);
  const drafts = useRef(new Map<string, string>());
  /** Where mode returns to when an overlay closes. */
  const returnMode = useRef<Mode>("nav");

  useEffect(() => session.onShell(setShell), [session]);
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
  const threadShell = threadRow?.thread ?? shell.snapshot?.threads.find((thread) => thread.id === threadId);
  // Pin the initial selection to a thread, or it would follow whatever sorts first.
  useEffect(() => {
    if (selectedId === undefined && rows[0]) setSelectedId(rows[0].thread.id);
  }, [selectedId, rows]);

  const openThread = useCallback((id: ThreadId) => {
    setSelectedId(id);
    setDiff(null);
    setDetailsSelected(null);
    setMode((current) => (current === "details" ? "nav" : current));
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
    if (!watchedId || !unread) return;
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
    ? { threadId: parentId, title: shell.snapshot?.threads.find((other) => other.id === parentId)?.title ?? "Parent thread" }
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
  const details = useMemo(
    () =>
      threadShell
        ? threadDetails({
            thread: threadShell,
            project,
            vcs: vcsState,
            snapshot: shell.snapshot,
            subagents: projection?.subagents ?? [],
            servers: servers?.items ?? [],
            automations: automations?.items ?? [],
            now,
          })
        : null,
    [threadShell, project, vcsState, shell.snapshot, projection?.subagents, servers, automations, now],
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
    session.workingTreeDiff(cwd, path ?? undefined).then(
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

  const clearComposer = () => {
    composerRef.current?.setText("");
    if (threadId) drafts.current.delete(threadId);
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
    if (!alternate && composer && raw.endsWith("\\")) {
      composer.setText(raw.slice(0, -1));
      composer.gotoBufferEnd();
      composer.newLine();
      return;
    }
    const text = raw.trim();
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
      return run("Declined and redirected", () => session.sendMessage(threadId, text, "steer"));
    }
    const dispatchMode = resolveComposerDispatchMode({ running: working, alternateModifier: alternate });
    run(dispatchMode === "queue" ? "Queued" : dispatchMode === "steer" ? "Steered" : "Sent", () => session.sendMessage(threadId, text, dispatchMode));
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
    // One-line inputs keep ctrl+u and ctrl+d for editing.
    const lineInput = mode === "filter" || mode === "palette" || mode === "confirm";
    if (key.name === "pagedown" || (!lineInput && key.ctrl && key.name === "d")) return scrollPage(1), true;
    if (key.name === "pageup" || (!lineInput && key.ctrl && key.name === "u")) return scrollPage(-1), true;
    if (!attached && ((key.ctrl && key.name === "n") || (key.meta && key.name === "down"))) return move(1), true;
    if (!attached && ((key.ctrl && key.name === "p") || (key.meta && key.name === "up"))) return move(-1), true;
    if (mode === "input" && key.meta && key.name === "return") return submit(true), true;
    return false;
  };

  useKeyboard((key) => {
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
        if (threadId) setMode("input");
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
      : pendingApproval
        ? pendingApproval.supportsFeedback
          ? "Send feedback to decline this request"
          : "Send a message to decline and redirect the agent"
        : pendingInput
          ? "Type your own answer, or leave this blank to use the selected option"
          : working
            ? "Steer the agent (alt+enter to queue instead)"
            : "Ask anything";
  const footer = threadShell
    ? [
        threadShell.modelSelection.model === "default" ? "" : threadShell.modelSelection.model,
        threadShell.interactionMode === "plan" ? "Plan" : "Build",
        threadShell.runtimeMode === "full-access" ? "" : (RUNTIME_MODE_LABELS[threadShell.runtimeMode] ?? threadShell.runtimeMode),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const detailsPanel = (inPlace: boolean) => (
    <DetailsPanel
      details={details}
      // Idle subagents are left out of the shell, which is where details come from.
      {...(threadId && !threadShell ? { empty: "No details for idle subagent threads. u goes to the parent." } : {})}
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
            onUnfold={() => setShowFolded(true)}
          />
        )}
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          {diff ? (
            <DiffView diff={diff} scrollRef={scrollRef} />
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
          {threadId ? (
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
                key={threadId}
                ref={composerRef}
                focused={mode === "input"}
                initialValue={drafts.current.get(threadId) ?? ""}
                placeholder={placeholder}
                placeholderColor={colors.faint}
                textColor={colors.text}
                wrapMode="word"
                keyBindings={[...COMPOSER_KEYS]}
                onSubmit={() => submit()}
                onContentChange={() => {
                  const composer = composerRef.current;
                  const text = composer?.plainText ?? "";
                  if (text) drafts.current.set(threadId, text);
                  else drafts.current.delete(threadId);
                  // Wrapped lines count too, so a long paragraph grows the box.
                  // The wrapped count can lag a programmatic newline, so hard lines are a floor.
                  setComposerLines(Math.max(text.split("\n").length, composer?.virtualLineCount ?? 1));
                  setComposerEmpty(text.trim() === "");
                }}
              />
            </box>
          ) : null}
          {threadId ? (
            <box flexDirection="row" height={1} flexShrink={0} paddingLeft={2} paddingRight={2}>
              <text fg={colors.faint}>{footer}</text>
            </box>
          ) : null}
        </box>
        {detailsColumn ? detailsPanel(false) : null}
      </box>
      <box flexDirection="row" paddingLeft={2} height={1} flexShrink={0}>
        {flash ? (
          <text fg={flash.bad ? colors.bad : colors.good}>{flash.text}</text>
        ) : (
          <text fg={colors.faint}>{hints(mode, { approval: Boolean(pendingApproval), question: Boolean(pendingInput), working, attached, diff: diff !== null, parent: parent !== undefined })}</text>
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
    </box>
  );
}

function hints(
  mode: Mode,
  state: { readonly approval: boolean; readonly question: boolean; readonly working: boolean; readonly attached: boolean; readonly diff: boolean; readonly parent: boolean },
): string {
  if (mode === "filter") return "enter done · esc close";
  if (mode === "palette") return "↑/↓ move · enter run · esc close";
  if (mode === "confirm") return "enter confirm · esc cancel";
  if (mode === "details") return "j/k move · enter open · t toggle automation · esc back";
  if (mode === "input") {
    const parts = [state.working ? "enter steer · alt+enter queue" : "enter send", "shift+enter or \\ newline", "esc navigate"];
    if (state.question) parts.unshift("1-9 pick");
    if (state.approval) parts.unshift("approval waiting: esc, then y/n");
    if (!state.attached) parts.push("ctrl+n/p thread");
    return parts.join(" · ");
  }
  if (state.diff) return "j/k scroll · esc close diff · l details";
  const parts = state.attached ? ["j/k scroll"] : ["j/k threads", "/ filter"];
  parts.push("i type", "l details", "e expand", "o earlier");
  if (state.parent) parts.push("u parent");
  parts.push("ctrl+k commands", "q quit");
  if (state.question) parts.unshift("1-9 pick · x dismiss");
  if (state.approval) parts.unshift("y approve · Y always · n decline");
  return parts.join(" · ");
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function firstLine(text: string): string {
  const line = (text.trim().split("\n")[0] ?? "").replace(/\s+/g, " ");
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}
