/** Characters a file path on screen is made of, with an optional `:line` or `:line:col` after it. */
const PATH_CHARS = /[\w.~/@+-]/;

/**
 * The file path the text has at `index`, as an agent writes them: `src/ui/App.tsx`,
 * `./bin.ts:12`, `~/notes.md`. Null for words, URLs and anything else without a folder
 * or an extension.
 */
export function pathAt(text: string, index: number): string | null {
  if (!PATH_CHARS.test(text[index] ?? "")) return null;
  let start = index;
  let end = index + 1;
  while (start > 0 && PATH_CHARS.test(text[start - 1]!)) start--;
  while (end < text.length && (PATH_CHARS.test(text[end]!) || (text[end] === ":" && /\d/.test(text[end + 1] ?? "")))) end++;
  if (text[start - 1] === ":" || text.slice(end, end + 3) === "://") return null;
  const token = text.slice(start, end).replace(/[.,]+$/, "");
  const path = token.replace(/(:\d+){1,2}$/, "");
  if (!/[\w~]/.test(path[0] ?? "") && !path.startsWith("./") && !path.startsWith("../") && !path.startsWith("/")) return null;
  return path.includes("/") || /\.[A-Za-z]\w*$/.test(path) ? path : null;
}

/** A link's target is a web page unless it is a bare path. */
export function isWebUrl(url: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(url) && !url.toLowerCase().startsWith("file:");
}
