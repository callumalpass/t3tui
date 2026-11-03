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

/**
 * Shortens a path to `width` from the middle, keeping its first folder and its file name:
 * `src/…/TerminalPane.tsx`. A name too long even for that keeps its end.
 */
export function truncatePath(path: string, width: number): string {
  if (path.length <= width) return path;
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  const head = parts[0] ? `${parts[0]}/…/` : "…/";
  if (parts.length > 1 && head.length + name.length <= width) return `${head}${name}`;
  return `…${name.slice(Math.max(0, name.length - width + 1))}`;
}

/** Clips text to `width`, keeping a number at its end: `Term… 2`. */
export function truncateNumbered(text: string, width: number): string {
  const number = /\s\d+$/.exec(text)?.[0] ?? "";
  return text.length <= width ? text : `${truncate(text.slice(0, text.length - number.length), Math.max(1, width - number.length))}${number}`;
}
