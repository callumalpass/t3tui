import type { ScrollBoxRenderable } from "@opentui/core";
import { useMemo, type RefObject } from "react";

import type { Block, Transcript } from "../model/transcript.ts";
import { colors, getMarkdownStyle, toneColor } from "./theme.ts";

export function ThreadView(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly transcript: Transcript | null;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly focused: boolean;
  readonly showReasoning: boolean;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  const { transcript } = props;
  const body = useMemo(() => {
    if (!transcript) return null;
    return transcript.blocks.map((block) => <BlockView key={block.id} block={block} showReasoning={props.showReasoning} />);
  }, [transcript, props.showReasoning]);

  return (
    <box title={` ${props.title} `} border borderColor={props.focused ? colors.borderFocused : colors.border} flexGrow={1} minHeight={0} flexDirection="column">
      <text fg={colors.faint} flexShrink={0} height={1}>{props.subtitle}</text>
      {props.error ? <text fg={colors.bad}>{props.error}</text> : null}
      {props.loading && !transcript ? <text fg={colors.muted}>loading…</text> : null}
      <scrollbox ref={props.scrollRef} flexGrow={1} flexShrink={1} minHeight={0} stickyScroll stickyStart="bottom" focused={props.focused}>
        {transcript && transcript.hiddenCount > 0 ? <text fg={colors.faint}>{`… ${transcript.hiddenCount} earlier items not shown`}</text> : null}
        {body}
      </scrollbox>
    </box>
  );
}

function BlockView({ block, showReasoning }: { readonly block: Block; readonly showReasoning: boolean }) {
  switch (block.kind) {
    case "user":
      return (
        <box marginTop={1} flexDirection="row">
          <text fg={colors.user}>› </text>
          <text fg={colors.user}>
            <strong>{block.text.trim()}</strong>
          </text>
        </box>
      );
    case "assistant":
      return (
        <box marginTop={1}>
          <markdown content={block.markdown || "…"} syntaxStyle={getMarkdownStyle()} streaming={block.streaming} conceal />
        </box>
      );
    case "reasoning":
      if (!showReasoning) return <text fg={colors.faint}>{`  ∴ ${firstLine(block.text)}`}</text>;
      return (
        <text fg={colors.faint}>
          <i>{block.text.trim()}</i>
        </text>
      );
    case "tool":
      return (
        <box flexDirection="column">
          <text fg={toneColor[block.tone]}>{`  ${block.icon} ${block.label}`}</text>
          {block.detail ? <text fg={colors.faint}>{indent(block.detail, "    ")}</text> : null}
        </box>
      );
    case "approval":
      return (
        <box marginTop={1} border borderColor={block.pending ? colors.warn : colors.border} flexDirection="column" paddingLeft={1}>
          <text fg={block.pending ? colors.warn : colors.muted}>
            <strong>{block.pending ? "Approval needed: " : "Approval: "}</strong>
            {block.title}
          </text>
          {block.detail ? <text fg={colors.muted}>{block.detail}</text> : null}
          {block.pending ? <text fg={colors.text}>[y] accept  [Y] accept for session  [n] decline</text> : null}
        </box>
      );
    case "question":
      return (
        <box marginTop={1} border borderColor={block.pending ? colors.warn : colors.border} flexDirection="column" paddingLeft={1}>
          <text fg={block.pending ? colors.warn : colors.muted}>
            <strong>{block.pending ? "Question for you" : "Question"}</strong>
          </text>
          {block.questions.map((question, index) => (
            <text key={index} fg={colors.text}>{`• ${question}`}</text>
          ))}
          {block.pending ? <text fg={colors.muted}>Answer in the T3 Code app for now.</text> : null}
        </box>
      );
    case "notice":
      return <text fg={toneColor[block.tone]}>{`  ${block.text}`}</text>;
  }
}

function firstLine(text: string): string {
  const line = (text.trim().split("\n")[0] ?? "").replace(/\*\*(.+?)\*\*/g, "$1");
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
