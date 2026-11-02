import type { SettingRow } from "../model/settings.ts";
import { ClickRow } from "./Button.tsx";
import { colors } from "./theme.ts";

/** Settings in place of the conversation: tui3's own (cycled with enter or a click), then the server's, read-only. */
export function SettingsView(props: {
  readonly rows: readonly SettingRow[];
  readonly server: readonly { label: string; value: string }[];
  readonly serverStatus: "loading" | "live" | "error";
  /** Usage limits and the last 30 days' totals, read-only; left out until known. */
  readonly usage?: readonly { label: string; value: string }[];
  readonly selected: number;
  readonly path: string;
  readonly onCycle: (index: number) => void;
}) {
  const usage = props.usage ?? [];
  const labelWidth = Math.max(...props.rows.map((row) => row.label.length), ...props.server.map((line) => line.label.length), ...usage.map((line) => line.label.length)) + 2;
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={colors.text}>
          <strong>Settings</strong>
        </text>
        <box flexGrow={1} />
        <text fg={colors.faint}>esc close</text>
      </box>
      <text fg={colors.text} marginTop={1}>
        <strong>{`tui3 · ${props.path}`}</strong>
      </text>
      {props.rows.map((row, index) => {
        const selected = index === props.selected;
        return (
          <ClickRow key={row.key} flexDirection="row" height={1} selected={selected} onPress={() => props.onCycle(index)}>
            <text fg={colors.accent} flexShrink={0} selectable={false}>{selected ? "▌" : " "}</text>
            <text fg={colors.muted} flexShrink={0}>{` ${row.label.padEnd(labelWidth)}`}</text>
            <text fg={selected ? colors.text : colors.muted} flexShrink={0}>{row.value}</text>
            <text fg={colors.faint} wrapMode="none">{`  ${row.help}`}</text>
          </ClickRow>
        );
      })}
      <text fg={colors.text} marginTop={1}>
        <strong>T3 Code · change these in the app</strong>
      </text>
      {props.serverStatus === "loading" ? <text fg={colors.muted}>  Loading…</text> : null}
      {props.serverStatus === "error" ? <text fg={colors.bad}>  Could not read the server's settings.</text> : null}
      {props.server.map((line) => (
        <box key={line.label} flexDirection="row" height={1}>
          <text fg={colors.muted} flexShrink={0}>{`  ${line.label.padEnd(labelWidth)}`}</text>
          <text fg={colors.muted}>{line.value}</text>
        </box>
      ))}
      {usage.length > 0 ? (
        <text fg={colors.text} marginTop={1}>
          <strong>Usage</strong>
        </text>
      ) : null}
      {usage.map((line) => (
        <box key={`${line.label}:${line.value}`} flexDirection="row" height={1}>
          <text fg={colors.muted} flexShrink={0}>{`  ${line.label.padEnd(labelWidth)}`}</text>
          <text fg={colors.muted}>{line.value}</text>
        </box>
      ))}
    </box>
  );
}
