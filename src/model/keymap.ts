import type { PaletteCommand } from "./palette.ts";

/**
 * One thing a key does, written once: the keys that do it, how the hint bar names it, and
 * how the palette lists it. Key handling, the hints, clicks on hints and the palette's
 * shortcuts all read the same binding, so they can't drift apart.
 *
 * Keys are written as people read them: "y", "Y" (shift+y), "ctrl+k", "alt+enter", "esc",
 * "enter", "↑", "[", "pagedown". The first key is the one shown.
 */
export interface Binding {
  readonly keys: readonly string[];
  /** Absent for a hint that only explains ("1-9 pick"): it isn't clickable and takes no key. */
  readonly run?: () => void;
  /** The hint bar shows `<key> <hint>`. */
  readonly hint?: string;
  /** The key as the hint and palette show it, when that isn't the first key ("j/k"). */
  readonly label?: string;
  /**
   * The key belongs to the focused input (enter in the composer sends), so the keymap leaves
   * it alone; the hint still shows, and a click on it still runs.
   */
  readonly passive?: boolean;
  /** Listed in the palette. */
  readonly command?: { readonly id: string; readonly title: string; readonly keywords?: readonly string[] };
}

/** The key event fields the keymap reads, as OpenTUI's KeyEvent has them. */
export interface KeyLike {
  readonly name: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly sequence?: string;
}

/** A hint in the bar: the key, what it does, and the action a click runs. */
export interface Hint {
  readonly key: string;
  readonly label: string;
  readonly run?: () => void;
}

const NAMES: Record<string, string> = { esc: "escape", enter: "return", "↑": "up", "↓": "down", "←": "left", "→": "right" };

interface Spec {
  readonly name: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  /** null: either. Shift only counts for letters and named keys; "?" and ":" come shifted anyway. */
  readonly shift: boolean | null;
}

const specs = new Map<string, Spec>();

function parse(key: string): Spec {
  const cached = specs.get(key);
  if (cached) return cached;
  const parts = key.length > 1 ? key.split("+") : [key];
  // "ctrl++" would split into empty parts; a lone "+" is the key itself.
  const last = parts.pop() || "+";
  const modifiers = new Set(parts);
  const letter = /^[a-z]$/i.test(last);
  const name = NAMES[last] ?? (letter ? last.toLowerCase() : last);
  const shifted = modifiers.has("shift") || (letter && last !== last.toLowerCase());
  const spec = { name, ctrl: modifiers.has("ctrl"), meta: modifiers.has("alt") || modifiers.has("meta"), shift: letter || name.length > 1 ? shifted : null };
  specs.set(key, spec);
  return spec;
}

/** Whether a key event is the key a binding names. */
export function keyMatches(key: string, event: KeyLike): boolean {
  const spec = parse(key);
  // Terminals send ctrl+j as a bare line feed.
  if (spec.name === "j" && spec.ctrl && !spec.meta && event.name === "linefeed") return true;
  if (event.ctrl !== spec.ctrl || event.meta !== spec.meta) return false;
  if (spec.shift !== null && event.shift !== spec.shift) return false;
  return event.name === spec.name || (spec.name.length === 1 && event.sequence === spec.name);
}

/** The first binding that takes this key. Order is precedence: put the more specific first. */
export function bindingFor(bindings: readonly Binding[], event: KeyLike): Binding | undefined {
  return bindings.find((binding) => binding.run && !binding.passive && binding.keys.some((key) => keyMatches(key, event)));
}

/** The key a binding shows. */
export function shownKey(binding: Binding): string | undefined {
  return binding.label ?? binding.keys[0];
}

/** The hint bar for these bindings, in their order. */
export function hintsFor(bindings: readonly Binding[]): Hint[] {
  return bindings.flatMap((binding) => (binding.hint === undefined ? [] : [{ key: shownKey(binding) ?? "", label: binding.hint, ...(binding.run ? { run: binding.run } : {}) }]));
}

/** The palette's commands among these bindings, with their keys as shortcuts. */
export function commandsFor(bindings: readonly Binding[]): (PaletteCommand & { readonly run: () => void })[] {
  const seen = new Set<string>();
  return bindings.flatMap((binding) => {
    const command = binding.command;
    if (!command || !binding.run || seen.has(command.id)) return [];
    seen.add(command.id);
    const shortcut = shownKey(binding);
    return [{ id: command.id, title: command.title, run: binding.run, ...(shortcut ? { shortcut } : {}), ...(command.keywords ? { keywords: command.keywords } : {}) }];
  });
}

/** A palette command with a key, as a binding: the key runs it too. */
export function fromCommand(command: PaletteCommand & { readonly run: () => void }, hint?: string): Binding {
  const { id, title, keywords, shortcut, run } = command;
  return { keys: shortcut ? [shortcut] : [], run, command: { id, title, ...(keywords ? { keywords } : {}) }, ...(hint ? { hint } : {}) };
}

/** A list of bindings, leaving out the ones whose condition is false: `keys(open && close, ...more)`. */
export function keys(...items: readonly (Binding | readonly Binding[] | false | null | undefined | "" | 0)[]): Binding[] {
  return items.flatMap((item) => (!item ? [] : Array.isArray(item) ? item : [item as Binding]));
}

/** The same binding with a hint, for a list that names it. */
export function hinted(binding: Binding, hint: string): Binding {
  return { ...binding, hint };
}
