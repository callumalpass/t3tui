import type { TextareaRenderable } from "@opentui/core";
import type { ComposerContextRecord, EnvironmentId, OrchestrationMessageContext, OrchestrationV2ShellSnapshot, ProjectEntry, ProjectId, ServerProvider, ThreadId, ThreadPullRequestLink } from "@t3tools/contracts";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { T3Session } from "../client/session.ts";
import { composerItemEnd, composerTrigger, cursorAtIndex, indexAtCursor, messageContext, PATH_SEARCH_LIMIT, pathItems, skillItems, slashItems, threadItems, type ComposerItem } from "../model/composerMenu.ts";
import { keys, type Binding } from "../model/keymap.ts";
import { markChip } from "./useComposerChips.ts";
import { useComposerPullRequests } from "./usePullRequests.ts";

/**
 * The web composer's / $ @ # menu: suggestions for the trigger under the cursor, and the
 * mentions chosen from it, which go with the message as its context.
 */
export function useComposerMenu(deps: {
  readonly session: T3Session;
  readonly composerRef: RefObject<TextareaRenderable | null>;
  /** Which composer: a thread's, or the draft's. Each keeps its own mentions. */
  readonly composerKey: string;
  /** The composer has the keys. */
  readonly active: boolean;
  readonly cwd: string | null;
  readonly provider: ServerProvider | undefined;
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  readonly environmentId: EnvironmentId | null;
  /** The open thread, left out of @ thread suggestions. */
  readonly threadId: ThreadId | null;
  readonly now: number;
  readonly pullRequests: { readonly projectId: ProjectId | null; readonly repository: string | null; readonly links: readonly ThreadPullRequestLink[] | undefined };
  /** After a choice has gone into the composer. */
  readonly onChosen: (item: ComposerItem) => void;
}) {
  const { session, composerRef, composerKey, cwd, provider } = deps;
  /** The composer's text and cursor (a string index). */
  const [state, setState] = useState({ text: "", cursor: 0 });
  const [index, setIndex] = useState(0);
  /** The trigger esc closed the menu for; typing on reopens it. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pathResults, setPathResults] = useState<{ key: string; entries: readonly ProjectEntry[] } | null>(null);
  const mentions = useRef(new Map<string, Map<string, ComposerContextRecord>>());

  const trigger = deps.active ? composerTrigger(state.text, state.cursor) : null;
  const triggerKey = trigger ? `${composerKey}:${trigger.kind}:${trigger.rangeStart}:${trigger.query}` : null;
  const pathKey = trigger?.kind === "path" && trigger.query.trim() && cwd ? `${cwd}\u0000${trigger.query.trim()}` : null;
  useEffect(() => {
    if (!pathKey) return;
    const [at, query] = pathKey.split("\u0000") as [string, string];
    // Debounced as the web's path search is.
    const timer = setTimeout(() => {
      session.searchEntries(at, query, PATH_SEARCH_LIMIT).then(
        (entries) => setPathResults({ key: pathKey, entries }),
        () => setPathResults({ key: pathKey, entries: [] }),
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [session, pathKey]);
  const pullRequests = useComposerPullRequests({ session, query: trigger?.kind === "pull-request" ? trigger.query : null, ...deps.pullRequests });

  const menu = ((): { items: ComposerItem[]; empty: string; loading: boolean } | null => {
    if (!trigger || triggerKey === dismissed) return null;
    switch (trigger.kind) {
      case "slash-command":
      case "slash-model":
        return { items: slashItems({ provider, cwd, text: state.text, trigger }), empty: "No matching command.", loading: false };
      case "skill":
        return { items: skillItems(provider, cwd, trigger.query), empty: "No skills found. Try / to browse provider commands.", loading: false };
      case "path": {
        if (!trigger.query.trim()) return { items: [], empty: "Type to search files, folders and threads.", loading: false };
        const threads = threadItems({ snapshot: deps.snapshot, environmentId: deps.environmentId, excludeThreadId: deps.threadId, query: trigger.query, now: deps.now });
        const fresh = pathResults?.key === pathKey;
        return { items: [...threads, ...(fresh ? pathItems(pathResults.entries) : [])], empty: fresh ? "No matching files or folders." : "Searching…", loading: !fresh };
      }
      case "pull-request":
        return pullRequests;
      default:
        return null;
    }
  })();
  const selected = menu ? Math.min(index, Math.max(0, menu.items.length - 1)) : 0;
  useEffect(() => setIndex(0), [triggerKey]);

  /** Reads the composer's text and cursor; its change and cursor events call this. */
  const sync = () => {
    const composer = composerRef.current;
    if (!composer) return;
    const text = composer.plainText;
    const { row, col } = composer.logicalCursor;
    setState({ text, cursor: indexAtCursor(text, row, col) });
  };
  // A different composer (another thread, or the draft) mounts with its own text.
  useEffect(() => {
    const timer = setTimeout(sync, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync reads the ref.
  }, [composerKey]);

  const choose = (item: ComposerItem | undefined) => {
    const composer = composerRef.current;
    if (!item || !trigger || !composer) return;
    // An edit in place rather than new text, which would take the chips already there with it.
    const replacement = item.replacement ?? "";
    const from = cursorAtIndex(state.text, trigger.rangeStart);
    const to = cursorAtIndex(state.text, composerItemEnd(state.text, trigger, replacement));
    composer.deleteRange(from.row, from.col, to.row, to.col);
    composer.setCursor(from.row, from.col);
    const sent = replacement.trimEnd();
    const start = composer.cursorOffset;
    composer.insertText(item.chip ?? sent);
    if (item.chip) markChip(composer, start, composer.cursorOffset, { sent });
    composer.insertText(replacement.slice(sent.length));
    if (item.record) {
      const records = mentions.current.get(composerKey) ?? new Map<string, ComposerContextRecord>();
      records.set(item.record.contextId, item.record);
      mentions.current.set(composerKey, records);
    }
    sync();
    deps.onChosen(item);
  };

  /** The mentions still in this text, as the message's context. */
  const context = (text: string): OrchestrationMessageContext | undefined => messageContext(text, mentions.current.get(composerKey) ?? new Map());
  /** The message went: its mentions go with it. */
  const forget = () => mentions.current.delete(composerKey);
  /** A message that didn't send came back to its composer: so do its mentions. */
  const remember = (key: string, restored: OrchestrationMessageContext | undefined) => {
    if (!restored) return;
    const records = mentions.current.get(key) ?? new Map<string, ComposerContextRecord>();
    for (const record of restored.records) records.set(record.contextId, record);
    mentions.current.set(key, records);
  };

  const bindings: Binding[] = menu
    ? keys(
        { keys: [], label: "↑/↓", hint: "move" },
        menu.items.length > 0 && [
          { keys: ["↓", "ctrl+n"], run: () => setIndex(Math.min(menu.items.length - 1, selected + 1)) },
          { keys: ["↑", "ctrl+p"], run: () => setIndex(Math.max(0, selected - 1)) },
        ],
        // Enter waits for a search in flight rather than sending the half-typed mention.
        menu.loading && { keys: ["enter"], run: () => {} },
        menu.items.length > 0 ? { keys: ["tab", "enter"], label: "tab or enter", hint: "choose", run: () => choose(menu.items[selected]) } : { keys: [], label: "tab or enter", hint: "choose" },
        { keys: ["esc"], run: () => setDismissed(triggerKey), hint: "close" },
      )
    : [];

  return { menu, selected, sync, pick: (at: number) => menu && choose(menu.items[at]), context, forget, remember, bindings };
}
