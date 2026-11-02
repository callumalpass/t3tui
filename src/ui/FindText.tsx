import { findThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import type { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { useEffect, useRef, type RefObject, type ReactNode } from "react";
import { colors } from "./theme.ts";

/** Searchable rendered text, with the web's literal case-insensitive occurrence matching. */
export function FindText(props: { readonly segments: readonly string[]; readonly query: string; readonly activeOccurrence: number | null; readonly scrollRef: RefObject<ScrollBoxRenderable | null> }) {
  const activeText = useRef<{ node: TextRenderable; text: string; offset: number } | null>(null);
  useEffect(() => {
    if (props.activeOccurrence === null) return;
    const timer = setTimeout(() => {
      const active = activeText.current;
      const scroll = props.scrollRef.current;
      if (!active || !scroll) return;
      const before = active.text.slice(0, active.offset).split("\n");
      const source = before.length - 1;
      const column = Bun.stringWidth(before.at(-1) ?? "");
      const info = active.node.lineInfo;
      let line = 0;
      info.lineSources.forEach((value, index) => { if (value === source && info.lineStartCols[index]! <= column) line = index; });
      scroll.scrollBy(active.node.y + line - scroll.viewport.y - Math.floor(scroll.viewport.height / 2));
    }, 0);
    return () => clearTimeout(timer);
  }, [props.activeOccurrence, props.query, props.segments, props.scrollRef]);
  let occurrence = 0;
  return <box flexDirection="column" marginTop={1}>{props.segments.map((segment, index) => {
    let cursor = 0;
    const parts: ReactNode[] = [];
    let activeOffset: number | null = null;
    for (const offset of findThreadSearchOccurrences(segment, props.query)) {
      const active = occurrence++ === props.activeOccurrence;
      if (active) activeOffset = offset;
      parts.push(segment.slice(cursor, offset));
      parts.push(<span key={offset} bg={active ? colors.accent : colors.selectedBg} fg={active ? colors.bg : colors.text}>{segment.slice(offset, offset + props.query.length)}</span>);
      cursor = offset + props.query.length;
    }
    parts.push(segment.slice(cursor));
    return <text key={index} fg={colors.text} ref={(node) => { if (node && activeOffset !== null) activeText.current = { node, text: segment, offset: activeOffset }; }}>{parts}</text>;
  })}</box>;
}
