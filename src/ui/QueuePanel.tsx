import type { MouseEvent } from "@opentui/core";

import type { QueuedMessage } from "../model/queue.ts";
import { Button, Buttons, isLeftClick, useHover } from "./Button.tsx";
import { truncate } from "./text.ts";
import { colors } from "./theme.ts";

export interface QueueActions {
  readonly focus: (index: number) => void;
  readonly sendNow: (index: number) => void;
  readonly edit: (index: number) => void;
  readonly remove: (index: number) => void;
  /** Continue after an interrupt, or send what it held back. */
  readonly resume: (() => void) | null;
}

/** As the web: three rows, then the rest behind "show all". */
const VISIBLE_ROWS = 3;

/**
 * The web's queued messages, just above the composer: each waits for the run to finish. Focused
 * (Q), j/k move, enter sends now, e edits in the composer, x removes.
 */
export function QueuePanel(props: { readonly queued: readonly QueuedMessage[]; readonly focus: number | null; readonly editingRunId: string | null; readonly held: boolean; readonly width: number; readonly actions: QueueActions }) {
  const { actions } = props;
  const { queued, focus } = props;
  const start = focus === null ? 0 : Math.max(0, Math.min(focus - 1, queued.length - VISIBLE_ROWS));
  const shown = queued.slice(start, start + VISIBLE_ROWS);
  const inner = Math.max(10, props.width - 8);
  return (
    <box border borderStyle="rounded" borderColor={focus === null ? colors.border : colors.borderFocused} flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" columnGap={1}>
        <text fg={colors.muted}>{`${queued.length} queued${props.held ? " · held after the interrupt" : ""}`}</text>
        {props.held && actions.resume ? <Button label="Send them now" shortcut="enter" color={colors.accent} onPress={actions.resume} /> : null}
      </box>
      {shown.map((message, offset) => {
        const index = start + offset;
        const editing = message.runId === props.editingRunId;
        return <QueueRow key={message.runId} text={message.text} width={inner} focused={index === focus} editing={editing} index={index} actions={actions} />;
      })}
      {queued.length > shown.length ? <text fg={colors.faint}>{`${queued.length - shown.length} more · Q to go through them`}</text> : null}
    </box>
  );
}

function QueueRow(props: { readonly text: string; readonly width: number; readonly focused: boolean; readonly editing: boolean; readonly index: number; readonly actions: QueueActions }) {
  const { index, actions } = props;
  const [hover, hoverProps] = useHover();
  const buttons = props.focused || hover;
  return (
    <box flexDirection="row" columnGap={1} backgroundColor={props.focused ? colors.selectedBg : hover ? colors.hoverBg : "transparent"} {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && actions.focus(index)}>
      <text fg={props.editing ? colors.accent : colors.text} selectable={false}>{`${index + 1}. ${truncate(props.text, props.width - (buttons ? 34 : 0) - (props.editing ? 24 : 0))}`}</text>
      {props.editing ? <text fg={colors.accent} selectable={false}>{" editing in the composer"}</text> : null}
      <box flexGrow={1} />
      {buttons ? (
        <Buttons>
          <Button label="Send now" shortcut="s" onPress={() => actions.sendNow(index)} />
          <Button label="Edit" shortcut="e" onPress={() => actions.edit(index)} />
          <Button label="Remove" shortcut="x" color={colors.bad} onPress={() => actions.remove(index)} />
        </Buttons>
      ) : null}
    </box>
  );
}
