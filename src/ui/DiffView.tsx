import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";

import { colors, getMarkdownStyle } from "./theme.ts";

export interface DiffState {
  readonly cwd: string;
  /** null for the whole working tree. */
  readonly path: string | null;
  readonly status: "loading" | "ready" | "error";
  readonly patch?: string;
  readonly truncated?: boolean;
  readonly error?: string;
}

/** Uncommitted changes as unified diffs, one block per file, in place of the conversation. */
export function DiffView(props: { readonly diff: DiffState; readonly scrollRef: RefObject<ScrollBoxRenderable | null> }) {
  const { diff } = props;
  const files = diff.patch ? splitPatch(diff.patch) : [];
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.muted}>Uncommitted / </text>
        <text fg={colors.text}>
          <strong>{diff.path ?? `${files.length} ${files.length === 1 ? "file" : "files"}`}</strong>
        </text>
        <box flexGrow={1} />
        <text fg={colors.faint}>esc close</text>
      </box>
      {diff.status === "loading" ? <text fg={colors.muted}>Loading diff…</text> : null}
      {diff.status === "error" ? <text fg={colors.bad}>{`Could not load the diff: ${diff.error ?? "unknown error"}`}</text> : null}
      {diff.status === "ready" && files.length === 0 ? <text fg={colors.muted}>No changes.</text> : null}
      {diff.truncated ? <text fg={colors.warn}>The diff was too large and is cut short.</text> : null}
      <scrollbox ref={props.scrollRef} flexGrow={1} minHeight={0}>
        {files.map((file) => (
          <box key={file.path} flexDirection="column" marginTop={1}>
            {diff.path ? null : <text fg={colors.accent}>{file.path}</text>}
            <diff
              diff={file.patch}
              view="unified"
              {...(filetypeOf(file.path) ? { filetype: filetypeOf(file.path)! } : {})}
              syntaxStyle={getMarkdownStyle()}
              showLineNumbers
              wrapMode="none"
              fg={colors.text}
              addedBg="#1e2a1e"
              removedBg="#2d1f24"
              addedContentBg="#1e2a1e"
              removedContentBg="#2d1f24"
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

/** Splits a multi-file patch at each `diff --git` header. */
export function splitPatch(patch: string): { path: string; patch: string }[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith("diff --git "))
    .map((chunk) => ({ path: /^diff --git a\/(.+?) b\//.exec(chunk)?.[1] ?? "file", patch: chunk }));
}

const FILETYPES: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "javascript", json: "json", md: "markdown", rs: "rust", py: "python", go: "go", css: "css", html: "html", sh: "bash", yml: "yaml", yaml: "yaml", zig: "zig" };

function filetypeOf(path: string): string | undefined {
  return FILETYPES[path.split(".").pop() ?? ""];
}
