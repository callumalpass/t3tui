import { useCallback, useRef } from "react";

/** A callback that keeps one identity across renders but always runs the latest closure, for memoized rows. */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
