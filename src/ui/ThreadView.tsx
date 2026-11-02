import type { ScrollBoxRenderable } from "@opentui/core";
import { memo, type RefObject } from "react";

import { summarizeWork, type Segment, type Step, type Transcript } from "../model/transcript.ts";
import { colors, getMarkdownStyle, toneColor } from "./theme.ts";

export function ThreadView(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly transcript: Transcript | null;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly working: boolean;
  readonly expandWork: boolean;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  const { transcript } = props;
  const last = transcript?.segments.at(-1);
  // The folded work line already says it's working; otherwise show it at the bottom.
  const showWorking = props.working && !(last?.kind === "work" && last.active) && !(last?.kind === "assistant" && last.streaming);
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.text}>
          <strong>{props.title}</strong>
        </text>
        <text fg={colors.faint}>{props.subtitle ? `  ${props.subtitle}` : ""}</text>
      </box>
      {props.error ? <text fg={colors.bad} flexShrink={0}>{props.error}</text> : null}
      <scrollbox ref={props.scrollRef} flexGrow={1} flexShrink={1} minHeight={0} stickyScroll stickyStart="bottom">
        {props.loading && !transcript ? <text fg={colors.muted}>loading…</text> : null}
        {transcript && transcript.hiddenCount > 0 ? <text fg={colors.faint}>{`… ${transcript.hiddenCount} earlier items`}</text> : null}
        {transcript?.segments.map((segment) => <SegmentView key={segment.id} segment={segment} expandWork={props.expandWork} />)}
        {showWorking ? <text fg={colors.accent} marginTop={1}>◐ working…</text> : null}
      </scrollbox>
    </box>
  );
}

/** Memoized: unchanged segments keep their object identity across updates, so only what changed re-renders. */
const SegmentView = memo(function SegmentView({ segment, expandWork }: { readonly segment: Segment; readonly expandWork: boolean }) {
  switch (segment.kind) {
    case "user": {
      const { text, hidden } = expandWork ? { text: segment.text.trim(), hidden: 0 } : clip(segment.text.trim());
      return (
        <box marginTop={1} border={["left"]} borderColor={colors.user} backgroundColor={colors.userBg} paddingLeft={1} paddingRight={1} flexDirection="column">
          <text fg={colors.text}>{text}</text>
          {hidden > 0 ? <text fg={colors.faint}>{`… ${hidden} more lines (e to expand)`}</text> : null}
        </box>
      );
    }
    case "assistant":
      return (
        <box marginTop={1} paddingLeft={1}>
          <markdown content={segment.markdown || "…"} syntaxStyle={getMarkdownStyle()} streaming={segment.streaming} conceal />
        </box>
      );
    case "work":
      return expandWork ? <ExpandedWork steps={segment.steps} /> : <FoldedWork steps={segment.steps} active={segment.active} />;
    case "approval":
      return (
        <box marginTop={1} border borderStyle="rounded" borderColor={segment.pending ? colors.warn : colors.border} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={segment.pending ? colors.warn : colors.muted}>
            <strong>{segment.pending ? "Needs approval" : "Approval"}</strong>
          </text>
          <text fg={colors.text}>{segment.title}</text>
          {segment.detail ? <text fg={colors.muted}>{segment.detail}</text> : null}
          {segment.pending ? <text fg={colors.faint}>esc, then y accept · Y accept for session · n decline</text> : null}
        </box>
      );
    case "question":
      return (
        <box marginTop={1} border borderStyle="rounded" borderColor={segment.pending ? colors.warn : colors.border} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={segment.pending ? colors.warn : colors.muted}>
            <strong>{segment.pending ? "Question for you" : "Question"}</strong>
          </text>
          {segment.questions.map((question, index) => (
            <text key={index} fg={colors.text}>{question}</text>
          ))}
          {segment.pending ? <text fg={colors.faint}>Answer this in the T3 Code app for now.</text> : null}
        </box>
      );
    case "alert":
      return <text marginTop={1} paddingLeft={1} fg={toneColor[segment.tone]}>{segment.text}</text>;
  }
});

function FoldedWork({ steps, active }: { readonly steps: readonly Step[]; readonly active: boolean }) {
  const latest = active ? steps.at(-1) : undefined;
  return (
    <box marginTop={1} paddingLeft={1} flexDirection="column">
      <text fg={active ? colors.accent : colors.faint}>{`${active ? "◐" : "▸"} ${summarizeWork(steps)}`}</text>
      {latest ? <text fg={colors.muted}>{`  ${stepLine(latest)}`}</text> : null}
    </box>
  );
}

function ExpandedWork({ steps }: { readonly steps: readonly Step[] }) {
  return (
    <box marginTop={1} paddingLeft={1} flexDirection="column">
      {steps.map((step) => (
        <box key={step.id} flexDirection="column">
          <text fg={step.kind === "reasoning" ? colors.faint : toneColor[step.tone]}>{stepLine(step)}</text>
          {step.kind === "tool" && step.detail ? <text fg={colors.faint}>{indent(step.detail, "    ")}</text> : null}
        </box>
      ))}
    </box>
  );
}

function stepLine(step: Step): string {
  switch (step.kind) {
    case "tool":
      return `${step.icon} ${step.label}`;
    case "reasoning":
      return `∴ ${firstLine(step.text)}`;
    case "notice":
      return `· ${step.text}`;
  }
}

const CLIP_LINES = 6;
const CLIP_CHARS = 480;

/** Long prompts (delegation briefs, pasted logs) shrink to their opening lines. */
function clip(text: string): { readonly text: string; readonly hidden: number } {
  const lines = text.split("\n");
  let kept = lines.slice(0, CLIP_LINES).join("\n");
  if (kept.length > CLIP_CHARS) kept = `${kept.slice(0, CLIP_CHARS).trimEnd()}…`;
  const keptLines = kept.split("\n").length;
  const hidden = lines.length - keptLines;
  return kept.length < text.length ? { text: kept, hidden: Math.max(hidden, 1) } : { text, hidden: 0 };
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
