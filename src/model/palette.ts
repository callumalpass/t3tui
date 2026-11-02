import type { OrchestrationProjectShell, OrchestrationV2ShellSnapshot, ThreadId } from "@t3tools/contracts";
import { foldSearchQuery, scoreSearchTerms, scoreThreadSearch, type ThreadSearchSubject } from "@t3tools/shared/paletteSearch";
import * as DateTime from "effect/DateTime";

import { projectLabel } from "./threads.ts";

/** A command the palette can run; `when` false hides it. */
export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  /** The key that does the same, shown on the right. */
  readonly shortcut?: string;
  /** Extra words it answers to. */
  readonly keywords?: readonly string[];
}

export type PaletteEntry =
  | { readonly kind: "command"; readonly command: PaletteCommand }
  | { readonly kind: "thread"; readonly threadId: ThreadId; readonly title: string; readonly project: string; readonly subagent: boolean; readonly snippet?: string };

export interface PaletteGroup {
  readonly label: string;
  readonly entries: readonly PaletteEntry[];
}

/** Threads shown before you type, as the web palette's recent threads. */
const RECENT_THREADS = 8;
/** As the web palette's PALETTE_THREAD_LIMIT. */
const THREAD_LIMIT = 20;

/**
 * The web palette's search: commands by name and keywords, threads by T3's own thread
 * scoring (title, branch, project, PRs, recent use). `>` searches commands only.
 */
export function paletteGroups(input: {
  readonly query: string;
  readonly commands: readonly PaletteCommand[];
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  readonly now?: number;
}): PaletteGroup[] {
  const now = input.now ?? Date.now();
  const commandsOnly = input.query.startsWith(">");
  const query = foldSearchQuery(commandsOnly ? input.query.slice(1) : input.query);
  const commands = query
    ? input.commands
        .map((command) => ({ command, match: scoreSearchTerms(query, [command.title, ...(command.keywords ?? [])], { typos: true }) }))
        .filter((candidate) => candidate.match !== null)
        .sort((a, b) => b.match!.score - a.match!.score)
        .map(({ command }) => command)
    : input.commands;
  const groups: PaletteGroup[] = [];
  if (commands.length > 0) groups.push({ label: "Commands", entries: commands.map((command) => ({ kind: "command", command })) });
  if (commandsOnly || !input.snapshot) return groups;

  const projects = new Map<string, OrchestrationProjectShell>(input.snapshot.projects.map((project) => [project.id, project]));
  const candidates = input.snapshot.threads
    .filter((thread) => thread.archivedAt === null && thread.deletedAt === null)
    .map((thread) => {
      const project = projectLabel(projects.get(thread.projectId));
      const subject: ThreadSearchSubject = {
        id: thread.id,
        title: thread.title,
        branch: thread.branch,
        projectTitle: project,
        pullRequests: (thread.pullRequests ?? []).map((pr) => ({ number: pr.number, title: pr.snapshot?.title ?? null, references: [pr.url] })),
        activityAt: DateTime.toEpochMillis(thread.latestUserMessageAt ?? thread.updatedAt),
        opens: thread.opens ?? null,
      };
      return { thread, project, subject };
    });
  const ranked = query
    ? candidates
        .map((candidate) => ({ candidate, match: scoreThreadSearch(query, candidate.subject, now) }))
        .filter((scored) => scored.match !== null)
        .sort((a, b) => b.match!.score - a.match!.score)
        .slice(0, THREAD_LIMIT)
        .map(({ candidate }) => candidate)
    : candidates.sort((a, b) => (b.subject.activityAt ?? 0) - (a.subject.activityAt ?? 0)).slice(0, RECENT_THREADS);
  if (ranked.length > 0) {
    groups.push({
      label: query ? "Threads" : "Recent threads",
      entries: ranked.map(({ thread, project }) => ({ kind: "thread", threadId: thread.id, title: thread.title || "New thread", project, subagent: thread.lineage.relationshipToParent === "subagent" })),
    });
  }
  return groups;
}

export function paletteEntries(groups: readonly PaletteGroup[]): PaletteEntry[] {
  return groups.flatMap((group) => group.entries);
}

/** A choice in a picker (model, option, project, terminal…). */
export interface PickerItem {
  readonly id: string;
  readonly title: string;
  /** Shown on the right: "current", a provider, a status. */
  readonly hint?: string;
  /** Only listed once you type: a submenu's items, found from the top. */
  readonly searchOnly?: boolean;
  readonly run: () => void;
}

export interface Picker {
  readonly placeholder: string;
  readonly groups: readonly { readonly label: string; readonly items: readonly PickerItem[] }[];
}

/** A picker's groups filtered and ranked by the query, in the palette's shape. */
export function pickerGroups(picker: Picker, query: string): PaletteGroup[] {
  const folded = foldSearchQuery(query);
  return picker.groups
    .map((group) => {
      const items = folded
        ? group.items
            .map((item) => ({ item, match: scoreSearchTerms(folded, [item.title, group.label, item.hint ?? ""], { typos: true }) }))
            .filter((candidate) => candidate.match !== null)
            .sort((a, b) => b.match!.score - a.match!.score)
            .map(({ item }) => item)
        : group.items.filter((item) => !item.searchOnly);
      return { label: group.label, entries: items.map((item): PaletteEntry => ({ kind: "command", command: { id: item.id, title: item.title, ...(item.hint ? { shortcut: item.hint } : {}) } })) };
    })
    .filter((group) => group.entries.length > 0);
}
