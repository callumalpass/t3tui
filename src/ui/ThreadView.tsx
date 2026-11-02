import type { ScrollBoxRenderable } from "@opentui/core";
import type { ThreadId } from "@t3tools/contracts";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { liveThoughtLine, workEntryDisplayIndicatesToolFailure, type ToolGroupSummaryKind } from "@t3tools/client-runtime/work-log/presentation";
import { memo, type RefObject } from "react";
import { findTextSegments } from "../model/search.ts";
import { findThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import type { OrchestrationV2SearchThreadResult } from "@t3tools/contracts";
import { FindText } from "./FindText.tsx";

import type { ThreadHistory } from "../client/session.ts";
import { liveWorkEntryLabel, workEntryDisplayLabel, type MessagesTimelineRow, type Timeline, type WorkLogEntry } from "../model/timeline.ts";
import { blockFor } from "../model/transcript.ts";
import { colors, getMarkdownStyle, toneColor } from "./theme.ts";

/** The conversation, row for row as the web app derives it (MessagesTimeline.logic). */
export function ThreadView(props: {
  readonly project: string;
  readonly title: string;
  readonly detail: string;
  readonly timeline: Timeline | null;
  readonly findQuery?: string | undefined;
  readonly findMatch?: OrchestrationV2SearchThreadResult["match"] | undefined;
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
        {history?.hasMore || history?.error ? <LoadEarlier history={history} /> : null}
        {timeline?.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            scrollRef={props.scrollRef}
            findQuery={props.findQuery ?? ""}
            activeOccurrence={props.findMatch?.entryId === row.id ? props.findMatch.occurrence : null}
            pending={row.kind === "event" && pendingIds.has(eventRequestId(row) ?? "")}
            workspaceRoot={props.workspaceRoot}
            now={row.kind === "working" ? props.now : 0}
            workStartedAt={timeline.workStartedAt}
            onOpenThread={props.onOpenThread}
          />
        ))}
      </scrollbox>
    </box>
  );
}

function LoadEarlier({ history }: { readonly history: ThreadHistory }) {
  const label = history.loading ? "Loading earlier turns…" : history.error ? `Could not load earlier turns: ${history.error} (o to retry)` : "Load earlier turns (o)";
  return <Divider label={label} color={history.error ? colors.bad : colors.faint} />;
}

function Divider({ label, color }: { readonly label: string; readonly color: string }) {
  return (
    <box flexDirection="row" marginTop={1}>
      <box flexGrow={1} border={["bottom"]} borderColor={colors.border} height={1} />
      <text fg={color}>{` ${label} `}</text>
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
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly findQuery: string;
  readonly activeOccurrence: number | null;
  readonly pending: boolean;
  readonly workspaceRoot: string | undefined;
  readonly now: number;
  readonly workStartedAt: string | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { row, workspaceRoot } = props;
  switch (row.kind) {
    case "message": {
      const { message } = row;
      if (props.findQuery) {
        const segments = findTextSegments(message.text, message.role === "user");
        if (segments.some((segment) => findThreadSearchOccurrences(segment, props.findQuery).length > 0)) return <FindText segments={segments} query={props.findQuery} activeOccurrence={props.activeOccurrence} scrollRef={props.scrollRef} />;
      }
      if (message.role === "user") return <UserMessage text={message.text} />;
      if (message.role === "system") return <text marginTop={1} fg={colors.muted}>{message.text}</text>;
      return (
        <box marginTop={1}>
          <markdown content={message.text || "…"} syntaxStyle={getMarkdownStyle()} streaming={message.streaming} conceal />
        </box>
      );
    }
    case "turn-fold":
    case "attempt-fold":
      // The finished turn's work, folded: the web's turn separator.
      return (
        <box marginTop={1} border={["bottom"]} borderColor={colors.border} flexDirection="row">
          <text fg={colors.muted}>{`${row.label} ${row.expanded ? "⌄" : "›"}`}</text>
        </box>
      );
    case "work-toggle":
      return (
        <box marginTop={1} flexDirection="row">
          <text fg={row.hasFailure ? colors.bad : colors.muted}>{`${SUMMARY_GLYPH[row.summaryKind] ?? "•"} ${row.summary} ${row.expanded ? "⌄" : "›"}`}</text>
        </box>
      );
    case "work":
      return (
        <box marginTop={row.continuesWorkLog ? 0 : 1} flexDirection="column">
          {row.groupedEntries.map((entry) => (
            <WorkEntry key={entry.id} entry={entry} label={row.displayLabel && row.groupedEntries.length === 1 ? row.displayLabel : workEntryDisplayLabel(entry, workspaceRoot)} onOpenThread={props.onOpenThread} />
          ))}
        </box>
      );
    case "work-live":
      return (
        <box marginTop={1} flexDirection="column">
          {row.thought?.detail ? <text fg={colors.faint}>{`∴ ${liveThoughtLine(row.thought.detail)}`}</text> : null}
          <box onMouseDown={() => openChild(row.entry, props.onOpenThread)}>
            <text fg={row.active ? colors.info : colors.muted}>{`${row.active ? "◐" : glyphFor(row.entry)} ${liveWorkEntryLabel(row.entry, workspaceRoot, row.active)}${childThreadOf(row.entry) ? "  ↗" : ""}`}</text>
          </box>
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
      return <EventRow item={row.projectedItem.item} pending={props.pending} />;
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
function UserMessage({ text }: { readonly text: string }) {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  let shown = lines.slice(0, USER_FOLD_LINES).join("\n");
  if (shown.length > USER_FOLD_CHARS) shown = `${shown.slice(0, USER_FOLD_CHARS).trimEnd()}…`;
  const folded = shown.length < trimmed.length;
  return (
    <box marginTop={1} alignSelf="flex-end" maxWidth="80%" backgroundColor={colors.userBg} paddingLeft={1} paddingRight={1} flexDirection="column">
      <text fg={colors.text}>{shown}</text>
      {folded ? <text fg={colors.faint}>{`… ${Math.max(1, lines.length - shown.split("\n").length)} more lines`}</text> : null}
    </box>
  );
}

function WorkEntry({ entry, label, onOpenThread }: { readonly entry: WorkLogEntry; readonly label: string; readonly onOpenThread: (threadId: ThreadId) => void }) {
  const failed = workEntryDisplayIndicatesToolFailure(entry);
  const child = childThreadOf(entry);
  const tone = failed || entry.tone === "error" ? colors.bad : child ? colors.accent : entry.tone === "thinking" ? colors.faint : colors.muted;
  const text = <text fg={tone}>{`${failed ? "✕" : glyphFor(entry)} ${firstLine(label)}${child ? "  ↗" : ""}`}</text>;
  return child ? <box onMouseDown={() => onOpenThread(child)}>{text}</box> : text;
}

/** The thread a subagent work row ran in, when it has its own. */
export function childThreadOf(entry: WorkLogEntry): ThreadId | null {
  const item = entry.structuredPayload;
  return item?.type === "subagent" ? (item.childThreadId ?? null) : null;
}

function openChild(entry: WorkLogEntry, onOpenThread: (threadId: ThreadId) => void): void {
  const child = childThreadOf(entry);
  if (child) onOpenThread(child);
}

function EventRow({ item, pending }: { readonly item: MessagesTimelineRow extends infer R ? (R extends { kind: "event"; projectedItem: { item: infer I } } ? I : never) : never; readonly pending: boolean }) {
  if (item.type === "approval_request" && pending) {
    return (
      <box marginTop={1} border borderStyle="rounded" borderColor={colors.warn} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text fg={colors.warn}>
          <strong>{approvalTitle(item.requestKind)}</strong>
        </text>
        {item.prompt ? <text fg={colors.text}>{item.prompt}</text> : null}
        {item.reason ? <text fg={colors.muted}>{item.reason}</text> : null}
        <text fg={colors.faint}>Waiting for approval · y Approve · Y Always allow this session · n Decline</text>
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

function firstLine(text: string): string {
  const line = (text.trim().split("\n")[0] ?? "").replace(/\s+/g, " ");
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}
