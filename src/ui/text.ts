/** Collapses text to one line and clips it to `width`, so a label never wraps its row. */
export function truncate(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ");
  if (single.length <= width) return single;
  return `${single.slice(0, Math.max(0, width - 1))}…`;
}

/** Takes the first line only, so multi-line text can stand in for a short label. */
export function firstLine(text: string): string {
  const line = (text.trim().split("\n")[0] ?? "").replace(/\s+/g, " ");
  if (line.length <= 100) return line;
  return `${line.slice(0, 99)}…`;
}
