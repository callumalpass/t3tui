import type { MouseEvent } from "@opentui/core";
import type { BoxProps as OpenTuiBoxProps } from "@opentui/react";
import { useState, type ReactNode } from "react";

import { colors } from "./theme.ts";

/** Hover state for a clickable box. Moving between a box and its own text sends out then over, so it settles on the right value. */
export function useHover() {
  const [hover, setHover] = useState(false);
  return [hover, { onMouseOver: () => setHover(true), onMouseOut: () => setHover(false) }] as const;
}

/** True for a plain left click. */
export const isLeftClick = (event: MouseEvent) => event.button === 0;
export const isRightClick = (event: MouseEvent) => event.button === 2;

/**
 * A clickable label with its key beside it: `Approve y`. It takes the click for itself, so the
 * card or pane under it doesn't react too, and its text can't be drag-selected.
 */
export function Button(props: { readonly label: string; readonly shortcut?: string | undefined; readonly color?: string | undefined; readonly onPress: () => void }) {
  const [hover, hoverProps] = useHover();
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hover ? colors.selectedBg : colors.buttonBg}
      {...hoverProps}
      onMouseDown={(event: MouseEvent) => {
        event.stopPropagation();
        if (isLeftClick(event)) props.onPress();
      }}
    >
      <text fg={props.color ?? colors.text} selectable={false}>{props.label}</text>
      {props.shortcut ? <text fg={colors.faint} selectable={false}>{` ${props.shortcut}`}</text> : null}
    </box>
  );
}

/** Buttons in a row, wrapping on narrow screens. */
export function Buttons({ children }: { readonly children: ReactNode }) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
      {children}
    </box>
  );
}

type BoxProps = Omit<OpenTuiBoxProps, "onMouseDown" | "onMouseOver" | "onMouseOut" | "backgroundColor" | "children">;

/** A list row that lights up under the pointer: a click picks it, a right-click opens its menu when it has one. */
export function ClickRow({ selected, selectedBg, onPress, onMenu, children, ...box }: BoxProps & { readonly selected?: boolean; readonly selectedBg?: string; readonly onPress: () => void; readonly onMenu?: (() => void) | undefined; readonly children: ReactNode }) {
  const [hover, hoverProps] = useHover();
  return (
    <box
      {...box}
      backgroundColor={selected ? (selectedBg ?? colors.selectedBg) : hover ? colors.hoverBg : "transparent"}
      {...hoverProps}
      onMouseDown={(event: MouseEvent) => {
        if (isRightClick(event) && onMenu) return onMenu();
        if (isLeftClick(event)) onPress();
      }}
    >
      {children}
    </box>
  );
}

/** Wheel direction as a step: -1 up, 1 down, 0 for anything else. */
export function wheelStep(event: MouseEvent): -1 | 0 | 1 {
  return event.scroll?.direction === "up" ? -1 : event.scroll?.direction === "down" ? 1 : 0;
}

/**
 * The border between two panes, pressed to start resizing the one on its left. OpenTUI sends a
 * drag to whatever is under the pointer, so the app's root follows the drag (see App).
 */
export function ResizeHandle(props: { readonly active: boolean; readonly onStart: () => void; readonly onReset: () => void }) {
  const [hover, hoverProps] = useHover();
  return (
    <box
      width={1}
      flexShrink={0}
      border={["right"]}
      borderColor={hover || props.active ? colors.borderFocused : colors.border}
      {...hoverProps}
      onMouseDown={(event: MouseEvent) => {
        event.stopPropagation();
        if (isRightClick(event)) props.onReset();
        else if (isLeftClick(event)) props.onStart();
      }}
    />
  );
}
