import { EnvironmentId, type ContextMenuItem, type OrchestrationV2ShellSnapshot, type OrchestrationV2ThreadShell, type ServerConfig } from "@t3tools/contracts";
import { presentThreadShell, threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import { canSnooze, effectiveSnoozed, pickSnoozePreset, resolveSnoozePresets, type SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import { pinOrderKeyBetween } from "@t3tools/client-runtime/state/thread-sort";

import type { T3tuiConfig } from "../config.ts";
import { buildThreadActionMenuItems, type ThreadActionMenuId } from "../../vendor/t3code/apps/web/src/components/threadActionMenu.logic.ts";

export type { ThreadActionMenuId };

const LOCAL = EnvironmentId.make("local");

/** Web-only actions: project settings, guest links, turning into a project. */
const UNSUPPORTED: ReadonlySet<ThreadActionMenuId> = new Set(["project-settings", "share-guest", "turn-into-project", "filter-by-project"]);

export interface ThreadMenu {
  readonly items: readonly ContextMenuItem<ThreadActionMenuId>[];
  readonly snoozePresets: readonly SnoozePreset[];
}

/** The web sidebar's thread menu (right-click), from the same builder, less what t3tui can't do. */
export function threadMenu(input: { readonly thread: OrchestrationV2ThreadShell; readonly config: ServerConfig | null; readonly timestampFormat: T3tuiConfig["timestampFormat"]; readonly now?: Date }): ThreadMenu {
  const { config } = input;
  // The presented shell carries what the menu reads: pending requests, the runtime.
  const thread = presentThreadShell(config?.environment.environmentId ?? LOCAL, input.thread);
  const now = input.now ?? new Date();
  const loaded = config !== null;
  const snoozePresets = snoozeMenu(config, input.timestampFormat, now);
  const items = buildThreadActionMenuItems({
    canOperate: true,
    canFind: true,
    branch: thread.branch ?? null,
    projectFilter: null,
    isPinned: thread.pinnedAt != null,
    isSettled: loaded && thread.settledOverride === "settled",
    autoSettleEnabled: thread.autoSettleDisabledAt == null,
    isSnoozed: loaded && effectiveSnoozed(thread, { now: now.toISOString() }),
    canSnoozeNow: canSnooze(thread, { now: now.toISOString() }),
    isRegeneratingTitle: thread.titleRegeneration != null,
    isRunning: !threadRuntimeCanArchive(thread.runtime),
    supports: { settlement: loaded, autoSettleOptOut: config?.environment.capabilities.threadAutoSettleOptOut === true, snooze: loaded, pinning: loaded, titleRegeneration: loaded },
    snoozePresets,
  });
  return { items: items.filter((item) => !UNSUPPORTED.has(item.id)), snoozePresets };
}

function snoozeMenu(config: ServerConfig | null, timestampFormat: T3tuiConfig["timestampFormat"], now: Date): readonly SnoozePreset[] {
  const presets = config?.settings.snoozePresets;
  return resolveSnoozePresets(now, { ...(presets ? { presets } : {}), formatTime: (date) => formatTime(date, timestampFormat) });
}

/** A shown snooze choice, re-resolved now as the web does; undefined once its time has passed. */
export function pickSnooze(shown: readonly SnoozePreset[], id: string, config: ServerConfig | null, timestampFormat: T3tuiConfig["timestampFormat"]): SnoozePreset | undefined {
  const presets = config?.settings.snoozePresets;
  return pickSnoozePreset({ shown, id, now: new Date(), ...(presets ? { presets } : {}), formatTime: (date) => formatTime(date, timestampFormat) });
}

function formatTime(date: Date, format: T3tuiConfig["timestampFormat"]): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(format === "locale" ? {} : { hour12: format === "12-hour" }) });
}

/**
 * A custom snooze, typed: a duration (`45m`, `3h`, `2d`, `1w`) or a time of day (`17:30`, the
 * next time it comes round). The web's calendar picker doesn't fit a terminal.
 */
export function parseSnooze(text: string, now = new Date()): Date | null {
  const input = text.trim().toLowerCase();
  const duration = /^(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/.exec(input);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2]![0]!;
    if (amount <= 0) return null;
    if (unit === "m" || unit === "h") return new Date(now.getTime() + amount * (unit === "m" ? 60_000 : 3_600_000));
    const wake = new Date(now);
    wake.setDate(wake.getDate() + amount * (unit === "w" ? 7 : 1));
    return wake;
  }
  const time = /^(\d{1,2}):(\d{2})$/.exec(input);
  if (time) {
    const hours = Number(time[1]);
    const minutes = Number(time[2]);
    if (hours > 23 || minutes > 59) return null;
    const wake = new Date(now);
    wake.setHours(hours, minutes, 0, 0);
    if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
    return wake;
  }
  return null;
}

/** Whether the thread has a runtime, whose provider sessions a delete detaches first. */
export function threadHasRuntime(thread: OrchestrationV2ThreadShell, config: ServerConfig | null): boolean {
  return presentThreadShell(config?.environment.environmentId ?? LOCAL, thread).runtime != null;
}

/** A pin goes to the top of the pinned run, as the web pins. */
export function topPinOrderKey(snapshot: OrchestrationV2ShellSnapshot | null): string | undefined {
  let first: string | null = null;
  for (const thread of snapshot?.threads ?? []) {
    if (thread.pinnedAt == null || thread.pinOrderKey == null) continue;
    if (first === null || thread.pinOrderKey < first) first = thread.pinOrderKey;
  }
  return pinOrderKeyBetween(null, first) ?? undefined;
}
