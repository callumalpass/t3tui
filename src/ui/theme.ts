import { SyntaxStyle } from "@opentui/core";

import type { Tone } from "../model/transcript.ts";

export const colors = {
  bg: "#16161e",
  panel: "#1a1b26",
  border: "#2f334d",
  borderFocused: "#7aa2f7",
  text: "#c0caf5",
  muted: "#737aa2",
  faint: "#545c7e",
  accent: "#7aa2f7",
  user: "#7dcfff",
  good: "#9ece6a",
  bad: "#f7768e",
  warn: "#e0af68",
  selectedBg: "#283457",
} as const;

export const toneColor: Record<Tone, string> = {
  normal: colors.text,
  muted: colors.muted,
  good: colors.good,
  bad: colors.bad,
  warn: colors.warn,
};

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
