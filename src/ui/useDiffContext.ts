import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { T3Session } from "../client/session.ts";
import { splitPatch, wholeFilePatch } from "../model/diffs.ts";
import type { DiffState } from "./DiffView.tsx";

/** Full-file expansion is loaded only on request and belongs to this diff selection. */
export function useDiffContext(session: T3Session, diff: DiffState | null, scrollRef: RefObject<ScrollBoxRenderable | null>) {
  const current = useRef(diff);
  current.current = diff;
  const files = useMemo(() => splitPatch(diff?.patch ?? ""), [diff?.patch]);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, { patch?: string; error?: string }>>({});
  useEffect(() => { setSelected(0); setExpanded({}); }, [diff]);
  const expand = () => {
    const file = files[selected];
    if (!file || !diff?.source) return;
    if (expanded[file.path]?.patch) {
      setExpanded((old) => { const next = { ...old }; delete next[file.path]; return next; });
      return;
    }
    if (expanded[file.path] && !expanded[file.path]?.error) return;
    const selection = diff;
    setExpanded((old) => ({ ...old, [file.path]: {} }));
    session.diffFileContents({ ...diff.source, changeType: file.changeType, oldPath: file.oldPath, newPath: file.path }).then(
      (contents) => current.current === selection && setExpanded((old) => ({ ...old, [file.path]: { patch: wholeFilePatch(file, contents) } })),
      (error) => current.current === selection && setExpanded((old) => ({ ...old, [file.path]: { error: error instanceof Error ? error.message : String(error) } })),
    );
  };
  const move = (direction: -1 | 1) => {
    const next = Math.max(0, Math.min(files.length - 1, selected + direction));
    setSelected(next);
    scrollRef.current?.scrollChildIntoView(`diff-file-${next}`);
  };
  const onKey = (key: KeyEvent): boolean => {
    if (!diff) return false;
    if (key.name === "[" || key.name === "]") {
      move(key.name === "[" ? -1 : 1);
      return true;
    }
    if (key.name === "x" || key.name === "return") { expand(); return true; }
    return false;
  };
  return { selected, expanded, onKey, move, expand };
}
