import type { KeyEvent } from "@opentui/core";
import type { OrchestrationV2ArchivedShellSnapshot, OrchestrationV2OlderSettledCursor, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { ThreadId as ThreadIdSchema } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useEffect, useMemo, useState } from "react";
import type { T3Session } from "../client/session.ts";
import { mergeThreadShells, threadReorder } from "../model/search.ts";
import { threadRows } from "../model/threads.ts";
import type { PaletteCommand } from "../model/palette.ts";

type Command = PaletteCommand & { readonly run: () => void };

/** The sidebar's fetched shelves live separately from its live shell. */
export function useThreadLibrary(session: T3Session, snapshot: OrchestrationV2ShellSnapshot | null, query: string) {
  const [archived, setArchived] = useState(false);
  const [archive, setArchive] = useState<OrchestrationV2ArchivedShellSnapshot | null>(null);
  const [older, setOlder] = useState<readonly OrchestrationV2ThreadShell[]>([]);
  const [cursor, setCursor] = useState<OrchestrationV2OlderSettledCursor | null>(null);
  const [end, setEnd] = useState(false);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cut = snapshot?.olderSettled?.before;
  useEffect(() => {
    setOlder([]);
    setCursor(null);
    setEnd(false);
    setLimit(30);
  }, [cut]);
  const refreshArchive = () => session.archivedThreads().then(setArchive);
  useEffect(() => {
    if (!archived) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    session.archivedThreads().then(
      (value) => { if (!cancelled) { setArchive(value); setLoading(false); } },
      (error) => { if (!cancelled) { setError(String(error)); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [session, archived]);
  const merged = useMemo(() => mergeThreadShells(snapshot, older), [snapshot, older]);
  const listSnapshot = archived && snapshot ? { ...snapshot, projects: archive?.projects ?? snapshot.projects, threads: archive?.threads ?? [] } : merged;
  const allRows = useMemo(() => threadRows(listSnapshot, { query, archived, settledLimit: limit }), [listSnapshot, query, archived, limit]);
  const totalSettled = useMemo(() => threadRows(merged, { query, settledLimit: Infinity }).filter((row) => row.section === "settled").length, [merged, query]);
  const hasOlder = !archived && (totalSettled > limit || (!end && (snapshot?.olderSettled?.counts.some((count) => count.count > 0) ?? false)));
  const loadOlder = async () => {
    if (loading) return;
    setLimit((value) => value + 30);
    if (!cut || end || totalSettled > limit) return;
    setLoading(true);
    setError(null);
    try {
      const page = await session.olderSettledThreads({ before: cursor ?? { settledAt: cut }, limit: 30 });
      setOlder((previous) => [...previous, ...page.threads]);
      const last = page.threads.at(-1);
      if (last?.settledAt) setCursor({ settledAt: DateTime.formatIso(last.settledAt), threadId: last.id });
      setEnd(page.threads.length < 30);
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  };
  const toggle = () => { setError(null); setArchived((value) => !value); };
  const unarchive = async (id: ThreadId) => {
    await session.unarchiveThread(id);
    await refreshArchive();
  };
  const reorder = async (id: ThreadId, delta: 1 | -1) => {
    const row = allRows.find((row) => row.thread.id === id);
    // The web's Working shelf makes Active chronological, not manually reorderable.
    if (row?.section === "active") { setError("Active threads are ordered by return time, as in T3 Code's Working shelf."); return; }
    const plan = threadReorder(allRows, id, delta, threadRows(listSnapshot, { archived, settledLimit: limit }));
    if (!plan || archived) return;
    try {
      for (const assignment of plan.assignments) await session.reorderThread(ThreadIdSchema.make(assignment.id), plan.section, assignment.orderKey);
    } catch (error) { setError(String(error)); }
  };
  const commands = (id: ThreadId | undefined): Command[] => [
    { id: "archived", title: archived ? "Show active threads" : "Show archived threads", shortcut: "A", keywords: ["archive", "history", "restore"], run: toggle },
    ...(hasOlder ? [{ id: "older-settled", title: "Show more settled threads", keywords: ["older", "history", "load"], run: () => void loadOlder() }] : []),
    ...(id && archive?.threads.some((thread) => thread.id === id) ? [{ id: "unarchive", title: "Unarchive thread", keywords: ["restore", "archived"], run: () => void unarchive(id).catch((error) => setError(String(error))) }] : []),
    ...(id && allRows.some((row) => row.thread.id === id && row.section === "pinned") ? [
      { id: "reorder-up", title: "Move pinned thread up", shortcut: "K", keywords: ["reorder", "sort"], run: () => void reorder(id, -1) },
      { id: "reorder-down", title: "Move pinned thread down", shortcut: "J", keywords: ["reorder", "sort"], run: () => void reorder(id, 1) },
    ] : []),
  ];
  const key = (key: KeyEvent, id: ThreadId | undefined): boolean => {
    if (key.name === "a" && key.shift) return toggle(), true;
    if (id && key.shift && (key.name === "j" || key.name === "k")) return void reorder(id, key.name === "j" ? 1 : -1), true;
    return false;
  };
  return { archived, allRows, merged, archive, commands, key, hasOlder, loadOlder, loading, error };
}
