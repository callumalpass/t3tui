import type { QueuedMessage } from "../model/queue.ts";
import { colors } from "./theme.ts";

/** As the web: three rows, then the rest behind "show all". */
const VISIBLE_ROWS = 3;

/**
 * The web's queued messages, just above the composer: each waits for the run to finish. Focused
 * (Q), j/k move, enter sends now, e edits in the composer, x removes.
 */
export function QueuePanel(props: { readonly queued: readonly QueuedMessage[]; readonly focus: number | null; readonly editingRunId: string | null; readonly held: boolean; readonly width: number }) {
  const { queued, focus } = props;
  const start = focus === null ? 0 : Math.max(0, Math.min(focus - 1, queued.length - VISIBLE_ROWS));
  const shown = queued.slice(start, start + VISIBLE_ROWS);
  const inner = Math.max(10, props.width - 8);
  return (
    <box border borderStyle="rounded" borderColor={focus === null ? colors.border : colors.borderFocused} flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} paddingLeft={1} paddingRight={1}>
      <text fg={colors.muted}>{`${queued.length} queued${props.held ? " · held after the interrupt" : ""}`}</text>
      {shown.map((message, offset) => {
        const index = start + offset;
        const editing = message.runId === props.editingRunId;
        return (
          <box key={message.runId} flexDirection="row" backgroundColor={index === focus ? colors.selectedBg : "transparent"}>
            <text fg={editing ? colors.accent : colors.text}>{`${index + 1}. ${truncate(message.text, inner)}`}</text>
            {editing ? <text fg={colors.accent}>{"  editing in the composer"}</text> : null}
          </box>
        );
      })}
      {queued.length > shown.length ? <text fg={colors.faint}>{`${queued.length - shown.length} more · Q to go through them`}</text> : null}
    </box>
  );
}

function truncate(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > width ? `${single.slice(0, Math.max(0, width - 1))}…` : single;
}
