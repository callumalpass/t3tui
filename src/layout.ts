import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { configDir } from "./client/auth.ts";

/**
 * Where you left the layout, kept across runs as the web keeps its sidebar width in the
 * browser's storage. Separate from the config: nobody edits this by hand.
 */
export interface Layout {
  /** The thread list's width once its border is dragged; null follows the window. */
  readonly listWidth: number | null;
  /** The details column's width once its border is dragged; null is the default width. */
  readonly detailsWidth: number | null;
  /** The thread list hidden with `b`. */
  readonly listHidden: boolean;
  /** The details column shown or hidden with `d`; null follows the window's width. */
  readonly details: boolean | null;
}

export const DEFAULT_LAYOUT: Layout = { listWidth: null, detailsWidth: null, listHidden: false, details: null };

const layoutPath = () => join(configDir(), "layout.json");

export async function loadLayout(): Promise<Layout> {
  try {
    return parseLayout(JSON.parse(await readFile(layoutPath(), "utf8")));
  } catch {
    // None saved yet, or unreadable: start from the defaults.
    return DEFAULT_LAYOUT;
  }
}

export function parseLayout(raw: unknown): Layout {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    listWidth: positiveInteger(record.listWidth),
    detailsWidth: positiveInteger(record.detailsWidth),
    listHidden: record.listHidden === true,
    details: typeof record.details === "boolean" ? record.details : null,
  };
}

const positiveInteger = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);

export async function saveLayout(layout: Layout): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(layoutPath(), `${JSON.stringify(layout, null, 2)}\n`);
}
