import type { ProjectEntry } from "@t3tools/contracts";
import { tildify } from "./paths.ts";

import type { ChangedFile } from "./details.ts";

/** A line of the Files tab: an entry, or the `…` under a folder still loading. */
export type FileRow =
  | {
      readonly kind: "file" | "directory";
      readonly path: string;
      readonly name: string;
      readonly depth: number;
      readonly expanded: boolean;
      readonly ignored: boolean;
      /** The Changes list's mark for it, or for a whole untracked folder. */
      readonly marker: ChangedFile["status"] | null;
      /** A folder with changes somewhere inside it. */
      readonly changedInside: boolean;
    }
  | { readonly kind: "loading"; readonly path: string; readonly depth: number };

export interface FileTreeInput {
  /** Each listed folder's entries, by its path ("" for the root). */
  readonly directories: ReadonlyMap<string, readonly ProjectEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly loading: ReadonlySet<string>;
  /** Paths git ignores, as listIgnoredFiles reports them. */
  readonly ignored: ReadonlySet<string>;
  /** The working tree's changes, as the Changes list has them. */
  readonly changes: readonly ChangedFile[];
}

/** The folder a path is in, "" at the root. */
export const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** Folders first, then by name, as file explorers sort. */
export function sortEntries(entries: readonly ProjectEntry[]): ProjectEntry[] {
  return entries
    .filter((entry) => nameOf(entry.path) !== ".git")
    .toSorted((a, b) => (a.kind === b.kind ? nameOf(a.path).localeCompare(nameOf(b.path), undefined, { sensitivity: "base" }) : a.kind === "directory" ? -1 : 1));
}

/** The tree as rows: each listed folder's entries under it, expanded folders open. */
export function fileRows(input: FileTreeInput): FileRow[] {
  const untracked = input.changes.filter((file) => file.path.endsWith("/")).map((file) => file.path);
  const changed = new Map(input.changes.map((file) => [file.path, file.status] as const));
  const rows: FileRow[] = [];
  const visit = (directory: string, depth: number, ignoredAbove: boolean) => {
    for (const entry of sortEntries(input.directories.get(directory) ?? [])) {
      const folder = entry.kind === "directory";
      const expanded = folder && input.expanded.has(entry.path);
      const ignored = ignoredAbove || entry.ignored === true || input.ignored.has(entry.path);
      const marker = changed.get(folder ? `${entry.path}/` : entry.path) ?? (untracked.some((path) => entry.path.startsWith(path)) ? "?" : null);
      const changedInside = folder && marker === null && input.changes.some((file) => file.path.startsWith(`${entry.path}/`));
      rows.push({ kind: entry.kind, path: entry.path, name: nameOf(entry.path), depth, expanded, ignored, marker, changedInside });
      if (!expanded) continue;
      if (input.directories.has(entry.path)) visit(entry.path, depth + 1, ignored);
      else if (input.loading.has(entry.path)) rows.push({ kind: "loading", path: entry.path, depth: depth + 1 });
    }
  };
  visit("", 0, false);
  return rows;
}

/** How the preview tab shows a file: highlighted code, rendered markdown, or an image. */
export function previewKind(path: string): "code" | "markdown" | "image" {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "md" || extension === "markdown") return "markdown";
  return IMAGE_EXTENSIONS.has(extension) ? "image" : "code";
}
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** `~/…/project`: the root with the home folder shortened, cut from the middle to `width`. */
export function rootLabel(root: string, width: number): string {
  const path = tildify(root);
  if (path.length <= width) return path;
  const name = nameOf(path);
  const head = path.startsWith("~/") || path.startsWith("~\\") ? "~/…/" : "…/";
  return head.length + name.length <= width ? `${head}${name}` : `…${name.slice(Math.max(0, name.length - width + 1))}`;
}

/** `12 KB`, as the binary note says it. */
export function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const nameOf = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
