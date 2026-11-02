import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { ProviderApprovalDecision, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ShellState, T3Session, ThreadState } from "../client/session.ts";
import { buildTranscript } from "../model/transcript.ts";
import { lastActivity, relativeTime, threadRows } from "../model/threads.ts";
import { colors } from "./theme.ts";
import { ThreadList } from "./ThreadList.tsx";
import { ThreadView } from "./ThreadView.tsx";

type Focus = "list" | "thread" | "composer" | "filter";

export function App(props: { readonly session: T3Session; readonly attachThreadId?: ThreadId }) {
  const { session, attachThreadId } = props;
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [shell, setShell] = useState<ShellState>(session.getShell());
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<Focus>(attachThreadId ? "thread" : "list");
  const [filter, setFilter] = useState("");
  const [showReasoning, setShowReasoning] = useState(false);
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const composerRef = useRef<InputRenderable | null>(null);

  useEffect(() => session.onShell(setShell), [session]);

  const rows = useMemo(() => threadRows(shell.snapshot, { query: filter }), [shell.snapshot, filter]);
  const selectedRow = rows[Math.min(selected, rows.length - 1)];
  const threadId = attachThreadId ?? selectedRow?.thread.id;
  const threadShell = shell.snapshot?.threads.find((thread) => thread.id === threadId);

  // Keep the selection on the same thread when the list reorders under it.
  const selectedIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const index = rows.findIndex((row) => row.thread.id === id);
    if (index >= 0 && index !== selected) setSelected(index);
  }, [rows]);
  useEffect(() => {
    selectedIdRef.current = rows[selected]?.thread.id;
  }, [selected, rows]);

  const [thread, setThread] = useState<ThreadState | null>(null);
  useEffect(() => {
    setThread(null);
    if (!threadId || shell.status.type === "error" || !shell.serverUrl) return;
    return session.watchThread(threadId, setThread);
  }, [session, threadId, shell.serverUrl]);

  const transcript = useMemo(() => (thread?.projection ? buildTranscript(thread.projection) : null), [thread?.projection]);
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

  const submitDraft = (value: string) => {
    const text = value.trim();
    if (!text || !threadId) return;
    setDraft("");
    if (composerRef.current) composerRef.current.value = "";
    setFocus("thread");
    run("Sent", () => session.sendMessage(threadId, text));
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") return quit();
    if (focus === "composer" || focus === "filter") {
      if (key.name === "escape") setFocus(attachThreadId ? "thread" : focus === "filter" ? "list" : "thread");
      return;
    }
    const scroll = scrollRef.current;
    switch (key.name) {
      case "q":
        return quit();
      case "j":
      case "down":
        if (focus === "list") return setSelected((index) => Math.min(index + 1, rows.length - 1));
        return scroll?.scrollBy(1);
      case "k":
      case "up":
        if (focus === "list") return setSelected((index) => Math.max(index - 1, 0));
        return scroll?.scrollBy(-1);
      case "pagedown":
        return scroll?.scrollBy(Math.max(1, height - 8));
      case "pageup":
        return scroll?.scrollBy(-Math.max(1, height - 8));
      case "g":
        if (key.shift) return scroll?.scrollTo(scroll.scrollHeight);
        return scroll?.scrollTo(0);
      case "return":
      case "tab":
      case "l":
      case "right":
        if (!attachThreadId) setFocus(focus === "list" ? "thread" : "list");
        return;
      case "h":
      case "left":
      case "escape":
        if (!attachThreadId) setFocus("list");
        return;
      case "i":
      case "m":
        if (threadId) setFocus("composer");
        return;
      case "/":
        if (!attachThreadId) setFocus("filter");
        return;
      case "r":
        return setShowReasoning((value) => !value);
      case "y":
        return respond(key.shift ? "acceptForSession" : "accept");
      case "n":
        return respond("decline");
      case "s":
        if (threadId && key.shift) run("Stop requested", () => session.stopThread(threadId));
        return;
    }
  });

  const quit = () => {
    void session.stop().finally(() => {
      renderer.destroy();
      process.exit(0);
    });
  };

  const counts = useMemo(() => {
    let needs = 0;
    let running = 0;
    for (const row of threadRows(shell.snapshot, { recentLimit: 0 })) {
      if (row.group === "needs-you") needs++;
      else if (row.group === "running") running++;
    }
    return { needs, running };
  }, [shell.snapshot]);

  const status =
    shell.status.type === "error" ? `error: ${shell.status.message}` : shell.status.type === "connecting" ? "connecting…" : shell.serverUrl ?? "";
  const listWidth = attachThreadId ? 0 : Math.min(48, Math.max(28, Math.floor(width * 0.32)));
  const subtitle = threadShell
    ? [threadShell.status, threadShell.modelSelection.model, threadShell.branch, relativeTime(lastActivity(threadShell))].filter(Boolean).join(" · ")
    : "";

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={colors.bg}>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1} flexShrink={0}>
        <text fg={colors.accent}>
          <strong>tui3</strong>
        </text>
        <text fg={colors.muted}>{`  ${status}`}</text>
        <box flexGrow={1} />
        {counts.needs > 0 ? <text fg={colors.warn}>{`● ${counts.needs} need you  `}</text> : null}
        <text fg={colors.accent}>{`◐ ${counts.running} running`}</text>
      </box>
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {attachThreadId ? null : <ThreadList rows={rows} selected={selected} focused={focus === "list"} width={listWidth} height={height - 4} filter={filter} />}
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          {threadId ? (
            <ThreadView
              title={threadShell?.title ?? "thread"}
              subtitle={subtitle}
              transcript={transcript}
              loading={thread?.status === "loading"}
              error={thread?.error}
              focused={focus === "thread"}
              showReasoning={showReasoning}
              scrollRef={scrollRef}
            />
          ) : (
            <box border borderColor={colors.border} flexGrow={1}>
              <text fg={colors.muted}>{shell.snapshot ? "Select a thread." : "Waiting for threads…"}</text>
            </box>
          )}
          {focus === "composer" ? (
            <box title=" message (enter to send, esc to cancel) " border borderColor={colors.borderFocused} height={3} flexShrink={0}>
              <input ref={composerRef} focused placeholder="Queue a message for this thread…" value={draft} onInput={setDraft} onSubmit={(value: unknown) => submitDraft(typeof value === "string" ? value : draft)} />
            </box>
          ) : null}
          {focus === "filter" ? (
            <box title=" filter threads (esc to close) " border borderColor={colors.borderFocused} height={3} flexShrink={0}>
              <input focused placeholder="title or project…" value={filter} onInput={(value: string) => { setFilter(value); setSelected(0); }} onSubmit={() => setFocus("list")} />
            </box>
          ) : null}
        </box>
      </box>
      <box flexDirection="row" paddingLeft={1} height={1} flexShrink={0}>
        {flash ? (
          <text fg={flash.bad ? colors.bad : colors.good}>{flash.text}</text>
        ) : (
          <text fg={colors.faint}>{hints(focus, Boolean(pendingRequest), Boolean(attachThreadId))}</text>
        )}
      </box>
    </box>
  );
}

function hints(focus: Focus, pending: boolean, attached: boolean): string {
  if (focus === "composer" || focus === "filter") return "enter submit · esc cancel";
  const parts = attached ? ["j/k scroll", "g/G top/bottom"] : focus === "list" ? ["j/k move", "enter open", "/ filter"] : ["j/k scroll", "esc list", "g/G top/bottom"];
  parts.push("i message", "r reasoning", "S stop");
  if (pending) parts.unshift("y accept · Y session · n decline");
  parts.push("q quit");
  return parts.join(" · ");
}
