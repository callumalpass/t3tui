/** Characters a file path on screen is made of, with an optional `:line` or `:line:col` after it. */
const PATH_CHARS = /[\w.~/@+-]/;

/** On Windows, backslashes too. */
const WINDOWS_PATH_CHARS = /[\w.~/\\@+-]/;

/**
 * The file path the text has at `index`, as an agent writes them: `src/ui/App.tsx`,
 * `./bin.ts:12`, `~/notes.md`, and on Windows `src\ui\App.tsx` and `C:\notes.md`. Null for
 * words, URLs and anything else without a folder or an extension.
 */
export function pathAt(text: string, index: number, platform: string = process.platform): string | null {
  const windows = platform === "win32";
  const chars = windows ? WINDOWS_PATH_CHARS : PATH_CHARS;
  if (!chars.test(text[index] ?? "")) return null;
  let start = index;
  let end = index + 1;
  while (start > 0 && chars.test(text[start - 1]!)) start--;
  while (end < text.length && (chars.test(text[end]!) || (text[end] === ":" && /\d/.test(text[end + 1] ?? "")))) end++;
  // The drive's colon, which is no line number: `C:\notes.md`.
  if (windows && text[start - 1] === ":" && /(?:^|[^\w])[A-Za-z]$/.test(text.slice(Math.max(0, start - 3), start - 1)) && /[\\/]/.test(text[start] ?? "")) start -= 2;
  if (text[start - 1] === ":" || text.slice(end, end + 3) === "://") return null;
  const token = text.slice(start, end).replace(/[.,]+$/, "");
  const path = token.replace(/(:\d+){1,2}$/, "");
  if (!/[\w~]/.test(path[0] ?? "") && !path.startsWith("./") && !path.startsWith("../") && !path.startsWith("/") && !(windows && /^\.{0,2}\\/.test(path))) return null;
  return path.includes("/") || (windows && path.includes("\\")) || /\.[A-Za-z]\w*$/.test(path) ? path : null;
}

/** The command that opens a web link in the desktop's browser. Windows' goes round cmd, which would split a URL at its `&`. */
export function browserCommand(url: string, platform: string = process.platform): string[] {
  if (platform === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
  return [platform === "darwin" ? "open" : "xdg-open", url];
}

/** A link's target is a web page unless it is a bare path. */
export function isWebUrl(url: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(url) && !url.toLowerCase().startsWith("file:");
}
