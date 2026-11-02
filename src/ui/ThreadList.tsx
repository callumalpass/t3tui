import type { MouseEvent } from "@opentui/core";
import { needsAttention, relativeTime, rowTime, SECTION_LABELS, statusLabel, type Section, type ThreadRow } from "../model/threads.ts";
import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { ClickRow, wheelStep } from "./Button.tsx";
import { truncate } from "./text.ts";
import { colors, statusColor } from "./theme.ts";

/**
 * The web sidebar as a list: section headers, then two-line rows of
 * project + status (or time), and the title, bold when it needs you and
 * dimmed while it works or once read.
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
  // Rows take two lines plus a header per section; keep the selection in view.
  const visibleCount = Math.max(1, Math.floor((height - (props.filtering ? 9 : 6)) / 2));
  const maxStart = Math.max(0, rows.length - visibleCount);
  // The wheel scrolls the list without moving the selection; moving the selection brings it back.
  const [scrolled, setScrolled] = useState<number | null>(null);
  useEffect(() => setScrolled(null), [selected]);
  const centred = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), maxStart));
  const start = Math.min(scrolled ?? centred, maxStart);
  const windowRows = rows.slice(start, start + visibleCount);
  const inner = Math.max(8, width - 3);
  // Active goes unlabelled when it leads the list, as in the web sidebar.
  const labelActive = rows.some((row) => row.section === "pinned");
  const lines: React.ReactNode[] = [];
  let previousSection = start > 0 ? rows[start - 1]?.section : undefined;
  windowRows.forEach((row, offset) => {
    const index = start + offset;
    if (row.section !== previousSection) {
      if (row.section !== "active" || labelActive) lines.push(<SectionHeader key={`h-${row.section}`} label={SECTION_LABELS[row.section]} />);
      else if (previousSection !== undefined) lines.push(<text key="h-gap"> </text>);
      previousSection = row.section;
    }
    const isSelected = index === selected;
    const status = statusLabel(row, now);
    const right = status?.text ?? relativeTime(rowTime(row.thread), now);
    const left = truncate(row.projectName || "No project", Math.max(4, inner - right.length - 1));
    const attention = needsAttention(row);
    const recede = !isSelected && (row.status === "working" || row.status === "waiting" || (row.status === "ready" && !row.unread));
    const title = truncate(row.thread.title || "New thread", inner);
    lines.push(
      <ClickRow
        key={row.thread.id}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        selected={isSelected}
        selectedBg={focused ? colors.selectedBg : colors.panel}
        onPress={() => props.onPick(row.thread.id)}
        onMenu={() => props.onMenu(row.thread.id)}
      >
        <box flexDirection="row">
          <text fg={colors.faint}>{left}</text>
          <box flexGrow={1} />
          <text fg={status ? statusColor(status.tone) : colors.faint}>{right}</text>
        </box>
        <text fg={recede ? colors.muted : colors.text}>{attention ? <strong>{title}</strong> : title}</text>
      </ClickRow>,
    );
  });
  const collapsed = [...props.collapsed].filter(([, count]) => count > 0);
  return (
    <box
      width={width}
      flexShrink={0}
      overflow="hidden"
      flexDirection="column"
      onMouseScroll={(event: MouseEvent) => {
        const step = wheelStep(event);
        if (step) setScrolled(Math.max(0, Math.min(maxStart, start + step)));
      }}
    >
      {props.filtering ? (
        <box border borderStyle="rounded" borderColor={colors.borderFocused} height={3} flexShrink={0}>
          <input focused placeholder="Filter threads…" value={props.filter} onInput={props.onFilter} onSubmit={props.onFilterDone} />
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
    <text fg={colors.muted} paddingLeft={1}>
      <strong>{label}</strong>
    </text>
  );
}
