import type { OrchestrationV2SearchThreadsResult, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { THREAD_SEARCH_QUERY_MAX_LENGTH } from "@t3tools/contracts";
import { foldSearchQuery, messageSearchTokens, PALETTE_MESSAGE_LIMIT, rankMessageMatches } from "@t3tools/shared/paletteSearch";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadSearchSubject } from "@t3tools/client-runtime/state/thread-search";
import { EnvironmentId } from "@t3tools/contracts";
import { planPinnedReorder } from "@t3tools/client-runtime/state/thread-sort";
import type { PaletteGroup } from "./palette.ts";
import { projectLabel, type ThreadRow } from "./threads.ts";
import { unified } from "unified";
import remarkParse from "remark-parse";

const markdown = unified().use(remarkParse);
interface TextNode { readonly type: string; readonly value?: string; readonly children?: readonly TextNode[] }

/** OpenTUI renders Markdown, not HTML; search highlights use its text leaves without markup. */
export function findTextSegments(text: string, userMessage = false): readonly string[] {
  const tree = markdown.parse(text);
  const segments: string[] = [];
  const leaves = (node: TextNode): string => node.value ?? (node.children ?? []).map(leaves).join("");
  const visit = (node: TextNode) => {
    if (node.type === "code") segments.push(leaves(node));
    else if (["paragraph", "heading", "tableCell"].includes(node.type)) {
      const value = leaves(node);
      segments.push(...(userMessage ? value.split(/\r?\n/) : [value.replace(/\r?\n/g, " ")]));
    } else for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return segments;
}

/** The web searches messages only with a long token; omitted older titles need two characters. */
export function threadSearchQuery(query: string, olderSettled: boolean): string | null {
  if (query.startsWith(">")) return null;
  const normalized = query.trim().slice(0, THREAD_SEARCH_QUERY_MAX_LENGTH).trim();
  return messageSearchTokens(normalized).long.length > 0 || (olderSettled && normalized.length >= 2) ? normalized : null;
}

/** Late message results stay last, without duplicating or moving title matches. */
export function messageMatchGroups(groups: readonly PaletteGroup[], result: OrchestrationV2SearchThreadsResult | null, snapshot: OrchestrationV2ShellSnapshot | null, query = "", now = Date.now()): PaletteGroup[] {
  if (!result || !snapshot) return [...groups];
  const listed = new Set(groups.flatMap((group) => group.entries.flatMap((entry) => entry.kind === "thread" ? [entry.threadId] : [])));
  const threads = new Map([...snapshot.threads, ...(result.threads ?? [])].map((thread) => [thread.id, thread]));
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const ranked = rankMessageMatches(result.matches, (match) => {
    const thread = threads.get(match.threadId);
    return thread ? threadSearchSubject(presentThreadShell(EnvironmentId.make("local"), thread), projectLabel(projects.get(thread.projectId))) : undefined;
  }, foldSearchQuery(query), now);
  const entries = ranked.flatMap((match) => {
    const thread = threads.get(match.threadId);
    if (listed.has(match.threadId) || thread?.archivedAt != null || thread?.deletedAt != null) return [];
    listed.add(match.threadId);
    return [{ kind: "thread" as const, threadId: match.threadId, title: thread?.title || "Thread", project: projectLabel(projects.get(match.projectId)), subagent: thread?.lineage.relationshipToParent === "subagent", snippet: match.snippet }];
  });
  return entries.length ? [...groups, { label: "In messages", entries: entries.slice(0, PALETTE_MESSAGE_LIMIT) }] : [...groups];
}

/** Live shell rows win over fetched pages, so returning activity cannot be overwritten by an old page. */
export function mergeThreadShells(snapshot: OrchestrationV2ShellSnapshot | null, extra: readonly OrchestrationV2ThreadShell[]): OrchestrationV2ShellSnapshot | null {
  if (!snapshot) return null;
  const threads = new Map(extra.map((thread) => [thread.id, thread]));
  for (const thread of snapshot.archivedThreads ?? []) threads.set(thread.id, thread);
  for (const thread of snapshot.threads) threads.set(thread.id, thread);
  return { ...snapshot, threads: [...threads.values()] };
}

/** Keyboard moves use the web's midpoint planner, including its keyless-section rewrite. */
export function threadReorder(rows: readonly ThreadRow[], threadId: ThreadId, delta: 1 | -1, retainedRows = rows) {
  const row = rows.find((candidate) => candidate.thread.id === threadId);
  if (!row || (row.section !== "pinned" && row.section !== "active")) return null;
  const section = row.section;
  const members = rows.filter((candidate) => candidate.section === section);
  const orderedIds = members.map((candidate) => candidate.thread.id);
  const index = orderedIds.indexOf(threadId);
  const target = index + delta;
  if (target < 0 || target >= orderedIds.length) return null;
  [orderedIds[index], orderedIds[target]] = [orderedIds[target]!, orderedIds[index]!];
  return { section, assignments: planPinnedReorder({ orderedIds, movedId: threadId, keysById: new Map(retainedRows.filter((row) => row.section === section).map(({ thread }) => [thread.id, section === "pinned" ? thread.pinOrderKey : thread.activeOrderKey])) }) };
}
