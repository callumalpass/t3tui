import type { KeyEvent } from "@opentui/core";
import type { OrchestrationV2SearchThreadResult, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import type { T3Session, ThreadState } from "../client/session.ts";
import type { Timeline } from "../model/timeline.ts";
import { stepThreadFindIndex } from "../../vendor/t3code/apps/web/src/components/chat/threadFind.ts";

/** Find counts the entire thread on the server, paging history only until its selected entry appears. */
export function useThreadFind(session: T3Session, id: ThreadId | undefined, thread: ThreadState | null, timeline: Timeline | null, open: boolean) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<{ key: string; value: OrchestrationV2SearchThreadResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalized = query.trim().slice(0, 200).trim();
  const key = open && id && normalized ? JSON.stringify([id, normalized, index]) : null;
  // A new tail entry can hold a new match, so it re-runs the search below.
  const latestText = thread?.projection?.visibleTurnItems.at(-1);

  useEffect(() => {
    setQuery("");
    setIndex(0);
  }, [id]);

  useEffect(() => {
    setError(null);
    if (!key || !id) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      session.searchThread({ threadId: id, query: normalized, index }).then(
        (value) => {
          if (!cancelled) setResult({ key, value });
        },
        (searchError) => {
          if (!cancelled) setError(String(searchError));
        },
      );
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, id, key, latestText]);

  const data = key && result?.key === key ? result.value : null;
  const match = data?.match ?? null;

  // Page in older history until the selected match is on screen, once per cursor.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !match || !timeline) return;
    if (timeline.rows.some((row) => row.id === match.entryId)) return;
    const history = thread?.history;
    if (!history?.hasMore || history.loading || history.error) return;
    const request = `${key}:${history.cursor}`;
    if (requested.current === request) return;
    requested.current = request;
    session.loadEarlier(id).catch((loadError) => setError(String(loadError)));
  }, [session, id, match, timeline, thread?.history, key]);

  const step = (delta: number) => {
    if (data) setIndex(stepThreadFindIndex(data.activeIndex, data.totalMatches, delta));
  };

  const handleKey = (keyEvent: KeyEvent): boolean => {
    if (!open) return false;
    if (keyEvent.name === "escape") return true;
    if (keyEvent.name === "return") step(keyEvent.shift ? -1 : 1);
    else if (keyEvent.ctrl && keyEvent.name === "n") step(1);
    else if (keyEvent.ctrl && keyEvent.name === "p") step(-1);
    else return false;
    return true;
  };

  const onQuery = (value: string) => {
    setQuery(value);
    setIndex(0);
  };

  return {
    open,
    query,
    onQuery,
    data,
    match,
    error,
    pending: key !== null && data === null && !error,
    step,
    handleKey,
  };
}
