import type { MouseEvent } from "@opentui/core";

import type { Hint } from "../model/keymap.ts";
import { isLeftClick, useHover } from "./Button.tsx";
import { colors } from "./theme.ts";

/** The key hints along the bottom; a click on one does what its key does. */
export function HintBar(props: { readonly hints: readonly Hint[] }) {
  return (
    <box flexDirection="row" overflow="hidden">
      {props.hints.map((hint, index) => (
        <HintItem key={`${index}:${hint.key}:${hint.label}`} hint={hint} separator={index > 0} />
      ))}
    </box>
  );
}

function HintItem(props: { readonly hint: Hint; readonly separator: boolean }) {
  const [hover, hoverProps] = useHover();
  const { key, label, run } = props.hint;
  return (
    <box flexDirection="row" flexShrink={0}>
      {props.separator ? <text fg={colors.faint} selectable={false}>{" · "}</text> : null}
      <text
        fg={run && hover ? colors.text : colors.faint}
        selectable={false}
        {...(run ? { ...hoverProps, onMouseDown: (event: MouseEvent) => isLeftClick(event) && run() } : {})}
      >
        {key ? `${key} ${label}` : label}
      </text>
    </box>
  );
}
