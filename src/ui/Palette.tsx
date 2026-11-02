import type { PaletteEntry, PaletteGroup } from "../model/palette.ts";
import type { MouseEvent } from "@opentui/core";

import { ClickRow, wheelStep } from "./Button.tsx";
import { colors } from "./theme.ts";

/**
 * The web's command palette (mod+K) as an overlay: a search box over grouped commands and
 * threads. Arrows or ctrl+n/p move, enter runs, a click runs, esc closes.
 */
export function Palette(props: {
  readonly query: string;
  readonly status?: string | null | undefined;
  readonly placeholder?: string;
  readonly groups: readonly PaletteGroup[];
  readonly selected: number;
  readonly width: number;
  readonly height: number;
  readonly onQuery: (query: string) => void;
  readonly onSubmit: () => void;
  readonly onPick: (index: number) => void;
  /** The wheel moves the selection, as the arrows do. */
  readonly onMove: (step: -1 | 1) => void;
}) {
  const width = Math.min(80, props.width - 4);
  const listHeight = Math.max(4, Math.min(props.height - 8, 22));
  // Rows are entries plus a header per group; keep the selection in view.
  const rows: ({ kind: "header"; label: string; key: string } | { kind: "entry"; entry: PaletteEntry; index: number })[] = [];
  let index = 0;
  for (const group of props.groups) {
    // Untitled groups (separators) share a label, so the key carries the position.
    rows.push({ kind: "header", label: group.label, key: `h-${rows.length}-${group.label}` });
    for (const entry of group.entries) rows.push({ kind: "entry", entry, index: index++ });
  }
  const selectedRow = rows.findIndex((row) => row.kind === "entry" && row.index === props.selected);
  const start = Math.max(0, Math.min(selectedRow - Math.floor(listHeight / 2), rows.length - listHeight));
  const inner = width - 4;
  return (
    <box position="absolute" top={2} left={Math.floor((props.width - width) / 2)} width={width} zIndex={10} flexDirection="column" border borderStyle="rounded" borderColor={colors.borderFocused} backgroundColor={colors.panel}>
      <box paddingLeft={1} paddingRight={1} height={1} flexDirection="row">
        <text fg={colors.accent}>{"› "}</text>
        <input focused flexGrow={1} placeholder={props.placeholder ?? "Search commands and threads (> for commands only)"} value={props.query} onInput={props.onQuery} onSubmit={props.onSubmit} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} />
      </box>
      {props.status ? <text fg={colors.muted} paddingLeft={1}>{props.status}</text> : null}
      <box border={["top"]} borderColor={colors.border} flexDirection="column" height={listHeight + 1} onMouseScroll={(event: MouseEvent) => { const step = wheelStep(event); if (step) props.onMove(step); }}>
        {rows.length === 0 ? <text fg={colors.muted} paddingLeft={1}>No matches</text> : null}
        {rows.slice(start, start + listHeight).map((row) =>
          row.kind === "header" ? (
            <text key={row.key} fg={colors.faint} paddingLeft={1}>
              {row.label}
            </text>
          ) : (
            <Row key={entryKey(row.entry)} entry={row.entry} selected={row.index === props.selected} inner={inner} onPick={() => props.onPick(row.index)} />
          ),
        )}
      </box>
    </box>
  );
}

function Row(props: { readonly entry: PaletteEntry; readonly selected: boolean; readonly inner: number; readonly onPick: () => void }) {
  const { entry } = props;
  const right = entry.kind === "command" ? (entry.command.shortcut ?? "") : entry.project;
  const title = entry.kind === "command" ? entry.command.title : `${entry.subagent ? "↳ " : ""}${entry.snippet ? truncate(entry.title, Math.max(12, Math.floor(props.inner / 3))) : entry.title}${entry.snippet ? ` — ${entry.snippet}` : ""}`;
  return (
    <ClickRow flexDirection="row" paddingLeft={1} paddingRight={1} selected={props.selected} onPress={props.onPick}>
      <text fg={props.selected ? colors.text : entry.kind === "command" ? colors.text : colors.muted}>{truncate(title, props.inner - right.length - 2)}</text>
      <box flexGrow={1} />
      <text fg={colors.faint}>{right}</text>
    </ClickRow>
  );
}

export function entryKey(entry: PaletteEntry): string {
  return entry.kind === "command" ? `c:${entry.command.id}` : `t:${entry.threadId}`;
}

function truncate(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ");
  return single.length > width ? `${single.slice(0, Math.max(0, width - 1))}…` : single;
}
