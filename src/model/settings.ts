import type { ServerConfig } from "@t3tools/contracts";

import { CONFIG_CHOICES, type Tui3Config } from "../config.ts";
import { RUNTIME_MODE_LABELS } from "./details.ts";

export interface SettingRow {
  readonly key: keyof Tui3Config;
  readonly label: string;
  readonly value: string;
  readonly help: string;
}

const LABELS: { readonly [K in keyof Tui3Config]: { readonly label: string; readonly help: string; readonly values?: Partial<Record<string, string>> } } = {
  followUpBehavior: { label: "While the agent runs, enter", help: "alt+enter does the other", values: { steer: "steers", queue: "queues" } },
  sendShortcut: { label: "Send with", help: "ctrl+enter needs kitty keyboard support; alt+enter also sends", values: { enter: "enter", "ctrl-enter": "ctrl+enter (enter adds a line)" } },
  timestampFormat: { label: "Times", help: "automation schedules", values: { locale: "system locale", "12-hour": "12-hour", "24-hour": "24-hour" } },
  diffIgnoreWhitespace: { label: "Diffs", help: "whitespace-only changes", values: { true: "ignore whitespace", false: "show whitespace" } },
};

/** tui3's own settings, in display order, each cycled with enter. */
export function settingRows(config: Tui3Config): SettingRow[] {
  return (Object.keys(CONFIG_CHOICES) as (keyof Tui3Config)[]).map((key) => {
    const meta = LABELS[key];
    const raw = String(config[key]);
    return { key, label: meta.label, value: meta.values?.[raw] ?? raw, help: meta.help };
  });
}

/** The server settings worth knowing from the terminal, read-only: they're changed in the app. */
export function serverSettingLines(config: ServerConfig | null): { label: string; value: string }[] {
  if (!config) return [];
  const settings = config.settings;
  return [
    { label: "Server", value: `${config.environment.label} · T3 Code ${config.environment.serverVersion}` },
    { label: "New thread model", value: settings.defaultModelSelection ? settings.defaultModelSelection.model : "provider default" },
    { label: "New thread mode", value: RUNTIME_MODE_LABELS[settings.defaultRuntimeMode] ?? settings.defaultRuntimeMode },
    { label: "New threads run in", value: settings.defaultThreadEnvMode ?? "project default" },
    { label: "Auto-settle", value: settings.sidebarAutoSettleAfterDays ? `after ${settings.sidebarAutoSettleAfterDays} days idle` : "off" },
    { label: "Rate-limited threads", value: [settings.snoozeLimitedThreads ? "snooze" : "", settings.autoResumeLimitedThreads ? "resume when reset" : ""].filter(Boolean).join(", ") || "left as they are" },
  ];
}
