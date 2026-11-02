import { SyntaxStyle, type ThemeMode } from "@opentui/core";

import type { StatusTone } from "../model/threads.ts";
import type { Tone } from "../model/transcript.ts";

/** Tokyo Night. */
const DARK = {
  bg: "#16161e",
  panel: "#1a1b26",
  border: "#2f334d",
  borderFocused: "#7aa2f7",
  text: "#c0caf5",
  muted: "#737aa2",
  faint: "#545c7e",
  accent: "#7aa2f7",
  user: "#7dcfff",
  userBg: "#1f2335",
  good: "#9ece6a",
  bad: "#f7768e",
  warn: "#e0af68",
  selectedBg: "#283457",
  /** Under the pointer: lighter than the panel, quieter than a selection. */
  hoverBg: "#202437",
  buttonBg: "#24283b",
  /** The web app's sky / indigo / violet status hues. */
  info: "#7dcfff",
  input: "#bb9af7",
  plan: "#c099ff",
  diffAddedBg: "#1e2a1e",
  diffRemovedBg: "#2d1f24",
};

export type Palette = { readonly [K in keyof typeof DARK]: string };

/** Tokyo Night Day, for terminals with a light background. */
const LIGHT: Palette = {
  bg: "#e1e2e7",
  panel: "#d6d9e4",
  border: "#a8aecb",
  borderFocused: "#2e7de9",
  text: "#343b58",
  muted: "#5f6893",
  faint: "#7a81a8",
  accent: "#2e7de9",
  user: "#007197",
  userBg: "#d0d5e3",
  good: "#587539",
  bad: "#d20f39",
  warn: "#8c6c3e",
  selectedBg: "#b7c1e3",
  hoverBg: "#d3d6e2",
  buttonBg: "#c4c8da",
  info: "#007197",
  input: "#9854f1",
  plan: "#7847bd",
  diffAddedBg: "#d4e6cc",
  diffRemovedBg: "#f1d3da",
};

/** The palette in use. Read at render time, so applyTheme before the first frame sets it everywhere. */
export const colors: Palette = { ...DARK };

export function applyTheme(mode: ThemeMode): void {
  Object.assign(colors, mode === "light" ? LIGHT : DARK);
  markdownStyle = undefined;
}

const STATUS_COLORS: Record<StatusTone, keyof Palette> = { info: "info", muted: "muted", warn: "warn", input: "input", bad: "bad", good: "good" };
export const statusColor = (tone: StatusTone): string => colors[STATUS_COLORS[tone]];

const TONE_COLORS: Record<Tone, keyof Palette> = { normal: "text", muted: "muted", good: "good", bad: "bad", warn: "warn" };
export const toneColor = (tone: Tone): string => colors[TONE_COLORS[tone]];

let markdownStyle: SyntaxStyle | undefined;

/** Created lazily: SyntaxStyle needs the native renderer library loaded. */
export function getMarkdownStyle(): SyntaxStyle {
  markdownStyle ??= SyntaxStyle.fromStyles({
    default: { fg: colors.text },
    "markup.heading": { fg: colors.accent, bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": { dim: true },
    "markup.link": { fg: colors.user, underline: true },
    "markup.link.label": { fg: colors.user },
    "markup.link.url": { fg: colors.faint, underline: true },
    "markup.quote": { fg: colors.muted, italic: true },
    "markup.raw": { fg: colors.warn },
    "markup.raw.block": { fg: colors.text },
  });
  return markdownStyle;
}
