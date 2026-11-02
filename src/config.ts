import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { configDir } from "./client/auth.ts";

/**
 * t3tui's own preferences. The web app keeps these in each browser's storage, out of the
 * server's reach, so t3tui keeps its own copy, under the web app's names and defaults.
 */
export interface T3tuiConfig {
  /** What enter does while the agent is running; alt+enter does the other. */
  readonly followUpBehavior: "steer" | "queue";
  /** "ctrl-enter" makes enter a newline and ctrl+enter send (needs the kitty keyboard protocol). */
  readonly sendShortcut: "enter" | "ctrl-enter";
  readonly timestampFormat: "locale" | "12-hour" | "24-hour";
  readonly diffIgnoreWhitespace: boolean;
  /** As the web's notificationMode: sound is the terminal bell, notifications go through the terminal. */
  readonly notificationMode: "off" | "notifications" | "sound" | "notifications-and-sound";
  /** As the web's in-app toasts: a line at the bottom for threads you aren't looking at. */
  readonly inAppNotificationsEnabled: boolean;
  /** auto picks dark or light from the terminal's background; terminal builds the palette from its colours. */
  readonly theme: "auto" | "dark" | "light" | "terminal";
}

export const DEFAULT_CONFIG: T3tuiConfig = { followUpBehavior: "steer", sendShortcut: "enter", timestampFormat: "locale", diffIgnoreWhitespace: true, notificationMode: "sound", inAppNotificationsEnabled: true, theme: "auto" };

/** Every setting with its choices in cycling order, for the settings view. */
export const CONFIG_CHOICES: { readonly [K in keyof T3tuiConfig]: readonly T3tuiConfig[K][] } = {
  followUpBehavior: ["steer", "queue"],
  sendShortcut: ["enter", "ctrl-enter"],
  timestampFormat: ["locale", "12-hour", "24-hour"],
  diffIgnoreWhitespace: [true, false],
  notificationMode: ["off", "sound", "notifications", "notifications-and-sound"],
  inAppNotificationsEnabled: [true, false],
  theme: ["auto", "dark", "light", "terminal"],
};

export const configPath = () => join(configDir(), "config.json");

/** Reads the config, keeping defaults for anything missing or not one of the choices. */
export async function loadConfig(): Promise<T3tuiConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    return DEFAULT_CONFIG;
  }
  return parseConfig(raw);
}

export function parseConfig(raw: unknown): T3tuiConfig {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const config: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const [key, choices] of Object.entries(CONFIG_CHOICES)) {
    if ((choices as readonly unknown[]).includes(record[key])) config[key] = record[key];
  }
  return config as unknown as T3tuiConfig;
}

export async function saveConfig(config: T3tuiConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

/** The next choice for one setting, wrapping around. */
export function cycleConfig<K extends keyof T3tuiConfig>(config: T3tuiConfig, key: K): T3tuiConfig {
  const choices = CONFIG_CHOICES[key] as readonly T3tuiConfig[K][];
  const next = choices[(choices.indexOf(config[key]) + 1) % choices.length]!;
  return { ...config, [key]: next };
}

/** A clock time ("HH:MM") in the chosen format, as the web app's timestamps. */
export function formatClock(timeOfDay: string, format: T3tuiConfig["timestampFormat"]): string {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return timeOfDay;
  const date = new Date(2000, 0, 1, hours, minutes);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(format === "locale" ? {} : { hour12: format === "12-hour" }) });
}
