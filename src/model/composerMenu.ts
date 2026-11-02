import type { EnvironmentId, OrchestrationMessageContext, OrchestrationV2ShellSnapshot, ProjectEntry, ServerProvider, ServerProviderSkill, ThreadContextRecord, ThreadId } from "@t3tools/contracts";
import { resolveProviderSkillsForCwd, resolveProviderSlashCommandsForCwd } from "@t3tools/client-runtime/providerSkills";
import { getProviderSkillsForSlashMenu, getProviderSlashCommandsForSlashMenu } from "@t3tools/client-runtime/providerSkills";
import { collectComposerContextReferences, formatComposerContextReference, threadContextRecord } from "@t3tools/shared/composerContextReferences";
import { detectComposerTrigger, replaceTextRange, serializeComposerFileLink, type ComposerTrigger } from "@t3tools/shared/composerTrigger";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { foldSearchQuery, scoreThreadSearch } from "@t3tools/shared/paletteSearch";
import { insertRankedSearchResult, normalizeSearchQuery, scoreQueryMatch } from "@t3tools/shared/searchRanking";
import * as DateTime from "effect/DateTime";

import { scoreProviderSkill, searchProviderSkills } from "../../vendor/t3code/apps/web/src/providerSkillSearch.ts";

export type { ComposerTrigger };

/**
 * A suggestion for the trigger under the cursor, as the web composer's menu offers: `/` for
 * commands, `$` for skills, `@` for files and threads. Choosing one swaps the trigger for
 * `replacement`; `/model` opens the model picker instead.
 */
export interface ComposerItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly replacement: string | null;
  /** A thread mention's record, sent with the message. */
  readonly record?: ThreadContextRecord;
  readonly action?: "model";
}

/** As the web's limits: five threads, eighty paths. */
const THREAD_LIMIT = 5;
export const PATH_SEARCH_LIMIT = 80;

/** The trigger the cursor sits in, or null. `/model` is a command here, as tui3 has no model-name search. */
export function composerTrigger(text: string, cursor: number): ComposerTrigger | null {
  const trigger = detectComposerTrigger(text, cursor);
  if (trigger?.kind === "slash-model") return { ...trigger, kind: "slash-command", query: "model" };
  return trigger;
}

/**
 * `/` suggestions: `/model`, then the provider's commands and skills. Providers only expand
 * commands at the start of a message, so elsewhere only skills show; `/compact` only when it is
 * the whole message, as the web shows it.
 */
export function slashItems(input: { readonly provider: ServerProvider | undefined; readonly cwd: string | null; readonly text: string; readonly trigger: ComposerTrigger }): ComposerItem[] {
  const { provider, trigger, text } = input;
  const atStart = text.slice(0, trigger.rangeStart).trim() === "";
  const alone = atStart && text.slice(trigger.rangeEnd).trim() === "";
  const skills = provider ? getProviderSkillsForSlashMenu(resolveProviderSkillsForCwd(provider, input.cwd), true) : [];
  const commands = provider ? getProviderSlashCommandsForSlashMenu(resolveProviderSlashCommandsForCwd(provider, input.cwd), skills) : [];
  const candidates: SlashCandidate[] = [
    { item: { id: "slash:model", label: "/model", description: "Switch response model for this thread", replacement: null, action: "model" }, name: "model", tier: 0 },
    ...(atStart ? commands : [])
      .filter((command) => command.name !== "compact" || alone)
      .map((command) => ({
        item: { id: `command:${command.name}`, label: `/${command.name}`, description: command.description ?? command.input?.hint ?? "Run provider command", replacement: `/${command.name} ` },
        name: command.name,
        tier: 1,
      })),
    ...skills.map((skill) => ({
      item: { id: `skill:${skill.name}`, label: `/skill:${skill.name}`, description: skillDescription(skill, ""), replacement: `$${skill.name} ` },
      name: skill.name,
      tier: 2,
      skill,
    })),
  ];
  return searchSlash(candidates, trigger.query);
}

/** `$` suggestions: the provider's skills, ranked as the web ranks them. */
export function skillItems(provider: ServerProvider | undefined, cwd: string | null, query: string): ComposerItem[] {
  if (!provider) return [];
  return searchProviderSkills(resolveProviderSkillsForCwd(provider, cwd), query).map((skill) => ({
    id: `skill:${skill.name}`,
    label: formatProviderSkillDisplayName(skill),
    description: skillDescription(skill, "Run provider skill"),
    replacement: `$${skill.name} `,
  }));
}

/** `@` thread suggestions: other top-level threads, ranked like the palette. Needs a query, as the web does. */
export function threadItems(input: { readonly snapshot: OrchestrationV2ShellSnapshot | null; readonly environmentId: EnvironmentId | null; readonly excludeThreadId: ThreadId | null; readonly query: string; readonly now?: number }): ComposerItem[] {
  const query = foldSearchQuery(input.query);
  const { snapshot, environmentId } = input;
  if (!query || !snapshot || !environmentId) return [];
  const now = input.now ?? Date.now();
  const projects = new Map(snapshot.projects.map((project) => [project.id, project.title]));
  return snapshot.threads
    .filter((thread) => thread.id !== input.excludeThreadId && thread.archivedAt === null && thread.deletedAt === null && thread.lineage.relationshipToParent !== "subagent")
    .map((thread) => ({
      thread,
      match: scoreThreadSearch(
        query,
        {
          id: thread.id,
          title: thread.title,
          branch: thread.branch,
          projectTitle: projects.get(thread.projectId) ?? null,
          pullRequests: (thread.pullRequests ?? []).map((pr) => ({ number: pr.number, title: pr.snapshot?.title ?? null, references: [pr.url] })),
          activityAt: DateTime.toEpochMillis(thread.latestUserMessageAt ?? thread.updatedAt),
          opens: thread.opens ?? null,
        },
        now,
        { picks: false },
      ),
    }))
    .filter((candidate) => candidate.match !== null)
    .sort((a, b) => b.match!.score - a.match!.score)
    .slice(0, THREAD_LIMIT)
    .map(({ thread }) => {
      const record = threadContextRecord({ environmentId, threadId: thread.id }, thread.title || "New thread");
      return { id: `thread:${thread.id}`, label: thread.title || "New thread", description: "Thread", replacement: `${formatComposerContextReference(record)} `, record };
    });
}

/** `@` path suggestions from the server's search, inserted as the web inserts them: a markdown link. */
export function pathItems(entries: readonly ProjectEntry[]): ComposerItem[] {
  return entries.map((entry) => {
    const slash = entry.path.lastIndexOf("/");
    return {
      id: `path:${entry.kind}:${entry.path}`,
      label: `${entry.path.slice(slash + 1)}${entry.kind === "directory" ? "/" : ""}`,
      description: slash > 0 ? entry.path.slice(0, slash) : "",
      replacement: `${serializeComposerFileLink(entry.path)} `,
    };
  });
}

/** The text with the trigger replaced; a trailing space swallows one already there, as the web does. */
export function applyComposerItem(text: string, trigger: ComposerTrigger, replacement: string): { text: string; cursor: number } {
  const end = replacement.endsWith(" ") && text[trigger.rangeEnd] === " " ? trigger.rangeEnd + 1 : trigger.rangeEnd;
  return replaceTextRange(text, trigger.rangeStart, end, replacement);
}

/** The records for the thread mentions still in the text, as the message's context. */
export function messageContext(text: string, records: ReadonlyMap<string, ThreadContextRecord>): OrchestrationMessageContext | undefined {
  const referenced = new Set(collectComposerContextReferences(text).map((occurrence) => occurrence.contextId as string));
  const kept = [...records.values()].filter((record) => referenced.has(record.contextId));
  return kept.length > 0 ? { version: 1, records: kept } : undefined;
}

function skillDescription(skill: ServerProviderSkill, fallback: string): string {
  return skill.shortDescription ?? skill.description ?? (skill.scope ? `${skill.scope} skill` : fallback);
}

interface SlashCandidate {
  readonly item: ComposerItem;
  readonly name: string;
  readonly tier: number;
  readonly skill?: ServerProviderSkill;
}

/** The web's slash ranking (composerSlashCommandSearch): name first, then description; `skill:` narrows to skills. */
function searchSlash(candidates: readonly SlashCandidate[], rawQuery: string): ComposerItem[] {
  const query = normalizeSearchQuery(rawQuery, { trimLeadingPattern: /^\/+/ });
  if (!query) return candidates.map((candidate) => candidate.item);
  const ranked: { item: ComposerItem; score: number; tieBreaker: string }[] = [];
  for (const candidate of candidates) {
    const score = scoreSlash(candidate, query);
    if (score === null) continue;
    insertRankedSearchResult(ranked, { item: candidate.item, score, tieBreaker: `${candidate.tier}\u0000${candidate.name}` }, Number.POSITIVE_INFINITY);
  }
  return ranked.map((entry) => entry.item);
}

function scoreSlash(candidate: SlashCandidate, query: string): number | null {
  if (candidate.skill) {
    if (query === "skill") return 0;
    const skillQuery = query.startsWith("skill:") ? query.slice("skill:".length) : query;
    const skillScore = skillQuery ? scoreProviderSkill(candidate.skill, skillQuery) : 0;
    if (skillScore !== null) return skillScore;
    return "skill".startsWith(query) ? Number.MAX_SAFE_INTEGER : null;
  }
  const scores = [
    scoreQueryMatch({ value: candidate.name.toLowerCase(), query, exactBase: 0, prefixBase: 2, boundaryBase: 4, includesBase: 6, fuzzyBase: 100, boundaryMarkers: ["-", "_", "/"] }),
    scoreQueryMatch({ value: candidate.item.description.toLowerCase(), query, exactBase: 20, prefixBase: 22, boundaryBase: 24, includesBase: 26 }),
  ].filter((score): score is number => score !== null);
  return scores.length > 0 ? Math.min(...scores) : null;
}

/**
 * The textarea's cursor is in display columns (a wide character counts two); these convert
 * between it and string indices.
 */
export function indexAtCursor(text: string, row: number, col: number): number {
  const lines = text.split("\n");
  let index = 0;
  for (let line = 0; line < row && line < lines.length; line++) index += lines[line]!.length + 1;
  let width = 0;
  for (const { segment } of graphemes.segment(lines[row] ?? "")) {
    if (width >= col) break;
    width += Bun.stringWidth(segment);
    index += segment.length;
  }
  return index;
}

export function cursorAtIndex(text: string, index: number): { row: number; col: number } {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  return { row: lines.length - 1, col: Bun.stringWidth(lines[lines.length - 1] ?? "") };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
