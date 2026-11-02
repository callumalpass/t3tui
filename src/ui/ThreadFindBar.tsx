import type { OrchestrationV2SearchThreadResult } from "@t3tools/contracts";
import { colors } from "./theme.ts";

/** The web's find bar, with the same wraparound navigation and a focused one-line query. */
export function ThreadFindBar(props: {
  readonly query: string;
  readonly focused: boolean;
  readonly data: OrchestrationV2SearchThreadResult | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onQuery: (query: string) => void;
  readonly onStep: (delta: number) => void;
  readonly onClose: () => void;
}) {
  const count = props.data?.totalMatches ?? 0;
  return (
    <box flexDirection="column" flexShrink={0} border={["top"]} borderColor={colors.border} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" height={1}>
        <input focused={props.focused} flexGrow={1} placeholder="Find in thread" value={props.query} onInput={props.onQuery} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} />
        <text fg={colors.muted}>{props.pending ? " Searching… " : ` ${count ? (props.data?.activeIndex ?? 0) + 1 : 0} of ${count} `}</text>
        <text fg={colors.accent} onMouseDown={() => props.onStep(-1)}> ↑ </text>
        <text fg={colors.accent} onMouseDown={() => props.onStep(1)}> ↓ </text>
        <text fg={colors.muted} onMouseDown={props.onClose}> esc </text>
      </box>
      <text fg={props.error ? colors.bad : colors.faint}>{props.error ?? "enter / shift+enter or ctrl+n/p · esc close"}</text>
    </box>
  );
}
