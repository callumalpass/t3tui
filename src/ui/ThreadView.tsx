import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import type { ProviderApprovalDecision, ThreadId, TurnItemId } from "@t3tools/contracts";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { liveThoughtLine, workEntryDisplayIndicatesToolFailure, type ToolGroupSummaryKind } from "@t3tools/client-runtime/work-log/presentation";
import { memo, useEffect, useState, type RefObject } from "react";
import { findTextSegments } from "../model/search.ts";
import { findThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import type { OrchestrationV2SearchThreadResult } from "@t3tools/contracts";
import { FindText } from "./FindText.tsx";
import { Button, Buttons, isLeftClick, isRightClick, useHover } from "./Button.tsx";

import { CommandOutput } from "./CommandOutput.tsx";
import type { T3Session, ThreadHistory } from "../client/session.ts";
import { liveWorkEntryLabel, workEntryDisplayLabel, type MessagesTimelineRow, type Timeline, type WorkLogEntry } from "../model/timeline.ts";
import { blockFor } from "../model/transcript.ts";
import { firstLine } from "./text.ts";
import { colors, getMarkdownStyle, toneColor } from "./theme.ts";

/** What a right-click in the conversation was on. */
export type ConversationTarget =
  | { readonly kind: "message"; readonly messageId: string; readonly role: "user" | "assistant" | "system"; readonly text: string }
  /** `omitted`: the server left the output out of the thread; `source` is where to fetch it. */
  | { readonly kind: "command"; readonly command: string; readonly output: string; readonly omitted: boolean; readonly source: { readonly threadId: ThreadId; readonly itemId: TurnItemId } | null };

export interface ConversationMouse {
  readonly respond: (decision: ProviderApprovalDecision) => void;
  /** A click on a prompt: the turn cursor, as [ and ] move it. */
  readonly selectTurn: (messageId: string) => void;
  /** A click on a folded turn or work group: its own expansion, apart from e. */
  readonly toggleFold: (id: string) => void;
  readonly loadEarlier: () => void;
  readonly menu: (target: ConversationTarget) => void;
}

/** The conversation, row for row as the web app derives it (MessagesTimeline.logic). */
export function ThreadView(props: {
  readonly project: string;
  readonly title: string;
  readonly detail: string;
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
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.muted}>{props.project ? `${props.project} / ` : ""}</text>
        <text fg={colors.text}>
          <strong>{props.title}</strong>
        </text>
        <box flexGrow={1} />
        <text fg={colors.faint}>{props.detail}</text>
      </box>
      {props.parent ? (
        <box flexShrink={0} height={1} onMouseDown={() => props.onOpenThread(props.parent!.threadId)}>
          <text fg={colors.accent}>{`↰ ${props.parent.title} (u)`}</text>
        </box>
      ) : null}
      {props.error ? <text fg={colors.bad} flexShrink={0}>{props.error}</text> : null}
      <scrollbox ref={props.scrollRef} flexGrow={1} flexShrink={1} minHeight={0} stickyScroll stickyStart="bottom">
        {props.loading && !timeline ? <text fg={colors.muted}>Loading…</text> : null}
        {history?.hasMore || history?.error ? <LoadEarlier history={history} onLoad={props.mouse.loadEarlier} /> : null}
        {timeline?.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            selected={row.kind === "message" && row.message.id === props.selectedMessageId}
            session={props.session}
            streamCommandOutput={props.streamCommandOutput}
            scrollRef={props.scrollRef}
            findQuery={props.findQuery ?? ""}
            activeOccurrence={props.findMatch?.entryId === row.id ? props.findMatch.occurrence : null}
            pending={row.kind === "event" && pendingIds.has(eventRequestId(row) ?? "")}
            workspaceRoot={props.workspaceRoot}
            now={row.kind === "working" ? props.now : 0}
            workStartedAt={timeline.workStartedAt}
            onOpenThread={props.onOpenThread}
            mouse={props.mouse}
          />
        ))}
      </scrollbox>
    </box>
  );
}

function LoadEarlier({ history, onLoad }: { readonly history: ThreadHistory; readonly onLoad: () => void }) {
  const label = history.loading ? "Loading earlier turns…" : history.error ? `Could not load earlier turns: ${history.error} (o to retry)` : "Load earlier turns (o)";
  return <Divider label={label} color={history.error ? colors.bad : colors.accent} onPress={history.loading ? undefined : onLoad} />;
}

function Divider({ label, color, onPress }: { readonly label: string; readonly color: string; readonly onPress?: (() => void) | undefined }) {
  const [hover, hoverProps] = useHover();
  return (
    <box flexDirection="row" marginTop={1} {...(onPress ? { ...hoverProps, onMouseDown: (event: MouseEvent) => isLeftClick(event) && onPress() } : {})}>
      <box flexGrow={1} border={["bottom"]} borderColor={colors.border} height={1} />
      <text fg={onPress && hover ? colors.text : color} selectable={!onPress}>{` ${label} `}</text>
      <box flexGrow={1} border={["bottom"]} borderColor={colors.border} height={1} />
    </box>
  );
}

/**
 * Memoized: computeStableMessagesTimelineRows keeps unchanged rows identical,
 * so a streamed update re-renders only its own rows. `now` is nonzero only for
 * the working row, which ticks.
 */
const Row = memo(function Row(props: {
  readonly row: MessagesTimelineRow;
  readonly selected: boolean;
  readonly session: T3Session;
  readonly streamCommandOutput: boolean;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly findQuery: string;
  readonly activeOccurrence: number | null;
  readonly pending: boolean;
  readonly workspaceRoot: string | undefined;
  readonly now: number;
  readonly workStartedAt: string | null;
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
      const menu = { kind: "message", messageId: message.id, role: message.role, text: message.text } as const;
      if (message.role === "user") return <UserMessage text={message.text} messageId={message.id} selected={props.selected} onSelect={() => mouse.selectTurn(message.id)} onMenu={() => mouse.menu(menu)} />;
      if (message.role === "system") return <text marginTop={1} fg={colors.muted} onMouseDown={(event: MouseEvent) => isRightClick(event) && mouse.menu(menu)}>{message.text}</text>;
      return (
        <box marginTop={1} onMouseDown={(event: MouseEvent) => isRightClick(event) && mouse.menu(menu)}>
          <markdown content={message.text || "…"} syntaxStyle={getMarkdownStyle()} streaming={message.streaming} conceal />
        </box>
      );
    }
    case "turn-fold":
    case "attempt-fold":
      // The finished turn's work, folded: the web's turn separator.
      return (
        <Toggle onPress={() => mouse.toggleFold(row.kind === "turn-fold" ? row.runId : row.attemptId)} border>
          {(hover) => <text fg={hover ? colors.text : colors.muted} selectable={false}>{`${row.label} ${row.expanded ? "⌄" : "›"}`}</text>}
        </Toggle>
      );
    case "work-toggle":
      return (
        <Toggle onPress={() => mouse.toggleFold(row.groupId)}>
          {(hover) => <text fg={row.hasFailure ? colors.bad : hover ? colors.text : colors.muted} selectable={false}>{`${SUMMARY_GLYPH[row.summaryKind] ?? "•"} ${row.summary} ${row.expanded ? "⌄" : "›"}`}</text>}
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
    case "working": {
      const since = props.workStartedAt ? Date.parse(props.workStartedAt) : NaN;
      const verb = row.compacting ? "Compacting" : "Working";
      return <text marginTop={1} fg={colors.info}>{Number.isFinite(since) ? `◐ ${verb} for ${formatWorkingDurationLabel(props.now - since)}` : `◐ ${verb}…`}</text>;
    }
    case "thinking":
      return <text marginTop={1} fg={colors.faint}>∴ Thinking…</text>;
    case "context-compaction":
      return <Divider label={row.failed ? `${row.title ?? "Compaction failed"}${row.failure ? `: ${row.failure}` : ""}` : (row.title ?? row.label)} color={row.failed ? colors.bad : colors.faint} />;
    case "proposed-plan":
      if (props.findQuery) return <FindText segments={findTextSegments(row.proposedPlan.planMarkdown)} query={props.findQuery} activeOccurrence={props.activeOccurrence} scrollRef={props.scrollRef} />;
      return (
        <box marginTop={1} border borderStyle="rounded" borderColor={colors.plan} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={colors.plan}>
            <strong>Plan</strong>
          </text>
          <markdown content={row.proposedPlan.planMarkdown} syntaxStyle={getMarkdownStyle()} conceal />
        </box>
      );
    case "event":
      return <EventRow item={row.projectedItem.item} pending={props.pending} onRespond={mouse.respond} />;
    case "worktree-setup":
      return <text marginTop={1} fg={colors.info}>◐ Setting up worktree…</text>;
    default:
      // assistant-meta, html-render, mcp-app: nothing a terminal can show.
      return null;
  }
});

const USER_FOLD_LINES = 8;
const USER_FOLD_CHARS = 600;

/** The web's user bubble: right-aligned, at most 80% wide, folded past 8 lines or 600 characters. */
function UserMessage({ text, messageId, selected, onSelect, onMenu }: { readonly text: string; readonly messageId: string; readonly selected: boolean; readonly onSelect: () => void; readonly onMenu: () => void }) {
  const [hover, hoverProps] = useHover();
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  let shown = lines.slice(0, USER_FOLD_LINES).join("\n");
  if (shown.length > USER_FOLD_CHARS) shown = `${shown.slice(0, USER_FOLD_CHARS).trimEnd()}…`;
  const folded = shown.length < trimmed.length;
  return (
    <box id={`turn-${messageId}`} border={selected ? ["left"] : []} borderColor={colors.accent} marginTop={1} alignSelf="flex-end" maxWidth="80%" backgroundColor={hover && !selected ? colors.selectedBg : colors.userBg} paddingLeft={1} paddingRight={1} flexDirection="column" {...hoverProps} onMouseDown={(event: MouseEvent) => (isRightClick(event) ? onMenu() : isLeftClick(event) ? onSelect() : undefined)}>
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

function WorkEntry({ entry, expanded: groupExpanded, label, onOpenThread, onMenu, session, streamCommandOutput, scrollRef }: { readonly entry: WorkLogEntry; readonly expanded: boolean; readonly label: string; readonly onOpenThread: (threadId: ThreadId) => void; readonly onMenu: (target: ConversationTarget) => void; readonly session: T3Session; readonly streamCommandOutput: boolean; readonly scrollRef: RefObject<ScrollBoxRenderable | null> }) {
  const [open, setExpanded] = useState<boolean | null>(null);
  const [hover, hoverProps] = useHover();
  const expanded = open ?? groupExpanded;
  const item = entry.structuredPayload;
  const command = item?.type === "command_execution" ? item : null;
  const projected = entry.projectedItem;
  const failed = workEntryDisplayIndicatesToolFailure(entry);
  const child = childThreadOf(entry);
  const tone = failed || entry.tone === "error" ? colors.bad : child ? colors.accent : entry.tone === "thinking" ? colors.faint : colors.muted;
  const clickable = Boolean(command || child);
  const text = <text fg={clickable && hover ? colors.text : tone} selectable={!clickable}>{`${failed ? "✕" : glyphFor(entry)} ${firstLine(label)}${child ? "  ↗" : ""}`}</text>;
  const source = projected ? { threadId: projected.sourceThreadId, itemId: projected.sourceItemId } : null;
  const streaming = expanded && streamCommandOutput && source !== null;
  if (command) return <box flexDirection="column">
    <box flexDirection="row" {...hoverProps} onMouseDown={(event: MouseEvent) => (isRightClick(event) ? onMenu({ kind: "command", command: command.input, output: command.output ?? "", omitted: command.outputOmitted === true, source }) : isLeftClick(event) ? setExpanded(!expanded) : undefined)}><text fg={colors.faint} selectable={false}>{expanded ? "⌄ " : "› "}</text>{text}</box>
    {streaming ? <CommandOutput session={session} threadId={source.threadId} itemId={source.itemId} scrollRef={scrollRef} />
      : expanded && command.outputOmitted ? <OmittedOutput session={session} source={source} />
      : expanded ? <text fg={colors.muted}>{command.output || "No output."}</text> : null}
  </box>;
  return child ? <box {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && onOpenThread(child)}>{text}</box> : text;
}

/** The thread a subagent work row ran in, when it has its own. */
export function childThreadOf(entry: WorkLogEntry): ThreadId | null {
  const item = entry.structuredPayload;
  return item?.type === "subagent" ? (item.childThreadId ?? null) : null;
}

function EventRow({ item, pending, onRespond }: { readonly onRespond: (decision: ProviderApprovalDecision) => void; readonly item: MessagesTimelineRow extends infer R ? (R extends { kind: "event"; projectedItem: { item: infer I } } ? I : never) : never; readonly pending: boolean }) {
  if (item.type === "approval_request" && pending) {
    return (
      <box marginTop={1} border borderStyle="rounded" borderColor={colors.warn} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text fg={colors.warn}>
          <strong>{approvalTitle(item.requestKind)}</strong>
        </text>
        {item.prompt ? <text fg={colors.text}>{item.prompt}</text> : null}
        {item.reason ? <text fg={colors.muted}>{item.reason}</text> : null}
        <Buttons>
          <Button label="Approve" shortcut="y" color={colors.good} onPress={() => onRespond("accept")} />
          <Button label="Always allow this session" shortcut="Y" onPress={() => onRespond("acceptForSession")} />
          <Button label="Decline" shortcut="n" color={colors.bad} onPress={() => onRespond("decline")} />
        </Buttons>
      </box>
    );
  }
  const block = blockFor(item, new Set());
  if (!block) return null;
  switch (block.kind) {
    case "notice":
      return <text marginTop={1} fg={toneColor[block.tone]}>{block.text}</text>;
    case "tool":
      return <text marginTop={1} fg={toneColor[block.tone]}>{`${block.icon} ${block.label}`}</text>;
    case "approval":
      return <text marginTop={1} fg={colors.muted}>{`Approval requested: ${block.title}`}</text>;
    case "question":
      return <text marginTop={1} fg={colors.muted}>{block.pending ? "Input requested" : "Answered questions"}</text>;
    default:
      return null;
  }
}

function approvalTitle(kind: string): string {
  if (kind.includes("command")) return "Command approval";
  if (kind.includes("read")) return "File read approval";
  if (kind.includes("file")) return "File change approval";
  if (kind.includes("access")) return "App access approval";
  if (kind.includes("permission")) return "App permission approval";
  return "Approval";
}

function eventRequestId(row: Extract<MessagesTimelineRow, { kind: "event" }>): string | undefined {
  const item = row.projectedItem.item;
  return item.type === "approval_request" ? item.requestId : undefined;
}

/** A folded turn or work group: a click opens or closes just this one. */
function Toggle({ onPress, border, children }: { readonly onPress: () => void; readonly border?: boolean; readonly children: (hover: boolean) => React.ReactNode }) {
  const [hover, hoverProps] = useHover();
  return (
    <box marginTop={1} flexDirection="row" {...(border ? { border: ["bottom"] as const, borderColor: colors.border } : {})} {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && onPress()}>
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
