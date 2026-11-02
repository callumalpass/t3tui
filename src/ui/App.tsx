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
import type { ProviderApprovalDecision, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ShellState, T3Session, ThreadState, VcsState } from "../client/session.ts";
import { detailsCwd, RUNTIME_MODE_LABELS, threadDetails } from "../model/details.ts";
import { buildTimeline, type Timeline } from "../model/timeline.ts";
import { threadRows, type Section } from "../model/threads.ts";
import { QuestionPanel } from "./QuestionPanel.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { colors } from "./theme.ts";
import { ThreadList } from "./ThreadList.tsx";
import { ThreadView } from "./ThreadView.tsx";

/** "input": typing goes to the composer. "nav": single keys move, scroll, approve. */
type Mode = "input" | "nav" | "filter";

/** Holding j/k skims past threads; only subscribe to one you stop on. */
const SUBSCRIBE_DELAY_MS = 120;
/** Opening a thread marks it read once you've stayed this long, as in the web app. */
const VISIT_DELAY_MS = 1_500;
const MAX_COMPOSER_LINES = 6;
/** Sections folded to a count unless you filter or press z, like the web sidebar's. */
const FOLDED_SECTIONS: readonly Section[] = ["snoozed", "settled"];

const COMPOSER_KEYS = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
] as const;

/** The details column opens by itself on terminals at least this wide. */
const DETAILS_AUTO_WIDTH = 160;
const DETAILS_WIDTH = 36;
/** Below this, the details panel takes the conversation's place instead of a column beside it. */
const MIN_CONVERSATION_WIDTH = 70;

interface QuestionDraft {
  readonly index: number;
  readonly answers: Record<string, PendingUserInputDraftAnswer>;
}

export function App(props: { readonly session: T3Session; readonly attachThreadId?: ThreadId }) {
  const { session, attachThreadId } = props;
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [shell, setShell] = useState<ShellState>(session.getShell());
  const [selectedId, setSelectedId] = useState<ThreadId | undefined>(attachThreadId);
  const [mode, setMode] = useState<Mode>(attachThreadId ? "input" : "nav");
  const [filter, setFilter] = useState("");
  const [showFolded, setShowFolded] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  /** null follows the terminal width; d sets it for the rest of the session. */
  const [detailsPref, setDetailsPref] = useState<boolean | null>(null);
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [composerLines, setComposerLines] = useState(1);
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [questionDrafts, setQuestionDrafts] = useState<ReadonlyMap<string, QuestionDraft>>(new Map());
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const composerRef = useRef<TextareaRenderable | null>(null);
  const drafts = useRef(new Map<string, string>());

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
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.thread.id === selectedId));
  const threadId = attachThreadId ?? rows[selectedIndex]?.thread.id;
  const threadRow = allRows.find((row) => row.thread.id === threadId);
  const threadShell = threadRow?.thread ?? shell.snapshot?.threads.find((thread) => thread.id === threadId);
  // Pin the initial selection to a thread, or it would follow whatever sorts first.
  useEffect(() => {
    if (selectedId === undefined && rows[0]) setSelectedId(rows[0].thread.id);
  }, [selectedId, rows]);
  const move = (delta: number) => {
    const next = rows[Math.min(rows.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) setSelectedId(next.thread.id);
  };

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

  const showDetails = detailsPref ?? width >= DETAILS_AUTO_WIDTH;
  const project = threadShell ? shell.snapshot?.projects.find((candidate) => candidate.id === threadShell.projectId) : undefined;
  const vcsCwd = threadShell ? detailsCwd(threadShell, project) : null;
  const [vcs, setVcs] = useState<{ cwd: string; state: VcsState } | null>(null);
  useEffect(() => {
    if (!showDetails || !vcsCwd || shell.status.type !== "live") return;
    return session.watchVcs(vcsCwd, (state) => setVcs({ cwd: vcsCwd, state }));
  }, [session, showDetails, vcsCwd, shell.status.type]);
  const vcsState = vcs?.cwd === vcsCwd ? vcs.state : null;
  const details = useMemo(
    () => (showDetails && threadShell ? threadDetails(threadShell, project, vcsState, shell.snapshot) : null),
    [showDetails, threadShell, project, vcsState, shell.snapshot],
  );

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

  const say = (text: string, bad = false) => {
    setFlash({ text, bad });
    setTimeout(() => setFlash((value) => (value?.text === text ? null : value)), 4000);
  };
  const run = (label: string, action: () => Promise<unknown>) => {
    action().then(
      () => say(label),
      (error) => say(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, true),
    );
  };
  const respond = (decision: ProviderApprovalDecision) => {
    if (!threadId || !pendingApproval) return say("Nothing is waiting for approval.", true);
    run(decision === "decline" ? "Declined" : "Approved", () => session.respond(threadId, pendingApproval.requestId, decision));
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
    const text = composerRef.current?.plainText.trim() ?? "";
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
    session.loadEarlier(watchedId).catch((error) => say(`Could not load earlier turns: ${error instanceof Error ? error.message : String(error)}`, true));
  };

  const quit = () => {
    void session.stop().finally(() => {
      renderer.destroy();
      process.exit(0);
    });
  };

  const scrollPage = (direction: 1 | -1) => scrollRef.current?.scrollBy(direction * Math.max(1, height - 10));

  /** Keys that work in every mode. Returns true when handled. */
  const globalKey = (key: KeyEvent): boolean => {
    if (key.ctrl && key.name === "c") return quit(), true;
    if (key.name === "pagedown" || (key.ctrl && key.name === "d")) return scrollPage(1), true;
    if (key.name === "pageup" || (key.ctrl && key.name === "u")) return scrollPage(-1), true;
    if (!attachThreadId && ((key.ctrl && key.name === "n") || (key.meta && key.name === "down"))) return move(1), true;
    if (!attachThreadId && ((key.ctrl && key.name === "p") || (key.meta && key.name === "up"))) return move(-1), true;
    if (mode === "input" && key.meta && key.name === "return") return submit(true), true;
    return false;
  };

  useKeyboard((key) => {
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
    switch (key.name) {
      case "q":
        return quit();
      case "j":
      case "down":
        return attachThreadId ? scroll?.scrollBy(1) : move(1);
      case "k":
      case "up":
        return attachThreadId ? scroll?.scrollBy(-1) : move(-1);
      case "g":
        return key.shift ? scroll?.scrollTo(scroll.scrollHeight) : scroll?.scrollTo(0);
      case "d":
        return setDetailsPref(!showDetails);
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
      case "/":
        if (!attachThreadId) setMode("filter");
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
  const listWidth = attachThreadId ? 0 : Math.min(46, Math.max(28, Math.floor(width * 0.3)));
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

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={colors.bg}>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1} flexShrink={0}>
        <text fg={colors.accent}>
          <strong>tui3</strong>
        </text>
        <text fg={shell.status.type === "live" ? colors.faint : colors.warn}>{`  ${status}`}</text>
      </box>
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {attachThreadId ? null : (
          <ThreadList rows={rows} collapsed={collapsed} selected={selectedIndex} focused={mode === "nav"} width={listWidth} height={height - 2} filter={filter} now={now} />
        )}
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          {threadId && detailsInPlace ? (
            <box flexGrow={1} minHeight={0} flexDirection="column">
              <DetailsPanel details={details} width={width - listWidth} loading={vcsState?.status !== "live"} inPlace />
            </box>
          ) : threadId ? (
            <ThreadView
              project={threadRow?.projectName ?? ""}
              title={threadShell?.title ?? "Thread"}
              detail={threadShell?.branch ?? ""}
              timeline={current}
              history={watchedId === threadId ? (thread?.history ?? null) : null}
              loading={watchedId !== threadId || thread?.status === "loading"}
              error={thread?.error}
              workspaceRoot={threadShell?.worktreePath ?? undefined}
              now={now}
              scrollRef={scrollRef}
            />
          ) : (
            <box flexGrow={1} paddingLeft={2} paddingTop={1}>
              <text fg={colors.muted}>{shell.snapshot ? "No thread selected." : "Waiting for threads…"}</text>
            </box>
          )}
          {mode !== "filter" && pendingInput && questionDraft ? <QuestionPanel request={pendingInput} index={questionDraft.index} draft={questionDraft.answers[pendingInput.questions[questionDraft.index]?.id ?? ""]} /> : null}
          {mode === "filter" ? (
            <box title=" filter " border borderStyle="rounded" borderColor={colors.borderFocused} height={3} flexShrink={0} marginLeft={1} marginRight={1}>
              <input focused placeholder="title or project…" value={filter} onInput={(value: string) => setFilter(value)} onSubmit={() => setMode("nav")} />
            </box>
          ) : threadId ? (
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
            >
              <textarea
                key={threadId}
                ref={composerRef}
                focused={mode === "input"}
                initialValue={drafts.current.get(threadId) ?? ""}
                placeholder={placeholder}
                placeholderColor={colors.faint}
                textColor={colors.text}
                keyBindings={[...COMPOSER_KEYS]}
                onSubmit={() => submit()}
                onContentChange={() => {
                  const text = composerRef.current?.plainText ?? "";
                  if (text) drafts.current.set(threadId, text);
                  else drafts.current.delete(threadId);
                  setComposerLines(Math.max(1, text.split("\n").length));
                  setComposerEmpty(text.trim() === "");
                }}
              />
            </box>
          ) : null}
          {mode !== "filter" && threadId ? (
            <box flexDirection="row" height={1} flexShrink={0} paddingLeft={2} paddingRight={2}>
              <text fg={colors.faint}>{footer}</text>
            </box>
          ) : null}
        </box>
        {detailsColumn ? <DetailsPanel details={details} width={DETAILS_WIDTH} loading={vcsState?.status !== "live"} /> : null}
      </box>
      <box flexDirection="row" paddingLeft={2} height={1} flexShrink={0}>
        {flash ? (
          <text fg={flash.bad ? colors.bad : colors.good}>{flash.text}</text>
        ) : (
          <text fg={colors.faint}>{hints(mode, { approval: Boolean(pendingApproval), question: Boolean(pendingInput), working, attached: Boolean(attachThreadId) })}</text>
        )}
      </box>
    </box>
  );
}

function hints(mode: Mode, state: { readonly approval: boolean; readonly question: boolean; readonly working: boolean; readonly attached: boolean }): string {
  if (mode === "filter") return "enter done · esc close";
  if (mode === "input") {
    const parts = [state.working ? "enter steer · alt+enter queue" : "enter send", "shift+enter newline", "esc navigate"];
    if (state.question) parts.unshift("1-9 pick");
    if (state.approval) parts.unshift("approval waiting: esc, then y/n");
    if (!state.attached) parts.push("ctrl+n/p thread");
    return parts.join(" · ");
  }
  const parts = state.attached ? ["j/k scroll"] : ["j/k threads", "/ filter", "z settled"];
  parts.push("i type", "e expand", "o earlier", "d details", "S stop", "q quit");
  if (state.question) parts.unshift("1-9 pick · x dismiss");
  if (state.approval) parts.unshift("y approve · Y always · n decline");
  return parts.join(" · ");
}
