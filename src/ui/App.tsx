import type { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { ProviderApprovalDecision, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ShellState, T3Session, ThreadState } from "../client/session.ts";
import { buildTranscript, type Transcript } from "../model/transcript.ts";
import { isRunning, lastActivity, needsUser, relativeTime, threadRows } from "../model/threads.ts";
import { colors } from "./theme.ts";
import { ThreadList } from "./ThreadList.tsx";
import { ThreadView } from "./ThreadView.tsx";

/** "input": typing goes to the composer. "nav": single keys move, scroll, approve. */
type Mode = "input" | "nav" | "filter";

/** Holding j/k skims past threads; only subscribe to one you stop on. */
const SUBSCRIBE_DELAY_MS = 120;
const MAX_COMPOSER_LINES = 6;

const COMPOSER_KEYS = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
] as const;

export function App(props: { readonly session: T3Session; readonly attachThreadId?: ThreadId }) {
  const { session, attachThreadId } = props;
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [shell, setShell] = useState<ShellState>(session.getShell());
  const [selectedId, setSelectedId] = useState<ThreadId | undefined>(attachThreadId);
  const [mode, setMode] = useState<Mode>(attachThreadId ? "input" : "nav");
  const [filter, setFilter] = useState("");
  const [expandWork, setExpandWork] = useState(false);
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [composerLines, setComposerLines] = useState(1);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const composerRef = useRef<TextareaRenderable | null>(null);
  const drafts = useRef(new Map<string, string>());

  useEffect(() => session.onShell(setShell), [session]);

  const rows = useMemo(() => threadRows(shell.snapshot, { query: filter }), [shell.snapshot, filter]);
  // Selection is a thread id, not an index, so the list can reorder underneath it.
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.thread.id === selectedId));
  const threadId = attachThreadId ?? rows[selectedIndex]?.thread.id;
  const threadShell = shell.snapshot?.threads.find((thread) => thread.id === threadId);
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
    if (!watchedId || !shell.serverUrl) return;
    return session.watchThread(watchedId, setThread);
  }, [session, watchedId, shell.serverUrl]);

  const running = threadShell ? isRunning(threadShell) && !needsUser(threadShell) : false;
  const previousTranscript = useRef<{ id: string; transcript: Transcript } | null>(null);
  const transcript = useMemo(() => {
    if (!thread?.projection || !watchedId) return null;
    const previous = previousTranscript.current?.id === watchedId ? previousTranscript.current.transcript : null;
    const next = buildTranscript(thread.projection, { running, previous });
    previousTranscript.current = { id: watchedId, transcript: next };
    return next;
  }, [thread?.projection, watchedId, running]);
  const pendingRequest = thread?.projection?.runtimeRequests.findLast((request) => request.status === "pending" && request.kind !== "user_input");

  const say = (text: string, bad = false) => {
    setFlash({ text, bad });
    setTimeout(() => setFlash((current) => (current?.text === text ? null : current)), 4000);
  };
  const run = (label: string, action: () => Promise<void>) => {
    action().then(
      () => say(label),
      (error) => say(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, true),
    );
  };
  const respond = (decision: ProviderApprovalDecision) => {
    if (!threadId || !pendingRequest) return say("Nothing is waiting for approval.", true);
    run(decision === "decline" ? "Declined" : "Approved", () => session.respond(threadId, pendingRequest.id, decision));
  };

  const submit = () => {
    const composer = composerRef.current;
    const text = composer?.plainText.trim() ?? "";
    if (!composer || !text || !threadId) return;
    composer.setText("");
    drafts.current.delete(threadId);
    setComposerLines(1);
    run(running ? "Queued for after the current run" : "Sent", () => session.sendMessage(threadId, text));
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
    return false;
  };

  useKeyboard((key) => {
    if (globalKey(key)) return key.preventDefault();
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
      case "e":
        return setExpandWork((value) => !value);
      case "y":
        return respond(key.shift ? "acceptForSession" : "accept");
      case "n":
        return respond("decline");
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

  const counts = useMemo(() => {
    let needs = 0;
    let active = 0;
    for (const row of threadRows(shell.snapshot, { recentLimit: 0 })) {
      if (row.group === "needs-you") needs++;
      else if (row.group === "running") active++;
    }
    return { needs, active };
  }, [shell.snapshot]);

  const status = shell.status.type === "error" ? `error: ${shell.status.message}` : shell.status.type === "connecting" ? "connecting…" : (shell.serverUrl ?? "");
  const listWidth = attachThreadId ? 0 : Math.min(46, Math.max(28, Math.floor(width * 0.3)));
  const subtitle = threadShell
    ? [threadShell.modelSelection.model === "default" ? "" : threadShell.modelSelection.model, threadShell.branch, relativeTime(lastActivity(threadShell))].filter(Boolean).join(" · ")
    : "";
  const composerHeight = Math.min(MAX_COMPOSER_LINES, composerLines) + 2;

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={colors.bg}>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1} flexShrink={0}>
        <text fg={colors.accent}>
          <strong>tui3</strong>
        </text>
        <text fg={colors.faint}>{`  ${status}`}</text>
        <box flexGrow={1} />
        {counts.needs > 0 ? <text fg={colors.warn}>{`● ${counts.needs} need you   `}</text> : null}
        <text fg={colors.muted}>{`◐ ${counts.active} running`}</text>
      </box>
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {attachThreadId ? null : <ThreadList rows={rows} selected={selectedIndex} focused={mode === "nav"} width={listWidth} height={height - 2} filter={filter} />}
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          {threadId ? (
            <ThreadView
              title={threadShell?.title ?? "thread"}
              subtitle={subtitle}
              transcript={watchedId === threadId ? transcript : null}
              loading={watchedId !== threadId || thread?.status === "loading"}
              error={thread?.error}
              working={running}
              expandWork={expandWork}
              scrollRef={scrollRef}
            />
          ) : (
            <box flexGrow={1} paddingLeft={2} paddingTop={1}>
              <text fg={colors.muted}>{shell.snapshot ? "No thread selected." : "Waiting for threads…"}</text>
            </box>
          )}
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
                placeholder={mode === "input" ? (running ? "Message (queued until the current run finishes)" : "Message") : "Press i to type"}
                placeholderColor={colors.faint}
                textColor={colors.text}
                keyBindings={[...COMPOSER_KEYS]}
                onSubmit={submit}
                onContentChange={() => {
                  const text = composerRef.current?.plainText ?? "";
                  if (text) drafts.current.set(threadId, text);
                  else drafts.current.delete(threadId);
                  setComposerLines(Math.max(1, text.split("\n").length));
                }}
              />
            </box>
          ) : null}
        </box>
      </box>
      <box flexDirection="row" paddingLeft={2} height={1} flexShrink={0}>
        {flash ? <text fg={flash.bad ? colors.bad : colors.good}>{flash.text}</text> : <text fg={colors.faint}>{hints(mode, Boolean(pendingRequest), Boolean(attachThreadId))}</text>}
      </box>
    </box>
  );
}

function hints(mode: Mode, pending: boolean, attached: boolean): string {
  if (mode === "filter") return "enter done · esc close";
  if (mode === "input") {
    const parts = ["enter send", "shift+enter newline", "esc navigate"];
    if (!attached) parts.push("ctrl+n/p switch thread");
    if (pending) parts.unshift("approval waiting: esc, then y/n");
    return parts.join(" · ");
  }
  const parts = attached ? ["j/k scroll"] : ["j/k threads", "/ filter"];
  parts.push("i type", "e expand work", "pgup/pgdn scroll", "S stop", "q quit");
  if (pending) parts.unshift("y accept · Y session · n decline");
  return parts.join(" · ");
}
