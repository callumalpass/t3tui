import type { MouseEvent } from "@opentui/core";

import type { Hint } from "../model/keymap.ts";
import { isLeftClick, useHover } from "./Button.tsx";
import { colors } from "./theme.ts";

const SEPARATOR = " · ";

/** The width a hint takes on screen: its key, a space, then its label. */
const hintWidth = (hint: Hint) => Bun.stringWidth(hint.key ? `${hint.key} ${hint.label}` : hint.label);

/**
 * The key hints along the bottom; a click on one does what its key does. When they don't
 * fit the width, whole hints drop off the end rather than one being cut mid-word.
 */
export function HintBar(props: { readonly hints: readonly Hint[]; readonly width?: number }) {
  let shown = props.hints;
  if (props.width !== undefined) {
    let used = 0;
    let count = 0;
    for (const hint of props.hints) {
      const next = used + (count > 0 ? SEPARATOR.length : 0) + hintWidth(hint);
      if (next > props.width) break;
      used = next;
      count++;
    }
    shown = props.hints.slice(0, count);
  }
  return (
    <box flexDirection="row" overflow="hidden">
      {shown.map((hint, index) => (
        <HintItem key={`${index}:${hint.key}:${hint.label}`} hint={hint} separator={index > 0} />
      ))}
    </box>
  );
}

function HintItem(props: { readonly hint: Hint; readonly separator: boolean }) {
  const [hover, hoverProps] = useHover();
  const { key, label, run } = props.hint;
  return (
    <box flexDirection="row" flexShrink={0} {...(run ? { ...hoverProps, onMouseDown: (event: MouseEvent) => isLeftClick(event) && run() } : {})}>
      {props.separator ? <text fg={colors.faint} selectable={false}>{SEPARATOR}</text> : null}
      {key ? <text fg={colors.text} selectable={false}>{`${key} `}</text> : null}
      <text fg={run && hover ? colors.text : colors.faint} selectable={false}>{label}</text>
    </box>
  );
}
