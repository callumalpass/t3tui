/** A key a hint names, as the keyboard handler receives it. */
export interface HintKey {
  readonly name: string;
  readonly sequence: string;
  readonly shift: boolean;
  readonly ctrl: boolean;
}

const NAMED: Record<string, string> = { esc: "escape", enter: "return", tab: "tab" };

/**
 * The key at the start of a hint like "y approve" or "ctrl+k commands", so a click on the hint
 * can press it. Hints that name a choice of keys ("j/k move", "1-9 pick") or a chord that
 * sends a message ("alt+enter steer") aren't clickable.
 */
export function hintKey(hint: string, mode: string): HintKey | null {
  const token = hint.trim().split(/\s+/)[0] ?? "";
  if (hint.includes(" or ") || /^\d-\d$/.test(token)) return null;
  if (token.length > 1 && token.includes("/")) return null;
  const ctrl = token.startsWith("ctrl+");
  const key = ctrl ? token.slice(5) : token;
  if (key.includes("+") || key.includes("↑") || key.includes("↓")) return null;
  // In the composer, enter is the composer's own: it sends, and a click shouldn't.
  if (key === "enter" && (mode === "input" || ctrl)) return null;
  const named = NAMED[key];
  if (named) return { name: named, sequence: named === "return" ? "\r" : named === "tab" ? "\t" : "\x1b", shift: false, ctrl };
  if ([...key].length !== 1) return null;
  const lower = key.toLowerCase();
  const shift = lower !== key;
  return { name: lower, sequence: ctrl ? String.fromCharCode(lower.charCodeAt(0) & 0x1f) : key, shift, ctrl };
}
