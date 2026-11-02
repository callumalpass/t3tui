import type { ReviewDiffFileContentsInput } from "@t3tools/contracts";
import { splitPatch } from "../model/diffs.ts";
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";

import { isLeftClick, useHover } from "./Button.tsx";
import { colors, useMarkdownStyle } from "./theme.ts";

export interface DiffState {
  readonly cwd: string;
  readonly title?: string;
  readonly source?: Pick<ReviewDiffFileContentsInput, "cwd" | "sourceKind" | "baseRef" | "headRef">;
  /** null to show every changed file. */
  readonly path: string | null;
  readonly status: "loading" | "ready" | "error";
  readonly patch?: string;
  readonly truncated?: boolean;
  readonly error?: string;
}

/** Working-tree or checkpoint changes through the same unified diff renderer. */
export function DiffView(props: { readonly diff: DiffState; readonly scrollRef: RefObject<ScrollBoxRenderable | null>; readonly selected: number; readonly expanded: Readonly<Record<string, { patch?: string; error?: string }>>; readonly onFile: (index: number) => void }) {
  const { diff } = props;
  const markdownStyle = useMarkdownStyle();
  const files = diff.patch ? splitPatch(diff.patch) : [];
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={1} backgroundColor={colors.bg}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.muted}>{diff.title ?? "Uncommitted"} / </text>
        <text fg={colors.text}>
          <strong>{diff.path ?? `${files.length} ${files.length === 1 ? "file" : "files"}`}</strong>
        </text>
        <box flexGrow={1} />
        <text fg={colors.faint}>{diff.source ? "[/] file · x whole file / collapse · esc close" : "[/] file · esc close"}</text>
      </box>
      {diff.status === "loading" ? <text fg={colors.muted} flexShrink={0}>Loading diff…</text> : null}
      {diff.status === "error" ? <text fg={colors.bad} flexShrink={0}>{`Could not load the diff: ${diff.error ?? "unknown error"}`}</text> : null}
      {diff.status === "ready" && files.length === 0 ? <text fg={colors.muted} flexShrink={0}>No changes.</text> : null}
      {diff.truncated ? <text fg={colors.warn} flexShrink={0}>The diff was too large and is cut short.</text> : null}
      <scrollbox ref={props.scrollRef} flexGrow={1} minHeight={0}>
        {files.map((file, index) => (
          <box key={file.path} id={`diff-file-${index}`} flexDirection="column" marginTop={1}>
            <FileHeader path={file.path} selected={index === props.selected} canExpand={diff.source !== undefined} onPress={() => props.onFile(index)} />
            {props.expanded[file.path] && !props.expanded[file.path]?.patch ? <text fg={props.expanded[file.path]?.error ? colors.bad : colors.muted}>{props.expanded[file.path]?.error ?? "Loading full file…"}</text> : null}
            <diff
              diff={props.expanded[file.path]?.patch ?? file.patch}
              view="unified"
              {...(filetypeOf(file.path) ? { filetype: filetypeOf(file.path)! } : {})}
              syntaxStyle={markdownStyle}
              showLineNumbers
              wrapMode="none"
              fg={colors.text}
              addedBg={colors.diffAddedBg}
              removedBg={colors.diffRemovedBg}
              addedContentBg={colors.diffAddedBg}
              removedContentBg={colors.diffRemovedBg}
              addedSignColor={colors.good}
              removedSignColor={colors.bad}
              lineNumberFg={colors.faint}
            />
          </box>
        ))}
      </scrollbox>
    </box>
  );
}

/** A click selects the file; a click on the selected one shows its whole file, as x does. */
function FileHeader(props: { readonly path: string; readonly selected: boolean; readonly canExpand: boolean; readonly onPress: () => void }) {
  const [hover, hoverProps] = useHover();
  return (
    <box flexDirection="row" {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && props.onPress()}>
      <text fg={props.selected ? colors.accent : hover ? colors.text : colors.muted} selectable={false}>{`${props.selected ? "▸ " : "  "}${props.path}`}</text>
      {hover && props.selected && props.canExpand ? <text fg={colors.faint} selectable={false}>{"  click for the whole file"}</text> : null}
    </box>
  );
}

export { splitPatch } from "../model/diffs.ts";

const FILETYPES: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "javascript", json: "json", md: "markdown", rs: "rust", py: "python", go: "go", css: "css", html: "html", sh: "bash", yml: "yaml", yaml: "yaml", zig: "zig" };

function filetypeOf(path: string): string | undefined {
  return FILETYPES[path.split(".").pop() ?? ""];
}
