import type { MouseEvent } from "@opentui/core";
import { needsAttention, relativeTime, rowTime, SECTION_LABELS, statusLabel, type Section, type ThreadRow } from "../model/threads.ts";
import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { ClickRow, wheelStep } from "./Button.tsx";
import { BAR } from "./edges.ts";
import { truncate } from "./text.ts";
import { colors, statusColor } from "./theme.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The 2-column gutter's mark for a row: a spinner while it works, then what it needs from you. */
function statusGlyph(row: ThreadRow, spin: number): { readonly glyph: string; readonly color: string } {
  if (row.status === "working") return { glyph: SPINNER[spin % SPINNER.length]!, color: colors.accent };
  if (row.status === "failed") return { glyph: "✕", color: colors.bad };
  if (row.status === "approval" || row.status === "input" || row.status === "request" || row.status === "limited") return { glyph: "◆", color: colors.warn };
  if (row.unread) return { glyph: "●", color: colors.good };
  return { glyph: " ", color: colors.faint };
}

/**
 * The web sidebar as a list on a panel: section headers, then two-line rows of the title
 * (with its status or time on the right) over the project, a status gutter on the left,
 * the title bold when it needs you and dimmed while it works or once read.
 */
export function ThreadList(props: {
  readonly rows: readonly ThreadRow[];
  /** Sections folded to a header with a count, like the web's Snoozed and Settled. */
  readonly collapsed: ReadonlyMap<Section, number>;
  readonly selected: number;
  readonly focused: boolean;
  readonly width: number;
  readonly height: number;
  readonly filter: string;
  /** The filter box is open and has the keyboard. */
  readonly filtering: boolean;
  readonly now: number;
  readonly onFilter: (value: string) => void;
  readonly onFilterDone: () => void;
  readonly onPick: (threadId: ThreadId) => void;
  /** A right-click: the thread's menu. */
  readonly onMenu: (threadId: ThreadId) => void;
  readonly onUnfold: () => void;
  readonly shelfStatus?: string | null | undefined;
  readonly showMore?: boolean;
  readonly onShowMore?: () => void;
}) {
  const { rows, selected, focused, width, height, now } = props;
  const collapsed = [...props.collapsed].filter(([, count]) => count > 0);
  // Active goes unlabelled when it leads the list, as in the web sidebar.
  const labelActive = rows.some((row) => row.section === "pinned");
  // Rows take two lines; a header takes one, plus a blank line above each but the first.
  // Reserve those lines (and the filter, shelf and folded rows) so the selection stays in view.
  let headerLines = 0;
  let seenHeader = false;
  for (const section of rows.map((row) => row.section).filter((section, index, all) => all.indexOf(section) === index)) {
    if (section !== "active" || labelActive) {
      headerLines += seenHeader ? 2 : 1;
      seenHeader = true;
    } else if (seenHeader) {
      headerLines += 1;
    }
  }
  const reserved = (props.filtering || props.filter ? 1 : 0) + collapsed.length + (props.shelfStatus ? 1 : 0) + (props.showMore ? 1 : 0) + headerLines;
  const visibleCount = Math.max(1, Math.floor((height - reserved) / 2));
  const maxStart = Math.max(0, rows.length - visibleCount);
  // The wheel scrolls the list without moving the selection; moving the selection brings it back.
  const [scrolled, setScrolled] = useState<number | null>(null);
  useEffect(() => setScrolled(null), [selected]);
  const centred = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), maxStart));
  const start = Math.min(scrolled ?? centred, maxStart);
  const windowRows = rows.slice(start, start + visibleCount);
  // The spinner only runs while a visible row is working.
  const [spin, setSpin] = useState(0);
  const anyWorking = windowRows.some((row) => row.status === "working");
  useEffect(() => {
    if (!anyWorking) return;
    const timer = setInterval(() => setSpin((frame) => frame + 1), 100);
    return () => clearInterval(timer);
  }, [anyWorking]);
  // The selection bar, the gutter and one space of right padding sit around the text.
  const inner = Math.max(8, width - 4);
  const lines: React.ReactNode[] = [];
  let previousSection = start > 0 ? rows[start - 1]?.section : undefined;
  windowRows.forEach((row, offset) => {
    const index = start + offset;
    if (row.section !== previousSection) {
      if (row.section !== "active" || labelActive) {
        if (lines.length > 0) lines.push(<text key={`gap-${row.section}`}> </text>);
        lines.push(<SectionHeader key={`h-${row.section}`} label={SECTION_LABELS[row.section]} />);
      } else if (previousSection !== undefined) lines.push(<text key="h-gap"> </text>);
      previousSection = row.section;
    }
    const isSelected = index === selected;
    const status = statusLabel(row, now);
    const right = status?.text ?? relativeTime(rowTime(row.thread), now);
    const project = truncate(row.projectName || "No project", inner);
    const attention = needsAttention(row);
    const recede = !isSelected && (row.status === "working" || row.status === "waiting" || (row.status === "ready" && !row.unread));
    const title = truncate(row.thread.title || "New thread", Math.max(4, inner - right.length - 1));
    const { glyph, color } = statusGlyph(row, spin);
    const bar = isSelected ? "▌" : " ";
    lines.push(
      <ClickRow
        key={row.thread.id}
        flexDirection="column"
        paddingRight={1}
        selected={isSelected}
        selectedBg={focused ? colors.selectedBg : colors.element}
        onPress={() => props.onPick(row.thread.id)}
        onMenu={() => props.onMenu(row.thread.id)}
      >
        <box flexDirection="row">
          <text fg={colors.accent} flexShrink={0} selectable={false}>{bar}</text>
          <text fg={color} flexShrink={0} selectable={false}>{`${glyph} `}</text>
          <text fg={recede ? colors.muted : colors.text} flexShrink={0}>{attention ? <strong>{title}</strong> : title}</text>
          <box flexGrow={1} />
          <text fg={status ? statusColor(status.tone) : colors.faint} flexShrink={0}>{right}</text>
        </box>
        <box flexDirection="row">
          <text fg={colors.accent} flexShrink={0} selectable={false}>{bar}</text>
          <text fg={colors.faint}>{`  ${project}`}</text>
        </box>
      </ClickRow>,
    );
  });
  return (
    <box
      width={width}
      flexShrink={0}
      overflow="hidden"
      flexDirection="column"
      backgroundColor={colors.panel}
      onMouseScroll={(event: MouseEvent) => {
        const step = wheelStep(event);
        if (step) setScrolled(Math.max(0, Math.min(maxStart, start + step)));
      }}
    >
      {props.filtering ? (
        <box border={["left"]} customBorderChars={BAR} borderColor={colors.accent} backgroundColor={colors.element} height={1} flexShrink={0}>
          <input focused placeholder="Filter threads…" value={props.filter} onInput={props.onFilter} onSubmit={props.onFilterDone} backgroundColor={colors.element} focusedBackgroundColor={colors.element} />
        </box>
      ) : props.filter ? (
        <text fg={colors.accent}>{` /${props.filter}`}</text>
      ) : null}
      {rows.length === 0 ? <text fg={colors.muted}>{props.filter ? " no matches" : " no threads"}</text> : lines}
      <box flexGrow={1} />
      {props.shelfStatus ? <text fg={colors.muted} paddingLeft={1}>{props.shelfStatus}</text> : null}
      {props.showMore ? (
        <ClickRow paddingLeft={1} onPress={() => props.onShowMore?.()}>
          <text fg={colors.accent} selectable={false}>Show more settled threads</text>
        </ClickRow>
      ) : null}
      {collapsed.map(([section, count]) => (
        <ClickRow key={section} onPress={props.onUnfold}>
          <text fg={colors.faint} selectable={false}>{` › ${SECTION_LABELS[section]} ${count}`}</text>
        </ClickRow>
      ))}
    </box>
  );
}

function SectionHeader({ label }: { readonly label: string }) {
  return (
    <text fg={colors.faint} paddingLeft={1}>
      <strong>{label}</strong>
    </text>
  );
}
