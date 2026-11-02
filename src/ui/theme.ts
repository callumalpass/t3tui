import { type NativeResourceOwner, SyntaxStyle, type ThemeMode } from "@opentui/core";
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

export function applyTheme(mode: ThemeMode): void {
  Object.assign(colors, mode === "light" ? LIGHT : DARK);
  markdownStyles = new WeakMap();
}

const STATUS_COLORS: Record<StatusTone, keyof Palette> = { info: "info", muted: "muted", warn: "warn", input: "input", bad: "bad", good: "good" };
export const statusColor = (tone: StatusTone): string => colors[STATUS_COLORS[tone]];

const TONE_COLORS: Record<Tone, keyof Palette> = { normal: "text", muted: "muted", good: "good", bad: "bad", warn: "warn" };
export const toneColor = (tone: Tone): string => colors[TONE_COLORS[tone]];

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
  }, owner);
  markdownStyles.set(owner, style);
  return style;
}
