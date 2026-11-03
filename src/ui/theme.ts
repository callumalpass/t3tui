import { type NativeResourceOwner, SyntaxStyle, type TerminalColors, type ThemeMode } from "@opentui/core";
import { useRenderer } from "@opentui/react";

import type { StatusTone } from "../model/threads.ts";
import type { Tone } from "../model/transcript.ts";

/** Neutral grey steps with one blue accent, after opencode's default theme. */
const DARK = {
  bg: "#0a0a0a",
  /** The thread list, details and overlays: a step up from the background. */
  panel: "#141414",
  /** Raised blocks on a panel or the background: the composer, your messages, tool output. */
  element: "#1e1e1e",
  /** A raised block under the pointer: one step up from element. */
  elementHover: "#282828",
  border: "#3c3c3c",
  borderFocused: "#5c9cf5",
  text: "#eeeeee",
  muted: "#8a8a8a",
  faint: "#606060",
  accent: "#5c9cf5",
  user: "#56b6c2",
  userBg: "#1e1e1e",
  good: "#7fd88f",
  bad: "#e06c75",
  warn: "#f5a742",
  selectedBg: "#1d2a3d",
  /** Under the pointer: lighter than the panel, quieter than a selection. */
  hoverBg: "#1a1a1a",
  buttonBg: "#1e1e1e",
  /** The web app's sky / indigo / violet status hues. */
  info: "#56b6c2",
  input: "#9d7cd8",
  plan: "#fab283",
  diffAddedBg: "#14261a",
  diffRemovedBg: "#2a1517",
  /** The line-number gutter: a shade off the background, deeper beside added and removed lines. */
  diffGutterBg: "#111111",
  diffAddedGutterBg: "#1b3322",
  diffRemovedGutterBg: "#381c1f",
  diffAddedSign: "#7fd88f",
  diffRemovedSign: "#e06c75",
};

export type Palette = { readonly [K in keyof typeof DARK]: string };

/** The same steps for terminals with a light background. */
const LIGHT: Palette = {
  bg: "#ffffff",
  panel: "#f5f5f5",
  element: "#ebebeb",
  elementHover: "#e1e1e1",
  border: "#d4d4d4",
  borderFocused: "#3b7dd8",
  text: "#1a1a1a",
  muted: "#6e6e6e",
  faint: "#9a9a9a",
  accent: "#3b7dd8",
  user: "#318795",
  userBg: "#ebebeb",
  good: "#3d9a57",
  bad: "#d1383d",
  warn: "#b0701a",
  selectedBg: "#dce8f8",
  hoverBg: "#efefef",
  buttonBg: "#ebebeb",
  info: "#318795",
  input: "#7b5bb6",
  plan: "#c06a2b",
  diffAddedBg: "#e3f3e6",
  diffRemovedBg: "#fbe4e4",
  diffGutterBg: "#f7f7f7",
  diffAddedGutterBg: "#cdebd3",
  diffRemovedGutterBg: "#f5cfcf",
  diffAddedSign: "#3d9a57",
  diffRemovedSign: "#d1383d",
};

/** The palette in use. Read at render time, so applyTheme before the first frame sets it everywhere. */
export const colors: Palette = { ...DARK };

/** Sets the palette: the dark or light one, or one built with terminalPalette. */
export function applyTheme(theme: ThemeMode | Palette): void {
  Object.assign(colors, theme === "light" ? LIGHT : theme === "dark" ? DARK : theme);
  markdownStyles = new WeakMap();
  codeStyles = new WeakMap();
}

/** Dark or light, by the background's luminance; null if the terminal didn't say. */
export function themeModeOf(terminal: TerminalColors | null): ThemeMode | null {
  const background = rgb(terminal?.defaultBackground ?? null);
  if (!background) return null;
  const [r, g, b] = background;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127 ? "light" : "dark";
}

/**
 * The terminal's own colours as a palette: panels and raised blocks a few small steps off
 * its background, text from its foreground, status hues from its ANSI colours. Null without
 * a background and foreground; colours it didn't report come from the dark or light palette.
 */
export function terminalPalette(terminal: TerminalColors | null): Palette | null {
  const mode = themeModeOf(terminal);
  const bg = terminal?.defaultBackground;
  const text = terminal?.defaultForeground;
  if (!mode || !bg || !text || !rgb(text)) return null;
  const base = mode === "light" ? LIGHT : DARK;
  const ansi = (index: number, fallback: string) => (rgb(terminal.palette[index] ?? null) ? terminal.palette[index]! : fallback);
  // Lighter steps on a dark background, darker on a light one.
  const step = (amount: number) => mix(bg, mode === "dark" ? "#ffffff" : "#000000", amount);
  const accent = ansi(12, ansi(4, base.accent));
  const good = ansi(2, base.good);
  const bad = ansi(1, base.bad);
  const cyan = ansi(6, base.info);
  return {
    bg,
    panel: step(0.04),
    element: step(0.08),
    elementHover: step(0.12),
    border: mix(bg, text, 0.22),
    borderFocused: accent,
    text,
    muted: mix(text, bg, 0.4),
    faint: mix(text, bg, 0.6),
    accent,
    user: cyan,
    userBg: step(0.08),
    good,
    bad,
    warn: ansi(3, base.warn),
    selectedBg: mix(bg, accent, 0.22),
    hoverBg: step(0.06),
    buttonBg: step(0.08),
    info: cyan,
    input: ansi(5, base.input),
    plan: ansi(11, ansi(3, base.plan)),
    diffAddedBg: mix(bg, good, 0.14),
    diffRemovedBg: mix(bg, bad, 0.14),
    diffGutterBg: step(0.03),
    diffAddedGutterBg: mix(bg, good, 0.26),
    diffRemovedGutterBg: mix(bg, bad, 0.26),
    diffAddedSign: good,
    diffRemovedSign: bad,
  };
}

/** A `#rrggbb` colour's channels, or null for anything else. */
function rgb(hex: string | null): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  return match ? [Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16), Number.parseInt(match[3]!, 16)] : null;
}

/** `amount` of the way from one colour to another. */
function mix(from: string, to: string, amount: number): string {
  const a = rgb(from)!;
  const b = rgb(to)!;
  return `#${a.map((channel, index) => Math.round(channel + (b[index]! - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

const STATUS_COLORS: Record<StatusTone, keyof Palette> = { info: "info", muted: "muted", warn: "warn", input: "input", bad: "bad", good: "good" };
export const statusColor = (tone: StatusTone): string => colors[STATUS_COLORS[tone]];

const TONE_COLORS: Record<Tone, keyof Palette> = { normal: "text", muted: "muted", good: "good", bad: "bad", warn: "warn" };
export const toneColor = (tone: Tone): string => colors[TONE_COLORS[tone]];

/** A scrollbox's bars in the palette: OpenTUI's own track is dark whatever the theme. */
export const scrollbarOptions = () => ({ trackOptions: { foregroundColor: colors.muted, backgroundColor: colors.element } });

let markdownStyles = new WeakMap<NativeResourceOwner, SyntaxStyle>();

/** One per renderer: a SyntaxStyle belongs to the renderer's native scene that created it. */
export function useMarkdownStyle(): SyntaxStyle {
  const owner = useRenderer().nativeScene;
  let style = markdownStyles.get(owner);
  if (style) return style;
  style = SyntaxStyle.fromStyles({
    default: { fg: colors.text },
    "markup.heading": { fg: colors.text, bold: true },
    "markup.strong": { fg: colors.text, bold: true },
    "markup.italic": { fg: colors.text, italic: true },
    "markup.strikethrough": { dim: true },
    // The renderer appends " (url)" after a link's text even with conceal on, and offers
    // no way to hide it; keep the text as the link and the rest as quiet as it can be.
    "markup.link": { fg: colors.faint },
    "markup.link.label": { fg: colors.accent, underline: true },
    "markup.link.url": { fg: colors.faint },
    "markup.quote": { fg: colors.muted, italic: true },
    "markup.raw": { fg: colors.plan },
    "markup.raw.block": { fg: colors.text },
    // Attachments and mentions in the message box.
    "extmark.chip": { fg: colors.accent, bg: colors.element },
  }, owner);
  markdownStyles.set(owner, style);
  return style;
}

let codeStyles = new WeakMap<NativeResourceOwner, SyntaxStyle>();

/** Source files in the preview tab: the palette's few hues on the tree-sitter scopes that matter. */
export function useCodeStyle(): SyntaxStyle {
  const owner = useRenderer().nativeScene;
  let style = codeStyles.get(owner);
  if (style) return style;
  style = SyntaxStyle.fromStyles({
    default: { fg: colors.text },
    keyword: { fg: colors.input },
    string: { fg: colors.good },
    comment: { fg: colors.faint, italic: true },
    number: { fg: colors.plan },
    boolean: { fg: colors.plan },
    constant: { fg: colors.plan },
    function: { fg: colors.accent },
    type: { fg: colors.info },
    constructor: { fg: colors.info },
    operator: { fg: colors.muted },
    punctuation: { fg: colors.muted },
    "markup.heading": { fg: colors.text, bold: true },
    "markup.raw": { fg: colors.plan },
  }, owner);
  codeStyles.set(owner, style);
  return style;
}
