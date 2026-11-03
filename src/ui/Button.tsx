import type { MouseEvent } from "@opentui/core";
import type { BoxProps as OpenTuiBoxProps } from "@opentui/react";
import { useState, type ReactNode } from "react";

import { BAR, NO_BORDER } from "./edges.ts";
import { truncate } from "./text.ts";
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
export function Button(props: { readonly label: string; readonly shortcut?: string | undefined; readonly color?: string | undefined; /** No background or padding: a bare clickable label, as in the header. */ readonly plain?: boolean; readonly onPress: () => void }) {
  const [hover, hoverProps] = useHover();
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={props.plain ? 0 : 1}
      paddingRight={props.plain ? 0 : 1}
      backgroundColor={props.plain ? "transparent" : hover ? colors.selectedBg : colors.buttonBg}
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
 * The 1-column drag target between the conversation and the list or details, or with
 * `horizontal` the 1-row one above the terminal drawer. At rest it is invisible
 * (the panel/background shade change is the edge, and the bar is drawn in the background
 * colour, which also keeps it findable on screen for tests); under the pointer or while
 * dragging it shows as an accent bar. OpenTUI sends a drag to whatever is under the
 * pointer, so the app's root follows the drag (see App).
 */
export function ResizeHandle(props: { readonly active: boolean; readonly horizontal?: boolean; readonly onStart: (event: MouseEvent) => void; readonly onReset: () => void }) {
  const [hover, hoverProps] = useHover();
  return (
    <box
      {...(props.horizontal ? { height: 1, border: ["top"] as const, customBorderChars: { ...NO_BORDER, horizontal: "━" } } : { width: 1, border: ["left"] as const, customBorderChars: BAR })}
      flexShrink={0}
      borderColor={hover || props.active ? colors.accent : colors.bg}
      backgroundColor={colors.bg}
      {...hoverProps}
      onMouseDown={(event: MouseEvent) => {
        event.stopPropagation();
        if (isRightClick(event)) props.onReset();
        else if (isLeftClick(event)) props.onStart(event);
      }}
    />
  );
}

type TabItem = {
  readonly id: string;
  readonly label: string;
  readonly closable?: boolean;
  /** The label cut to a width, when cutting its end isn't the way (a path keeps its file name). */
  readonly shorten?: (width: number) => string;
};

/** The fewest columns a label is cut to. */
const MIN_TAB_LABEL = 4;

/**
 * A one-line strip of tabs. In a focused pane the active one is in the accent; otherwise the
 * strip goes quiet. A click switches; with `onClose`, the active tab has a ✕ and a middle-click
 * closes any tab. Long labels are cut to fit `width`. Anything after the tabs
 * (a `+ new`) goes in `children`, outside `width`.
 */
export function Tabs(props: {
  readonly tabs: readonly TabItem[];
  readonly active: string | null;
  readonly focused: boolean;
  readonly width: number;
  readonly onPick: (id: string) => void;
  readonly onClose?: (id: string) => void;
  readonly children?: ReactNode;
}) {
  const { onClose } = props;
  const closable = (tab: TabItem) => onClose !== undefined && tab.closable !== false;
  const labels = fitLabels(props.tabs, props.width - props.tabs.reduce((sum, tab) => sum + 2 + (tab.id === props.active && closable(tab) ? 2 : 0), 0));
  return (
    <box flexDirection="row" height={1} flexShrink={0} flexGrow={1} overflow="hidden">
      {props.tabs.map((tab, index) => (
        <Tab
          key={tab.id}
          label={labels[index]!}
          active={tab.id === props.active}
          focused={props.focused}
          onPress={() => props.onPick(tab.id)}
          {...(onClose && closable(tab) ? { onClose: () => onClose(tab.id) } : {})}
        />
      ))}
      {props.children}
    </box>
  );
}

/** The tabs' labels cut to fit `room` in all: each to the same widest width that fits, but no narrower than a few columns. */
function fitLabels(tabs: readonly TabItem[], room: number): string[] {
  const widths = tabs.map((tab) => Bun.stringWidth(tab.label));
  let cap = Math.max(0, ...widths);
  while (cap > MIN_TAB_LABEL && widths.reduce((sum, width) => sum + Math.min(width, cap), 0) > room) cap--;
  return tabs.map((tab, index) => (widths[index]! <= cap ? tab.label : (tab.shorten?.(cap) ?? truncate(tab.label, cap))));
}

export function Tab(props: { readonly label: string; readonly active?: boolean; readonly focused?: boolean; readonly onPress: () => void; readonly onClose?: (() => void) | undefined }) {
  const [hover, hoverProps] = useHover();
  const { active, focused, onClose } = props;
  const color = hover ? colors.text : active ? (focused ? colors.accent : colors.muted) : focused ? colors.muted : colors.faint;
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={active ? colors.element : hover ? colors.hoverBg : "transparent"}
      {...hoverProps}
      onMouseDown={(event: MouseEvent) => {
        event.stopPropagation();
        if (isLeftClick(event)) props.onPress();
        else if (event.button === 1) onClose?.();
      }}
    >
      <text fg={color} wrapMode="none" selectable={false}>{props.label}</text>
      {active && onClose ? (
        <text
          fg={focused ? colors.muted : colors.faint}
          wrapMode="none"
          selectable={false}
          onMouseDown={(event: MouseEvent) => {
            event.stopPropagation();
            if (isLeftClick(event)) onClose();
          }}
        >
          {" ✕"}
        </text>
      ) : null}
    </box>
  );
}
