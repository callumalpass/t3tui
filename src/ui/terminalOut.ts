/** Escape sequences tui3 writes past the renderer: the bell and desktop notifications. */

/** Inside tmux, escape sequences other than the bell need passthrough to reach the outer terminal. */
function passthrough(sequence: string): string {
  if (!process.env.TMUX) return sequence;
  return `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
}

/** The terminal bell: a sound, a flash, or a flag on the tmux window, as the terminal is set up. */
export function ring(): void {
  process.stdout.write("\x07");
}

/**
 * A desktop notification through the terminal (so it works over SSH): OSC 99 for kitty,
 * OSC 9 for the rest (iTerm2, WezTerm, Ghostty, foot, Windows Terminal). Terminals without
 * either ignore it. In tmux it needs `set -g allow-passthrough on`.
 */
export function desktopNotify(title: string, body: string): void {
  const clean = (text: string) => text.replace(/[\x00-\x1f\x7f;]/g, " ").slice(0, 200);
  const sequence = process.env.KITTY_WINDOW_ID
    ? `\x1b]99;i=tui3:d=0;${clean(title)}\x1b\\\x1b]99;i=tui3:p=body;${clean(body)}\x1b\\`
    : `\x1b]9;${clean(title)}: ${clean(body)}\x07`;
  process.stdout.write(passthrough(sequence));
}
