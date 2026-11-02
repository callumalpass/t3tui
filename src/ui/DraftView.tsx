import { ClickRow } from "./Button.tsx";
import { colors } from "./theme.ts";

export interface DraftLine {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** The key that changes it. */
  readonly shortcut: string;
  readonly onPick: () => void;
}

/** A new thread before its first message: where it runs and with what. The composer below sends it. */
export function DraftView(props: { readonly lines: readonly DraftLine[] }) {
  const labelWidth = Math.max(...props.lines.map((line) => line.label.length)) + 2;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.text}>
          <strong>New thread</strong>
        </text>
        <box flexGrow={1} />
        <text fg={colors.faint}>esc cancel</text>
      </box>
      <box flexDirection="column" marginTop={1}>
        {props.lines.map((line) => (
          <ClickRow key={line.key} flexDirection="row" height={1} onPress={line.onPick}>
            <text fg={colors.muted} flexShrink={0}>{line.label.padEnd(labelWidth)}</text>
            <text fg={colors.text} flexShrink={0}>{line.value}</text>
            <text fg={colors.faint} wrapMode="none">{`  ${line.shortcut}`}</text>
          </ClickRow>
        ))}
      </box>
      <text fg={colors.faint} marginTop={1}>Write the first message below; sending it starts the thread.</text>
    </box>
  );
}
