import type { UsageSummary } from "@t3tools/contracts";
import { makeWindow } from "@t3tools/shared/usageFormat";
import { useEffect, useRef, useState } from "react";

import type { T3Session } from "../client/session.ts";

/** As the web usage query's stale time: a scan is slow, so keep a fresh-enough answer. */
const STALE_MS = 60_000;

/**
 * The last 30 days' usage summary (the web page's default window), fetched while
 * `active` — settings open — and refetched once it goes stale.
 */
export function useUsageSummary(session: T3Session, active: boolean): { readonly summary: UsageSummary | null; readonly failed: boolean } {
  const [state, setState] = useState<{ summary: UsageSummary | null; failed: boolean }>({ summary: null, failed: false });
  const fetchedAt = useRef(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fetchOnce = () => {
      if (Date.now() - fetchedAt.current < STALE_MS) return;
      fetchedAt.current = Date.now();
      session.usageSummary(makeWindow(30)).then(
        (summary) => {
          if (!cancelled) setState({ summary, failed: false });
        },
        () => {
          fetchedAt.current = 0;
          if (!cancelled) setState((previous) => ({ summary: previous.summary, failed: true }));
        },
      );
    };
    fetchOnce();
    const timer = setInterval(fetchOnce, STALE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, active]);
  return state;
}
