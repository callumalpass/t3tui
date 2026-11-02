import type { KeyEvent } from "@opentui/core";
import type {
  OrchestrationV2ArchivedShellSnapshot,
  OrchestrationV2OlderSettledCursor,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { ThreadId as ThreadIdSchema } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useEffect, useMemo, useState } from "react";
import type { T3Session } from "../client/session.ts";
import { mergeThreadShells, threadReorder } from "../model/search.ts";
import { threadRows } from "../model/threads.ts";
import type { PaletteCommand } from "../model/palette.ts";

type Command = PaletteCommand & { readonly run: () => void };

/** How many settled threads one "show more" step reveals, as the web's shelf pages. */
const SETTLED_PAGE_SIZE = 30;

/** The sidebar's fetched shelves live separately from its live shell. */
export function useThreadLibrary(session: T3Session, snapshot: OrchestrationV2ShellSnapshot | null, query: string) {
  const [archived, setArchived] = useState(false);
  const [archive, setArchive] = useState<OrchestrationV2ArchivedShellSnapshot | null>(null);
  const [older, setOlder] = useState<readonly OrchestrationV2ThreadShell[]>([]);
  const [cursor, setCursor] = useState<OrchestrationV2OlderSettledCursor | null>(null);
  const [end, setEnd] = useState(false);
  const [limit, setLimit] = useState(SETTLED_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new live cut-off makes every fetched older page stale, so paging starts over.
  const cut = snapshot?.olderSettled?.before;
  useEffect(() => {
    setOlder([]);
    setCursor(null);
    setEnd(false);
    setLimit(SETTLED_PAGE_SIZE);
  }, [cut]);

  const refreshArchive = () => session.archivedThreads().then(setArchive);

  useEffect(() => {
    if (!archived) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    session.archivedThreads().then(
      (value) => {
        if (cancelled) return;
        setArchive(value);
        setLoading(false);
      },
      (archiveError) => {
        if (cancelled) return;
        setError(String(archiveError));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session, archived]);

  const merged = useMemo(() => mergeThreadShells(snapshot, older), [snapshot, older]);

  // The archive keeps the live snapshot's shape so threadRows reads both the same way.
  const listSnapshot =
    archived && snapshot
      ? { ...snapshot, projects: archive?.projects ?? snapshot.projects, threads: archive?.threads ?? [] }
      : merged;

  const allRows = useMemo(
    () => threadRows(listSnapshot, { query, archived, settledLimit: limit }),
    [listSnapshot, query, archived, limit],
  );

  const totalSettled = useMemo(() => {
    const settled = threadRows(merged, { query, settledLimit: Infinity });
    return settled.filter((row) => row.section === "settled").length;
  }, [merged, query]);

  const serverHasOlder = snapshot?.olderSettled?.counts.some((count) => count.count > 0) ?? false;
  const hasOlder = !archived && (totalSettled > limit || (!end && serverHasOlder));

  const loadOlder = async () => {
    if (loading) return;
    setLimit((value) => value + SETTLED_PAGE_SIZE);
    // Rows already fetched fill the wider limit without another request.
    if (!cut || end || totalSettled > limit) return;
    setLoading(true);
    setError(null);
    try {
      const page = await session.olderSettledThreads({ before: cursor ?? { settledAt: cut }, limit: SETTLED_PAGE_SIZE });
      setOlder((previous) => [...previous, ...page.threads]);
      const last = page.threads.at(-1);
      if (last?.settledAt) {
        setCursor({ settledAt: DateTime.formatIso(last.settledAt), threadId: last.id });
      }
      setEnd(page.threads.length < SETTLED_PAGE_SIZE);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    setError(null);
    setArchived((value) => !value);
  };

  const unarchive = async (id: ThreadId) => {
    await session.unarchiveThread(id);
    await refreshArchive();
  };

  const reorder = async (id: ThreadId, delta: 1 | -1) => {
    const row = allRows.find((candidate) => candidate.thread.id === id);
    // The web's Working shelf makes Active chronological, not manually reorderable.
    if (row?.section === "active") {
      setError("Active threads are ordered by return time, as in T3 Code's Working shelf.");
      return;
    }
    const unfilteredRows = threadRows(listSnapshot, { archived, settledLimit: limit });
    const plan = threadReorder(allRows, id, delta, unfilteredRows);
    if (!plan || archived) return;
    try {
      for (const assignment of plan.assignments) {
        await session.reorderThread(ThreadIdSchema.make(assignment.id), plan.section, assignment.orderKey);
      }
    } catch (reorderError) {
      setError(String(reorderError));
    }
  };

  const commands = (id: ThreadId | undefined): Command[] => {
    const list: Command[] = [
      {
        id: "archived",
        title: archived ? "Show active threads" : "Show archived threads",
        shortcut: "A",
        keywords: ["archive", "history", "restore"],
        run: toggle,
      },
    ];
    if (hasOlder) {
      list.push({
        id: "older-settled",
        title: "Show more settled threads",
        keywords: ["older", "history", "load"],
        run: () => void loadOlder(),
      });
    }
    if (id && archive?.threads.some((thread) => thread.id === id)) {
      list.push({
        id: "unarchive",
        title: "Unarchive thread",
        keywords: ["restore", "archived"],
        run: () => void unarchive(id).catch((unarchiveError) => setError(String(unarchiveError))),
      });
    }
    if (id && allRows.some((row) => row.thread.id === id && row.section === "pinned")) {
      list.push(
        {
          id: "reorder-up",
          title: "Move pinned thread up",
          shortcut: "K",
          keywords: ["reorder", "sort"],
          run: () => void reorder(id, -1),
        },
        {
          id: "reorder-down",
          title: "Move pinned thread down",
          shortcut: "J",
          keywords: ["reorder", "sort"],
          run: () => void reorder(id, 1),
        },
      );
    }
    return list;
  };

  const key = (keyEvent: KeyEvent, id: ThreadId | undefined): boolean => {
    if (keyEvent.name === "a" && keyEvent.shift) {
      toggle();
      return true;
    }
    if (id && keyEvent.shift && (keyEvent.name === "j" || keyEvent.name === "k")) {
      void reorder(id, keyEvent.name === "j" ? 1 : -1);
      return true;
    }
    return false;
  };

  return { archived, allRows, merged, archive, commands, key, hasOlder, loadOlder, loading, error };
}
