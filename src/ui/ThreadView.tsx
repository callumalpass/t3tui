import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { liveThoughtLine, workEntryDisplayIndicatesToolFailure, type ToolGroupSummaryKind } from "@t3tools/client-runtime/work-log/presentation";
import { memo, useEffect, useState, type RefObject } from "react";
import * as DateTime from "effect/DateTime";
import { findTextSegments } from "../model/search.ts";
import { findThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import type { OrchestrationV2SearchThreadResult } from "@t3tools/contracts";
import { FindText } from "./FindText.tsx";
import { isLeftClick, isRightClick, useHover } from "./Button.tsx";
import { checkpointFileTotals, type ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import type { T3tuiConfig } from "../config.ts";

import { CommandOutput } from "./CommandOutput.tsx";
import { BAR } from "./edges.ts";
import type { T3Session, ThreadHistory } from "../client/session.ts";
import { liveWorkEntryLabel, workEntryDisplayLabel, type MessagesTimelineRow, type Timeline, type WorkLogEntry } from "../model/timeline.ts";
import { blockFor } from "../model/transcript.ts";
import { firstLine, truncate } from "./text.ts";
import { colors, getMarkdownStyle, toneColor } from "./theme.ts";

/** What a right-click in the conversation was on. */
export type ConversationTarget =
  | { readonly kind: "message"; readonly messageId: string; readonly role: "user" | "assistant" | "system"; readonly text: string; readonly checkpointTurnCount?: number }
  /** `omitted`: the server left the output out of the thread; `source` is where to fetch it. */
  | { readonly kind: "command"; readonly command: string; readonly output: string; readonly omitted: boolean; readonly source: { readonly threadId: ThreadId; readonly itemId: TurnItemId } | null };

export interface ConversationMouse {
  /** A click on a prompt: the turn cursor, as [ and ] move it. */
  readonly selectTurn: (messageId: string) => void;
  /** A click on a folded turn or work group: its own expansion, apart from e. */
  readonly toggleFold: (id: string) => void;
  readonly loadEarlier: () => void;
  readonly menu: (target: ConversationTarget) => void;
  /** A click on a changed file: that turn's diff. */
  readonly openTurnDiff: (checkpointTurnCount: number) => void;
}

/** Prose stops at this width on wide terminals, left-aligned. */
const CONTENT_WIDTH = 100;

/** The conversation, row for row as the web app derives it (MessagesTimeline.logic). */
export function ThreadView(props: {
  readonly timeline: Timeline | null;
  readonly findQuery?: string | undefined;
  readonly findMatch?: OrchestrationV2SearchThreadResult["match"] | undefined;
  readonly selectedMessageId: string | null;
  readonly session: T3Session;
  readonly streamCommandOutput: boolean;
  readonly history: ThreadHistory | null;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly workspaceRoot: string | undefined;
  readonly timestampFormat: T3tuiConfig["timestampFormat"];
  readonly now: number;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  /** For a subagent or fork: the thread it came from, shown as a link in the header. */
  readonly parent?: { readonly title: string; readonly threadId: ThreadId } | undefined;
  /** Opens another thread: a subagent from its work row, or the parent from the header. Keep it stable; rows are memoized on it. */
  readonly onOpenThread: (threadId: ThreadId) => void;
  /** The mouse in the conversation. Keep these stable too. */
  readonly mouse: ConversationMouse;
}) {
  const { timeline, history } = props;
  const pendingIds = new Set<string>(timeline?.pending.approvals.map((approval) => approval.requestId) ?? []);
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={1} backgroundColor={colors.bg}>
      {props.parent ? (
        <box flexShrink={0} height={1} onMouseDown={() => props.onOpenThread(props.parent!.threadId)}>
          <text fg={colors.accent}>{`↰ ${props.parent.title} (u)`}</text>
        </box>
      ) : null}
      {props.error ? <text fg={colors.bad} flexShrink={0}>{props.error}</text> : null}
      <scrollbox ref={props.scrollRef} flexGrow={1} flexShrink={1} minHeight={0} stickyScroll stickyStart="bottom">
        {/* Prose stops at reading width on wide terminals; the composer below stays full width. */}
        <box flexDirection="column" maxWidth={CONTENT_WIDTH}>
        {props.loading && !timeline ? <text fg={colors.muted}>Loading…</text> : null}
        {history?.hasMore || history?.error ? <LoadEarlier history={history} onLoad={props.mouse.loadEarlier} /> : null}
        {timeline?.rows.filter((row) => !isPendingApprovalRow(row, pendingIds)).map((row) => (
          <Row
            key={row.id}
            row={row}
            selected={row.kind === "message" && row.message.id === props.selectedMessageId}
            session={props.session}
            streamCommandOutput={props.streamCommandOutput}
            scrollRef={props.scrollRef}
            findQuery={props.findQuery ?? ""}
            activeOccurrence={props.findMatch?.entryId === row.id ? props.findMatch.occurrence : null}
            workspaceRoot={props.workspaceRoot}
            footer={assistantFooter(row, timeline, props.timestampFormat, props.now)}
            onOpenThread={props.onOpenThread}
            mouse={props.mouse}
          />
        ))}
        </box>
      </scrollbox>
    </box>
  );
}

/**
 * The turn footer's text: model, how long the run took, and when the reply
 * landed, day-aware as the web's is. Parts a row doesn't carry are left out;
 * only a finished turn's last reply (or its detached meta row) gets one.
 */
function assistantFooter(row: MessagesTimelineRow, timeline: Timeline, timestampFormat: T3tuiConfig["timestampFormat"], now: number): string {
  const message = row.kind === "assistant-meta" ? row.message : row.kind === "message" && row.showAssistantMeta ? row.message : null;
  if (message?.role !== "assistant" || message.streaming) return "";
  const meta = message.runId ? timeline.runMeta.get(message.runId) : undefined;
  const projected = row.kind === "message" || row.kind === "assistant-meta" ? row.projectedItem : undefined;
  const status = projected && projected.item.status !== "completed" ? projected.item.status : "";
  const parts = [
    meta?.model && meta.model !== "default" ? meta.model : "",
    meta?.durationMs !== null && meta?.durationMs !== undefined ? formatDuration(meta.durationMs) : "",
    dayAwareTime(message.updatedAt, timestampFormat, now),
    status,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The web's day-aware timestamp: a time today, "yesterday at …", then a short date. */
function dayAwareTime(iso: string, format: T3tuiConfig["timestampFormat"], now: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(format === "locale" ? {} : { hour12: format === "12-hour" }) });
  const today = new Date(now);
  const dayDiff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (dayDiff <= 0) return time;
  if (dayDiff === 1) return `yesterday at ${time}`;
  const day = date.toLocaleDateString(undefined, { month: "numeric", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" as const }) });
  return `${day} ${time}`;
}

function LoadEarlier({ history, onLoad }: { readonly history: ThreadHistory; readonly onLoad: () => void }) {
  const label = history.loading ? "Loading earlier turns…" : history.error ? `Could not load earlier turns: ${history.error} (o to retry)` : "Load earlier turns (o)";
  return <Divider label={label} color={history.error ? colors.bad : colors.accent} onPress={history.loading ? undefined : onLoad} />;
}

function Divider({ label, color, onPress }: { readonly label: string; readonly color: string; readonly onPress?: (() => void) | undefined }) {
  const [hover, hoverProps] = useHover();
  return (
    <box flexDirection="row" justifyContent="center" marginTop={1} {...(onPress ? { ...hoverProps, onMouseDown: (event: MouseEvent) => isLeftClick(event) && onPress() } : {})}>
      <text fg={onPress && hover ? colors.text : color} selectable={!onPress}>{` ${label} `}</text>
    </box>
  );
}

/**
 * Memoized: computeStableMessagesTimelineRows keeps unchanged rows identical,
 * so a streamed update re-renders only its own rows.
 */
const Row = memo(function Row(props: {
  readonly row: MessagesTimelineRow;
  readonly selected: boolean;
  readonly session: T3Session;
  readonly streamCommandOutput: boolean;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly findQuery: string;
  readonly activeOccurrence: number | null;
  readonly workspaceRoot: string | undefined;
  /** The turn footer's text for this row, or "" for none. */
  readonly footer: string;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly mouse: ConversationMouse;
}) {
  const { row, workspaceRoot, mouse } = props;
  switch (row.kind) {
    case "message": {
      const { message } = row;
      if (props.findQuery) {
        const segments = findTextSegments(message.text, message.role === "user");
        if (segments.some((segment) => findThreadSearchOccurrences(segment, props.findQuery).length > 0)) return <FindText segments={segments} query={props.findQuery} activeOccurrence={props.activeOccurrence} scrollRef={props.scrollRef} />;
      }
      const summary = row.assistantTurnDiffSummary;
      const menu = { kind: "message", messageId: message.id, role: message.role, text: message.text, ...(summary && summary.files.length > 0 ? { checkpointTurnCount: summary.checkpointTurnCount } : {}) } as const;
      if (message.role === "user") return <UserMessage text={message.text} messageId={message.id} selected={props.selected} onSelect={() => mouse.selectTurn(message.id)} onMenu={() => mouse.menu(menu)} />;
      if (message.role === "system") return <text marginTop={1} fg={colors.muted} onMouseDown={(event: MouseEvent) => isRightClick(event) && mouse.menu(menu)}>{message.text}</text>;
      return (
        <box marginTop={1} flexDirection="column" onMouseDown={(event: MouseEvent) => isRightClick(event) && mouse.menu(menu)}>
          <markdown content={message.text || "…"} syntaxStyle={getMarkdownStyle()} streaming={message.streaming} conceal />
          {summary && summary.files.length > 0 ? <ChangedFiles summary={summary} onOpenTurnDiff={mouse.openTurnDiff} /> : null}
          {props.footer ? <text marginTop={1} fg={colors.faint}>{props.footer}</text> : null}
        </box>
      );
    }
    case "assistant-meta":
      return props.footer ? <text marginTop={1} fg={colors.faint}>{props.footer}</text> : null;
    case "turn-fold":
    case "attempt-fold":
      // The finished turn's work, folded: the web's turn separator, in the work rows' columns.
      return (
        <Toggle onPress={() => mouse.toggleFold(row.kind === "turn-fold" ? row.runId : row.attemptId)}>
          {(hover) => <WorkLine glyph=" " glyphColor={colors.faint} label={`${row.label} ${row.expanded ? "⌄" : "›"}`} labelColor={hover ? colors.text : colors.faint} />}
        </Toggle>
      );
    case "work-toggle":
      return (
        <Toggle onPress={() => mouse.toggleFold(row.groupId)}>
          {(hover) => <WorkLine glyph={SUMMARY_GLYPH[row.summaryKind] ?? "•"} glyphColor={row.hasFailure ? colors.bad : colors.faint} label={`${row.summary} ${row.expanded ? "⌄" : "›"}`} labelColor={hover ? colors.text : colors.muted} />}
        </Toggle>
      );
    case "work":
      return (
        <box marginTop={row.continuesWorkLog ? 0 : 1} flexDirection="column">
          {row.groupedEntries.map((entry) => (
            <WorkEntry key={entry.id} entry={entry} expanded={row.isExpandedToolGroup} label={row.displayLabel && row.groupedEntries.length === 1 ? row.displayLabel : workEntryDisplayLabel(entry, workspaceRoot)} onOpenThread={props.onOpenThread} onMenu={mouse.menu} session={props.session} streamCommandOutput={props.streamCommandOutput} scrollRef={props.scrollRef} />
          ))}
        </box>
      );
    case "work-live":
      return (
        <box marginTop={1} flexDirection="column">
          {row.thought?.detail ? <text fg={colors.faint}>{`∴ ${liveThoughtLine(row.thought.detail)}`}</text> : null}
          <WorkEntry entry={row.entry} expanded={row.expanded} label={liveWorkEntryLabel(row.entry, workspaceRoot, row.active)} onOpenThread={props.onOpenThread} onMenu={mouse.menu} session={props.session} streamCommandOutput={props.streamCommandOutput} scrollRef={props.scrollRef} />
        </box>
      );
    case "working":
    case "thinking":
      // The live status line above the composer carries these now.
      return null;
    case "context-compaction":
      return <Divider label={row.failed ? `${row.title ?? "Compaction failed"}${row.failure ? `: ${row.failure}` : ""}` : (row.title ?? row.label)} color={row.failed ? colors.bad : colors.faint} />;
    case "proposed-plan":
      if (props.findQuery) return <FindText segments={findTextSegments(row.proposedPlan.planMarkdown)} query={props.findQuery} activeOccurrence={props.activeOccurrence} scrollRef={props.scrollRef} />;
      return (
        <box marginTop={1} border={["left"]} customBorderChars={BAR} borderColor={colors.plan} backgroundColor={colors.element} flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
          <text fg={colors.plan}>
            <strong>Plan</strong>
          </text>
          <markdown content={row.proposedPlan.planMarkdown} syntaxStyle={getMarkdownStyle()} conceal />
        </box>
      );
    case "event":
      return <EventRow item={row.projectedItem.item} />;
    case "worktree-setup":
      return (
        <text marginTop={1} fg={colors.muted}>
          <span fg={colors.info}>◐</span>
          {" Setting up worktree…"}
        </text>
      );
    default:
      // html-render, mcp-app: nothing a terminal can show.
      return null;
  }
});

/** The files a turn changed, folded to one line; a file opens that turn's diff. */
function ChangedFiles({ summary, onOpenTurnDiff }: { readonly summary: ThreadCheckpointSummary; readonly onOpenTurnDiff: (checkpointTurnCount: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, hoverProps] = useHover();
  const totals = checkpointFileTotals(summary);
  const hidden = totals.count - summary.files.length;
  const openDiff = () => onOpenTurnDiff(summary.checkpointTurnCount);
  return (
    <box marginTop={1} flexDirection="column">
      <box flexDirection="row" {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && setOpen(!open)}>
        <text fg={hover ? colors.text : colors.muted} selectable={false}>
          <span fg={hover ? colors.text : colors.faint}>✎</span>
          {` ${totals.count} ${totals.count === 1 ? "file" : "files"}  `}
        </text>
        <DiffCounts additions={totals.additions} deletions={totals.deletions} />
        <text fg={colors.faint} selectable={false}>{` ${open ? "⌄" : "›"}`}</text>
      </box>
      {open ? (
        <box flexDirection="column" paddingLeft={2}>
          {summary.files.map((file) => (
            <ChangedFile key={file.path} path={file.path} additions={file.additions} deletions={file.deletions} onPress={openDiff} />
          ))}
          {hidden > 0 ? (
            <box flexDirection="row" onMouseDown={(event: MouseEvent) => isLeftClick(event) && openDiff()}>
              <text fg={colors.faint} selectable={false}>{`… ${hidden} more ${hidden === 1 ? "file" : "files"}`}</text>
            </box>
          ) : null}
        </box>
      ) : null}
    </box>
  );
}

function ChangedFile({ path, additions, deletions, onPress }: { readonly path: string; readonly additions: number; readonly deletions: number; readonly onPress: () => void }) {
  const [hover, hoverProps] = useHover();
  const counts = (additions > 0 ? `+${additions}`.length : 0) + (deletions > 0 ? `−${deletions}`.length : 0) + (additions > 0 && deletions > 0 ? 1 : 0);
  return (
    <box flexDirection="row" {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && onPress()}>
      <text fg={hover ? colors.text : colors.muted} selectable={false} wrapMode="none">{truncate(path, CONTENT_WIDTH - 2 - (counts ? counts + 2 : 0))}</text>
      <box flexGrow={1} />
      <DiffCounts additions={additions} deletions={deletions} />
    </box>
  );
}

/** `+42 −7`, each count in its own colour; a zero count is left out. */
function DiffCounts({ additions, deletions }: { readonly additions: number; readonly deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <text selectable={false} flexShrink={0}>
      {additions > 0 ? <span fg={colors.good}>{`+${additions}`}</span> : null}
      {additions > 0 && deletions > 0 ? " " : ""}
      {deletions > 0 ? <span fg={colors.bad}>{`−${deletions}`}</span> : null}
    </text>
  );
}

const USER_FOLD_LINES = 8;
const USER_FOLD_CHARS = 600;

/** Your message: a full-width raised block, folded past 8 lines or 600 characters. */
function UserMessage({ text, messageId, selected, onSelect, onMenu }: { readonly text: string; readonly messageId: string; readonly selected: boolean; readonly onSelect: () => void; readonly onMenu: () => void }) {
  const [hover, hoverProps] = useHover();
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  let shown = lines.slice(0, USER_FOLD_LINES).join("\n");
  if (shown.length > USER_FOLD_CHARS) shown = `${shown.slice(0, USER_FOLD_CHARS).trimEnd()}…`;
  const folded = shown.length < trimmed.length;
  return (
    <box id={`turn-${messageId}`} border={["left"]} customBorderChars={BAR} borderColor={colors.accent} marginTop={1} backgroundColor={hover ? colors.elementHover : selected ? colors.selectedBg : colors.element} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="column" {...hoverProps} onMouseDown={(event: MouseEvent) => (isRightClick(event) ? onMenu() : isLeftClick(event) ? onSelect() : undefined)}>
      <text fg={colors.text}>{shown}</text>
      {folded ? <text fg={colors.faint}>{`… ${Math.max(1, lines.length - shown.split("\n").length)} more lines`}</text> : null}
    </box>
  );
}

/** Output the server left out of the thread, fetched when its row opens. */
function OmittedOutput({ session, source }: { readonly session: T3Session; readonly source: { readonly threadId: ThreadId; readonly itemId: TurnItemId } | null }) {
  const [state, setState] = useState<{ readonly text: string } | { readonly error: string } | null>(null);
  const threadId = source?.threadId;
  const itemId = source?.itemId;
  useEffect(() => {
    if (!threadId || !itemId) return;
    let cancelled = false;
    session.turnItem(threadId, itemId).then(
      (item) => !cancelled && setState({ text: item?.type === "command_execution" ? (item.output ?? "") : "" }),
      (error) => !cancelled && setState({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [session, threadId, itemId]);
  if (!source) return <text fg={colors.faint}>The output wasn't sent with the thread.</text>;
  if (!state) return <text fg={colors.faint}>Loading output…</text>;
  if ("error" in state) return <text fg={colors.bad}>{`Could not load the output: ${state.error}`}</text>;
  return <text fg={colors.muted}>{state.text || "No output."}</text>;
}

/** One work/tool line, everywhere the same: glyph, label, result details right-aligned. */
function WorkLine(props: { readonly glyph: string; readonly glyphColor: string; readonly label: string; readonly labelColor: string; readonly detail?: string; readonly selectable?: boolean }) {
  // The label gives up whatever the right-hand details take, within the reading width.
  const label = truncate(props.label, CONTENT_WIDTH - 2 - (props.detail ? props.detail.length + 2 : 0));
  return (
    <box flexDirection="row" width="100%">
      <text fg={props.glyphColor} flexShrink={0} selectable={false}>{`${props.glyph} `}</text>
      <text fg={props.labelColor} flexShrink={1} wrapMode="none" selectable={props.selectable ?? false}>{label}</text>
      {props.detail ? (
        <>
          <box flexGrow={1} />
          <text fg={colors.faint} flexShrink={0} selectable={false}>{`  ${props.detail}`}</text>
        </>
      ) : null}
    </box>
  );
}

/** What a finished entry can say on the right: a failed exit, an edit's counts, its duration. */
function workEntryDetail(entry: WorkLogEntry): string {
  const item = entry.structuredPayload;
  const parts: string[] = [];
  if (item?.type === "command_execution" && item.exitCode !== undefined && item.exitCode !== 0) parts.push(`exit ${item.exitCode}`);
  if (item?.type === "file_change" && (item.additions || item.deletions)) parts.push(`+${item.additions ?? 0} −${item.deletions ?? 0}`);
  if (item?.startedAt && item.completedAt) {
    const ms = DateTime.toEpochMillis(item.completedAt) - DateTime.toEpochMillis(item.startedAt);
    if (ms >= 1_000) parts.push(formatDuration(ms));
  }
  return parts.join(" · ");
}

function WorkEntry({ entry, expanded: groupExpanded, label, onOpenThread, onMenu, session, streamCommandOutput, scrollRef }: { readonly entry: WorkLogEntry; readonly expanded: boolean; readonly label: string; readonly onOpenThread: (threadId: ThreadId) => void; readonly onMenu: (target: ConversationTarget) => void; readonly session: T3Session; readonly streamCommandOutput: boolean; readonly scrollRef: RefObject<ScrollBoxRenderable | null> }) {
  const [open, setExpanded] = useState<boolean | null>(null);
  const [hover, hoverProps] = useHover();
  const expanded = open ?? groupExpanded;
  const item = entry.structuredPayload;
  const command = item?.type === "command_execution" ? item : null;
  const projected = entry.projectedItem;
  const failed = workEntryDisplayIndicatesToolFailure(entry);
  const child = childThreadOf(entry);
  const glyphColor = failed || entry.tone === "error" ? colors.bad : entry.toolLifecycleStatus === "inProgress" ? colors.info : colors.faint;
  const clickable = Boolean(command || child);
  const labelColor = clickable && hover ? colors.text : entry.tone === "thinking" ? colors.faint : colors.muted;
  const detail = workEntryDetail(entry);
  const line = (text: string) => <WorkLine glyph={failed ? "✕" : glyphFor(entry)} glyphColor={glyphColor} label={text} labelColor={labelColor} detail={detail} selectable={!clickable} />;
  const source = projected ? { threadId: projected.sourceThreadId, itemId: projected.sourceItemId } : null;
  const streaming = expanded && streamCommandOutput && source !== null;
  if (command) return <box flexDirection="column">
    <box flexDirection="row" {...hoverProps} onMouseDown={(event: MouseEvent) => (isRightClick(event) ? onMenu({ kind: "command", command: command.input, output: command.output ?? "", omitted: command.outputOmitted === true, source }) : isLeftClick(event) ? setExpanded(!expanded) : undefined)}>{line(`${firstLine(label)} ${expanded ? "⌄" : "›"}`)}</box>
    {expanded ? (
      <box border={["left"]} customBorderChars={BAR} borderColor={colors.border} backgroundColor={colors.element} flexDirection="column" marginTop={1} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <text fg={colors.text}>{`$ ${command.input}`}</text>
        <box flexDirection="column" marginTop={1}>
          {streaming ? <CommandOutput session={session} threadId={source.threadId} itemId={source.itemId} scrollRef={scrollRef} />
            : command.outputOmitted ? <OmittedOutput session={session} source={source} />
            : <text fg={colors.muted}>{command.output || "No output."}</text>}
        </box>
      </box>
    ) : null}
  </box>;
  return child ? <box {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && onOpenThread(child)}>{line(`${firstLine(label)}  ↗`)}</box> : line(firstLine(label));
}

/** The thread a subagent work row ran in, when it has its own. */
export function childThreadOf(entry: WorkLogEntry): ThreadId | null {
  const item = entry.structuredPayload;
  return item?.type === "subagent" ? (item.childThreadId ?? null) : null;
}

function EventRow({ item }: { readonly item: MessagesTimelineRow extends infer R ? (R extends { kind: "event"; projectedItem: { item: infer I } } ? I : never) : never }) {
  const block = blockFor(item, new Set());
  if (!block) return null;
  switch (block.kind) {
    case "notice":
      return <text marginTop={1} fg={toneColor(block.tone)}>{block.text}</text>;
    case "tool":
      return (
        <box marginTop={1}>
          <WorkLine glyph={block.icon} glyphColor={toneColor(block.tone)} label={block.label} labelColor={colors.muted} selectable />
        </box>
      );
    case "approval":
      return <text marginTop={1} fg={colors.muted}>{`Approval requested: ${block.title}`}</text>;
    case "question":
      return <text marginTop={1} fg={colors.muted}>{block.pending ? "Input requested" : "Answered questions"}</text>;
    default:
      return null;
  }
}

function eventRequestId(row: Extract<MessagesTimelineRow, { kind: "event" }>): string | undefined {
  const item = row.projectedItem.item;
  return item.type === "approval_request" ? item.requestId : undefined;
}

function entryRequestId(entry: WorkLogEntry): string | undefined {
  const item = entry.structuredPayload;
  return item?.type === "approval_request" ? item.requestId : undefined;
}

/** A live approval shows in the composer's place, not again as a timeline row. */
function isPendingApprovalRow(row: MessagesTimelineRow, pendingIds: ReadonlySet<string>): boolean {
  if (pendingIds.size === 0) return false;
  if (row.kind === "event") return pendingIds.has(eventRequestId(row) ?? "");
  if (row.kind === "work-live") return pendingIds.has(entryRequestId(row.entry) ?? "");
  return row.kind === "work" && row.groupedEntries.length > 0 && row.groupedEntries.every((entry) => pendingIds.has(entryRequestId(entry) ?? ""));
}

/** A folded turn or work group: a click opens or closes just this one. */
function Toggle({ onPress, children }: { readonly onPress: () => void; readonly children: (hover: boolean) => React.ReactNode }) {
  const [hover, hoverProps] = useHover();
  return (
    <box marginTop={1} flexDirection="row" {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && onPress()}>
      {children(hover)}
    </box>
  );
}

/** Terminal stand-ins for the web's lucide icons. */
const SUMMARY_GLYPH: Partial<Record<ToolGroupSummaryKind, string>> = {
  read: "◉",
  edit: "✎",
  command: "$",
  "code-search": "⌕",
  search: "⌕",
  browser: "◍",
  reasoning: "∴",
  "thread-create": "↳",
  "agent-tool": "↳",
  "pull-request": "⇅",
  "dynamic-tool": "⚙",
  other: "⚙",
  mixed: "•",
};

function glyphFor(entry: WorkLogEntry): string {
  if (entry.tone === "thinking" || entry.itemType === "reasoning") return "∴";
  if (entry.command) return "$";
  if (entry.changedFiles?.length) return "✎";
  if (entry.itemType === "subagent") return "↳";
  if (entry.itemType === "file_search" || entry.itemType === "web_search") return "⌕";
  if (entry.itemType === "todo_list") return "☐";
  return "·";
}
