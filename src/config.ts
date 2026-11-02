import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { configDir } from "./client/auth.ts";

/**
 * tui3's own preferences. The web app keeps these in each browser's storage, out of the
 * server's reach, so tui3 keeps its own copy, under the web app's names and defaults.
 */
export interface Tui3Config {
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
}

export const DEFAULT_CONFIG: Tui3Config = { followUpBehavior: "steer", sendShortcut: "enter", timestampFormat: "locale", diffIgnoreWhitespace: true, notificationMode: "sound", inAppNotificationsEnabled: true };

/** Every setting with its choices in cycling order, for the settings view. */
export const CONFIG_CHOICES: { readonly [K in keyof Tui3Config]: readonly Tui3Config[K][] } = {
  followUpBehavior: ["steer", "queue"],
  sendShortcut: ["enter", "ctrl-enter"],
  timestampFormat: ["locale", "12-hour", "24-hour"],
  diffIgnoreWhitespace: [true, false],
  notificationMode: ["off", "sound", "notifications", "notifications-and-sound"],
  inAppNotificationsEnabled: [true, false],
};

export const configPath = () => join(configDir(), "config.json");

/** Reads the config, keeping defaults for anything missing or not one of the choices. */
export async function loadConfig(): Promise<Tui3Config> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    return DEFAULT_CONFIG;
  }
  return parseConfig(raw);
}

export function parseConfig(raw: unknown): Tui3Config {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const config: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const [key, choices] of Object.entries(CONFIG_CHOICES)) {
    if ((choices as readonly unknown[]).includes(record[key])) config[key] = record[key];
  }
  return config as unknown as Tui3Config;
}

export async function saveConfig(config: Tui3Config): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

/** The next choice for one setting, wrapping around. */
export function cycleConfig<K extends keyof Tui3Config>(config: Tui3Config, key: K): Tui3Config {
  const choices = CONFIG_CHOICES[key] as readonly Tui3Config[K][];
  const next = choices[(choices.indexOf(config[key]) + 1) % choices.length]!;
  return { ...config, [key]: next };
}

/** A clock time ("HH:MM") in the chosen format, as the web app's timestamps. */
export function formatClock(timeOfDay: string, format: Tui3Config["timestampFormat"]): string {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return timeOfDay;
  const date = new Date(2000, 0, 1, hours, minutes);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(format === "locale" ? {} : { hour12: format === "12-hour" }) });
}
