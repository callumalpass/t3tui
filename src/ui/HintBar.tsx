import type { MouseEvent } from "@opentui/core";

import { hintKey, type HintKey } from "../model/hints.ts";
import { isLeftClick, useHover } from "./Button.tsx";
import { colors } from "./theme.ts";

/** The key hints along the bottom; each one that names a single key presses it when clicked. */
export function HintBar(props: { readonly text: string; readonly mode: string; readonly onPress: (key: HintKey) => void }) {
  const parts = props.text.split(" · ");
  return (
    <box flexDirection="row" overflow="hidden">
      {parts.map((part, index) => (
        <Hint key={`${index}:${part}`} text={part} separator={index > 0} hintKey={hintKey(part, props.mode)} onPress={props.onPress} />
      ))}
    </box>
  );
}

function Hint(props: { readonly text: string; readonly separator: boolean; readonly hintKey: HintKey | null; readonly onPress: (key: HintKey) => void }) {
  const [hover, hoverProps] = useHover();
  const key = props.hintKey;
  return (
    <box flexDirection="row" flexShrink={0}>
      {props.separator ? <text fg={colors.faint} selectable={false}>{" · "}</text> : null}
      <text
        fg={key && hover ? colors.text : colors.faint}
        selectable={false}
        {...(key ? { ...hoverProps, onMouseDown: (event: MouseEvent) => isLeftClick(event) && props.onPress(key) } : {})}
      >
        {props.text}
      </text>
    </box>
  );
}
