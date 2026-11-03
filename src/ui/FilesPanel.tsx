import type { MouseEvent } from "@opentui/core";
import { useEffect, useState } from "react";

import { rootLabel, type FileRow } from "../model/files.ts";
import { ClickRow, wheelStep } from "./Button.tsx";
import { BAR } from "./edges.ts";
import { truncate, truncatePath } from "./text.ts";
import { colors } from "./theme.ts";
import type { FileSearch } from "./useFiles.ts";

/**
 * The Files tab: the root on top, then the tree, or the `/` search's results in its place.
 * Folders open with ▸/▾; git's M and ? sit on the right, a faint • on folders with changes
 * inside, and what git ignores is faint.
 */
export function FilesPanel(props: {
  readonly root: string | null;
  readonly rows: readonly FileRow[];
  readonly selected: string | null;
  readonly search: FileSearch | null;
  readonly width: number;
  readonly focused: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onClick: (path: string) => void;
  readonly onQuery: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onClickResult: (index: number) => void;
}) {
  const { rows, search, focused } = props;
  const [height, setHeight] = useState(0);
  const [top, setTop] = useState(0);
  const count = search ? (search.results?.length ?? 0) : rows.length;
  const at = search ? search.selected : Math.max(0, rows.findIndex((row) => row.kind !== "loading" && row.path === props.selected));
  // The selection stays in view; the wheel scrolls past it until it moves again.
  useEffect(() => {
    setTop((current) => (at < current ? at : height > 0 && at >= current + height ? at - height + 1 : current));
  }, [at, height]);
  const start = Math.max(0, Math.min(top, count - height));
  // The selection bar and a column of padding either side of the text.
  const inner = Math.max(8, props.width - 3);
  const selectedBg = focused ? colors.selectedBg : colors.element;
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.panel}>
      <text fg={colors.muted} paddingLeft={1} wrapMode="none" flexShrink={0}>{props.root ? rootLabel(props.root, inner) : "No workspace"}</text>
      {search?.editing ? (
        <box border={["left"]} customBorderChars={BAR} borderColor={colors.accent} backgroundColor={colors.element} height={1} flexShrink={0}>
          <input focused={focused} placeholder="Search files…" value={search.query} onInput={props.onQuery} onSubmit={props.onSubmit} backgroundColor={colors.element} focusedBackgroundColor={colors.element} />
        </box>
      ) : search ? (
        <text fg={colors.accent} wrapMode="none" flexShrink={0}>{` /${search.query}`}</text>
      ) : null}
      <box
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        overflow="hidden"
        onSizeChange={function (this: { height: number }) {
          setHeight(this.height);
        }}
        onMouseScroll={(event: MouseEvent) => {
          const step = wheelStep(event);
          if (step) setTop(Math.max(0, Math.min(count - height, start + step * 3)));
        }}
      >
        {search ? (
          search.results === null ? (
            <text fg={colors.faint} paddingLeft={1}>Searching…</text>
          ) : search.results.length === 0 ? (
            <text fg={colors.faint} paddingLeft={1}>{search.query.trim() ? "No matching files or folders." : "Type to search the workspace."}</text>
          ) : (
            search.results.slice(start, start + height).map((entry, offset) => {
              const index = start + offset;
              const active = index === search.selected;
              const label = `${entry.path}${entry.kind === "directory" ? "/" : ""}`;
              return (
                <ClickRow key={entry.path} flexDirection="row" paddingRight={1} selected={active} selectedBg={selectedBg} onPress={() => props.onClickResult(index)}>
                  <text fg={colors.accent} flexShrink={0} selectable={false}>{active ? "▌" : " "}</text>
                  <text fg={entry.ignored ? colors.faint : colors.text} wrapMode="none" selectable={false}>{truncatePath(label, inner)}</text>
                </ClickRow>
              );
            })
          )
        ) : props.error ? (
          <text fg={colors.bad} paddingLeft={1}>{`Could not list the folder: ${props.error}`}</text>
        ) : props.loading ? (
          <text fg={colors.faint} paddingLeft={1}>Loading…</text>
        ) : rows.length === 0 ? (
          <text fg={colors.faint} paddingLeft={1}>No files.</text>
        ) : (
          rows.slice(start, start + height).map((row) => <Row key={`${row.kind}:${row.path}`} row={row} inner={inner} selected={row.kind !== "loading" && row.path === props.selected} selectedBg={selectedBg} onClick={props.onClick} />)
        )}
      </box>
    </box>
  );
}

function Row(props: { readonly row: FileRow; readonly inner: number; readonly selected: boolean; readonly selectedBg: string; readonly onClick: (path: string) => void }) {
  const { row, inner, selected } = props;
  const indent = "  ".repeat(row.depth);
  if (row.kind === "loading") return <text fg={colors.faint} selectable={false}>{` ${indent}  …`}</text>;
  const glyph = row.kind === "directory" ? (row.expanded ? "▾ " : "▸ ") : "  ";
  const mark = row.marker ?? (row.changedInside ? "•" : "");
  const name = truncate(row.name, Math.max(4, inner - indent.length - glyph.length - (mark ? mark.length + 1 : 0)));
  return (
    <ClickRow flexDirection="row" paddingRight={1} selected={selected} selectedBg={props.selectedBg} onPress={() => props.onClick(row.path)}>
      <text fg={colors.accent} flexShrink={0} selectable={false}>{selected ? "▌" : " "}</text>
      <text fg={colors.faint} flexShrink={0} selectable={false}>{`${indent}${glyph}`}</text>
      <text fg={row.ignored ? colors.faint : colors.text} wrapMode="none" selectable={false}>{name}</text>
      <box flexGrow={1} />
      {mark ? <text fg={row.marker ? colors.muted : colors.faint} flexShrink={0} selectable={false}>{mark}</text> : null}
    </ClickRow>
  );
}
