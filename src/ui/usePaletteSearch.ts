import { useEffect, useState } from "react";
import type { OrchestrationV2SearchThreadsResult, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import type { T3Session } from "../client/session.ts";
import { threadSearchQuery } from "../model/search.ts";
import { messageSearchTokens } from "@t3tools/shared/paletteSearch";

/** The web palette waits 120ms, and ignores results from queries already replaced. */
export function usePaletteSearch(session: T3Session, snapshot: OrchestrationV2ShellSnapshot | null, query: string, open: boolean) {
  const normalized = open ? threadSearchQuery(query, snapshot?.olderSettled != null) : null;
  const before = snapshot?.olderSettled?.before;
  const [result, setResult] = useState<{ query: string; value: OrchestrationV2SearchThreadsResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!normalized) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      // Beyond the live shelf a query with no searchable words can only match titles.
      const titlesOnly = before ? messageSearchTokens(normalized).long.length === 0 : false;
      const search = {
        query: normalized,
        ...(before ? { olderSettledBefore: before, ...(titlesOnly ? { titlesOnly: true } : {}) } : {}),
      };
      session.searchThreads(search).then(
        (value) => {
          if (!cancelled) setResult({ query: normalized, value });
        },
        (searchError) => {
          if (!cancelled) setError(`Could not search messages: ${String(searchError)}`);
        },
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, normalized, before]);

  const fresh = normalized !== null && result?.query === normalized;
  return {
    result: fresh ? result.value : null,
    pending: normalized !== null && result?.query !== normalized && !error,
    error,
  };
}
