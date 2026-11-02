import type { SettingRow } from "../model/settings.ts";
import { colors } from "./theme.ts";

/** Settings in place of the conversation: tui3's own (cycled with enter or a click), then the server's, read-only. */
export function SettingsView(props: {
  readonly rows: readonly SettingRow[];
  readonly server: readonly { label: string; value: string }[];
  readonly serverStatus: "loading" | "live" | "error";
  readonly selected: number;
  readonly path: string;
  readonly onCycle: (index: number) => void;
}) {
  const labelWidth = Math.max(...props.rows.map((row) => row.label.length), ...props.server.map((line) => line.label.length)) + 2;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.text}>
          <strong>Settings</strong>
        </text>
        <box flexGrow={1} />
        <text fg={colors.faint}>esc close</text>
      </box>
      <text fg={colors.faint} marginTop={1}>{`tui3 · ${props.path}`}</text>
      {props.rows.map((row, index) => {
        const selected = index === props.selected;
        return (
          <box key={row.key} flexDirection="row" height={1} backgroundColor={selected ? colors.selectedBg : "transparent"} onMouseDown={() => props.onCycle(index)}>
            <text fg={colors.muted} flexShrink={0}>{`${selected ? "▸ " : "  "}${row.label.padEnd(labelWidth)}`}</text>
            <text fg={colors.text} flexShrink={0}>{row.value}</text>
            <text fg={colors.faint} wrapMode="none">{`  ${row.help}`}</text>
          </box>
        );
      })}
      <text fg={colors.faint} marginTop={1}>T3 Code · change these in the app</text>
      {props.serverStatus === "loading" ? <text fg={colors.muted}>  Loading…</text> : null}
      {props.serverStatus === "error" ? <text fg={colors.bad}>  Could not read the server's settings.</text> : null}
      {props.server.map((line) => (
        <box key={line.label} flexDirection="row" height={1}>
          <text fg={colors.muted} flexShrink={0}>{`  ${line.label.padEnd(labelWidth)}`}</text>
          <text fg={colors.text}>{line.value}</text>
        </box>
      ))}
    </box>
  );
}
