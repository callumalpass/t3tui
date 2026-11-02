import type { ComposerItem } from "../model/composerMenu.ts";
import { ClickRow } from "./Button.tsx";
import { BAR } from "./edges.ts";
import { truncate } from "./text.ts";
import { colors } from "./theme.ts";

const MAX_ROWS = 8;

/**
 * The web composer's / $ @ menu, just above the message box: ↑/↓ or ctrl+n/p move, tab or
 * enter chooses, a click chooses, esc closes.
 */
export function ComposerMenu(props: { readonly items: readonly ComposerItem[]; readonly selected: number; readonly empty: string; readonly width: number; readonly onPick: (index: number) => void }) {
  const { items, selected } = props;
  const start = Math.max(0, Math.min(selected - Math.floor(MAX_ROWS / 2), items.length - MAX_ROWS));
  const inner = Math.max(10, props.width - 3);
  return (
    <box border={["left"]} customBorderChars={BAR} borderColor={colors.accent} flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} backgroundColor={colors.panel}>
      {items.length === 0 ? (
        <text fg={colors.muted} paddingLeft={1}>
          {props.empty}
        </text>
      ) : (
        items.slice(start, start + MAX_ROWS).map((item, offset) => {
          const index = start + offset;
          const label = truncate(item.label, Math.floor(inner * 0.5));
          return (
            <ClickRow key={item.id} flexDirection="row" paddingLeft={1} paddingRight={1} selected={index === selected} onPress={() => props.onPick(index)}>
              <text fg={index === selected ? colors.text : colors.accent}>{label}</text>
              <text fg={colors.faint}>{`  ${truncate(item.description, inner - label.length - 2)}`}</text>
            </ClickRow>
          );
        })
      )}
      {items.length > MAX_ROWS ? <text fg={colors.faint} paddingLeft={1}>{`${selected + 1} of ${items.length}`}</text> : null}
    </box>
  );
}
