import { GROUP_LABELS, lastActivity, relativeTime, type ThreadRow } from "../model/threads.ts";
import { colors } from "./theme.ts";

const STATUS_GLYPH: Record<string, { glyph: string; color: string }> = {
  "needs-you": { glyph: "●", color: colors.warn },
  running: { glyph: "◐", color: colors.accent },
  failed: { glyph: "✕", color: colors.bad },
  interrupted: { glyph: "◌", color: colors.muted },
  completed: { glyph: "✓", color: colors.faint },
  idle: { glyph: "·", color: colors.faint },
};

function glyphFor(row: ThreadRow) {
  if (row.group !== "recent") return STATUS_GLYPH[row.group]!;
  return STATUS_GLYPH[row.thread.status] ?? STATUS_GLYPH.idle!;
}

export function ThreadList(props: { readonly rows: readonly ThreadRow[]; readonly selected: number; readonly focused: boolean; readonly width: number; readonly height: number; readonly filter: string }) {
  const { rows, selected, focused, width, height } = props;
  // Rows take two lines and up to three group headers take one each; keep the selection in view.
  const visibleCount = Math.max(1, Math.floor((height - 3) / 2));
  const start = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), rows.length - visibleCount));
  const windowRows = rows.slice(start, start + visibleCount);
  const titleWidth = Math.max(8, width - 12);
  const now = Date.now();
  const lines: React.ReactNode[] = [];
  let previousGroup = start > 0 ? rows[start - 1]?.group : undefined;
  windowRows.forEach((row, offset) => {
    const index = start + offset;
    if (row.group !== previousGroup) {
      lines.push(
        <text key={`h-${row.group}`} fg={row.group === "needs-you" ? colors.warn : colors.muted}>
          <strong>{GROUP_LABELS[row.group]}</strong>
        </text>,
      );
      previousGroup = row.group;
    }
    const { glyph, color } = glyphFor(row);
    const isSelected = index === selected;
    const title = truncate(row.thread.title || "(untitled)", titleWidth);
    lines.push(
      <box key={row.thread.id} flexDirection="row" backgroundColor={isSelected ? (focused ? colors.selectedBg : colors.border) : "transparent"}>
        <text fg={color}>{` ${glyph} `}</text>
        <box flexGrow={1} flexDirection="column">
          <text fg={isSelected ? colors.text : colors.text}>{title}</text>
          <text fg={colors.faint}>{truncate(`${row.projectName} · ${relativeTime(lastActivity(row.thread), now)}`, titleWidth)}</text>
        </box>
      </box>,
    );
  });
  return (
    <box
      border={["right"]}
      borderColor={colors.border}
      width={width}
      flexShrink={0}
      overflow="hidden"
      flexDirection="column"
      paddingLeft={0}
    >
      {props.filter ? <text fg={colors.accent}>{` /${props.filter}`}</text> : null}
      {rows.length === 0 ? <text fg={colors.muted}> no threads</text> : lines}
    </box>
  );
}

function truncate(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ");
  return single.length > width ? `${single.slice(0, Math.max(0, width - 1))}…` : single;
}
