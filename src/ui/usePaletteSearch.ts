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
      session.searchThreads({ query: normalized, ...(before ? { olderSettledBefore: before, ...(messageSearchTokens(normalized).long.length ? {} : { titlesOnly: true }) } : {}) }).then(
        (value) => { if (!cancelled) setResult({ query: normalized, value }); },
        (error) => { if (!cancelled) setError(`Could not search messages: ${String(error)}`); },
      );
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, normalized, before]);
  return { result: normalized && result?.query === normalized ? result.value : null, pending: normalized !== null && result?.query !== normalized && !error, error };
}
