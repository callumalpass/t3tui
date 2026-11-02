import type { MouseEvent } from "@opentui/core";
import { needsAttention, relativeTime, rowTime, SECTION_LABELS, statusLabel, type Section, type ThreadRow } from "../model/threads.ts";
import type { ThreadId } from "@t3tools/contracts";

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
}) {
  const { rows, selected, focused, width, height, now } = props;
  // Rows take two lines plus a header per section; keep the selection in view.
  const visibleCount = Math.max(1, Math.floor((height - (props.filtering ? 9 : 6)) / 2));
  const start = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), rows.length - visibleCount));
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
      <box
        key={row.thread.id}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={isSelected ? (focused ? colors.selectedBg : colors.panel) : "transparent"}
        onMouseDown={(event: MouseEvent) => (event.button === 2 ? props.onMenu(row.thread.id) : props.onPick(row.thread.id))}
      >
        <box flexDirection="row">
          <text fg={colors.faint}>{left}</text>
          <box flexGrow={1} />
          <text fg={status ? statusColor[status.tone] : colors.faint}>{right}</text>
        </box>
        <text fg={recede ? colors.muted : colors.text}>{attention ? <strong>{title}</strong> : title}</text>
      </box>,
    );
  });
  const collapsed = [...props.collapsed].filter(([, count]) => count > 0);
  return (
    <box border={["right"]} borderColor={colors.border} width={width} flexShrink={0} overflow="hidden" flexDirection="column">
      {props.filtering ? (
        <box border borderStyle="rounded" borderColor={colors.borderFocused} height={3} flexShrink={0}>
          <input focused placeholder="Filter threads…" value={props.filter} onInput={props.onFilter} onSubmit={props.onFilterDone} />
        </box>
      ) : props.filter ? (
        <text fg={colors.accent}>{` /${props.filter}`}</text>
      ) : null}
      {rows.length === 0 ? <text fg={colors.muted}>{props.filter ? " no matches" : " no threads"}</text> : lines}
      <box flexGrow={1} />
      {collapsed.map(([section, count]) => (
        <text key={section} fg={colors.faint} onMouseDown={props.onUnfold}>{` › ${SECTION_LABELS[section]} ${count}`}</text>
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

function truncate(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ");
  return single.length > width ? `${single.slice(0, Math.max(0, width - 1))}…` : single;
}
