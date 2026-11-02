import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";

import type { PullRequestLine } from "../model/pullRequests.ts";
import { colors } from "./theme.ts";

export interface PullRequestViewState {
  readonly status: "loading" | "ready" | "error";
  readonly lines: readonly PullRequestLine[];
  readonly watching: boolean;
  readonly error?: string;
}

const LINE_COLORS: Record<PullRequestLine["kind"], string> = {
  title: colors.accent,
  meta: colors.muted,
  body: colors.text,
  check: colors.text,
  review: colors.text,
  comment: colors.muted,
  guide: colors.text,
  faint: colors.faint,
};

/** A linked pull request in place of the conversation: j/k scroll, o opens it, esc closes. */
export function PullRequestView(props: { readonly view: PullRequestViewState; readonly scrollRef: RefObject<ScrollBoxRenderable | null> }) {
  const { view } = props;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.text}>
          <strong>Pull request</strong>
        </text>
        {view.watching ? <text fg={colors.good}>{"  watching"}</text> : null}
        <box flexGrow={1} />
        <text fg={colors.faint}>esc close</text>
      </box>
      {view.status === "loading" ? <text fg={colors.muted}>Loading pull request…</text> : null}
      {view.status === "error" ? <text fg={colors.bad}>{`Could not load the pull request: ${view.error ?? "unknown error"}`}</text> : null}
      <scrollbox ref={props.scrollRef} flexGrow={1} minHeight={0}>
        {view.lines.map((line, index) =>
          line.kind === "title" && index > 0 ? (
            <text key={index} fg={LINE_COLORS[line.kind]} marginTop={1}>
              <strong>{line.text}</strong>
            </text>
          ) : line.kind === "title" ? (
            <text key={index} fg={colors.text}>
              <strong>{line.text}</strong>
            </text>
          ) : (
            <text key={index} fg={line.kind === "check" ? checkColor(line.text) : LINE_COLORS[line.kind]}>
              {line.text || " "}
            </text>
          ),
        )}
      </scrollbox>
    </box>
  );
}

function checkColor(text: string): string {
  if (text.startsWith("✓")) return colors.good;
  if (text.startsWith("✕")) return colors.bad;
  if (text.startsWith("◐")) return colors.warn;
  return colors.text;
}
