import type { CliRenderer } from "@opentui/core";
import type { ThreadId } from "@t3tools/contracts";

import type { T3Session } from "../client/session.ts";

/** Ctrl+J (LF), Ctrl+] and Ctrl+J under the kitty keyboard protocol leave the terminal. */
const DETACH_KEYS = new Set(["\n", "\x1d", "\x1b[106;5u"]);

/** Modes a full-screen program may leave on; switched off before t3tui draws again. */
const RESET = "\x1b[0m\x1b[?25h\x1b[?1l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l";

export interface TerminalTarget {
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly label: string;
}

/**
 * Gives the whole screen to one of T3's terminals: its scrollback, then live output, with
 * keystrokes sent to it. Ctrl+J comes back. The terminal keeps running on the server.
 * Note that a terminal's size is shared by everyone attached, so attaching resizes it.
 */
export async function attachTerminal(renderer: CliRenderer, session: T3Session, target: TerminalTarget, onDone: (message?: string) => void): Promise<void> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const size = () => ({ cols: stdout.columns || 80, rows: stdout.rows || 24 });
  let finished = false;

  await renderer.suspend();
  stdout.write("\x1b[?1049h\x1b[H\x1b[2J");
  stdout.write(`\x1b]2;t3tui · ${target.label} · ctrl+j to return\x07`);
  stdin.setRawMode?.(true);
  stdin.resume();

  const onInput = (data: Buffer) => {
    const text = data.toString("utf8");
    if (DETACH_KEYS.has(text)) return finish();
    session.writeTerminal(target.threadId, target.terminalId, text).catch(() => {});
  };
  const onResize = () => {
    const { cols, rows } = size();
    session.resizeTerminal(target.threadId, target.terminalId, cols, rows).catch(() => {});
  };
  const detach = session.attachTerminal(
    { threadId: target.threadId, terminalId: target.terminalId, cwd: target.cwd, worktreePath: target.worktreePath, ...size() },
    (event) => {
      switch (event.type) {
        case "snapshot":
        case "restarted":
          stdout.write("\x1b[H\x1b[2J");
          stdout.write(event.snapshot.history);
          return;
        case "output":
          stdout.write(event.data);
          return;
        case "cleared":
          stdout.write("\x1b[H\x1b[2J");
          return;
        case "exited":
          stdout.write(`\r\n\x1b[2m[exited${event.exitCode === null ? "" : ` with code ${event.exitCode}`} · ctrl+j to return]\x1b[0m\r\n`);
          return;
        case "error":
          stdout.write(`\r\n\x1b[31m[${event.message}]\x1b[0m\r\n`);
          return;
        case "closed":
          return finish("Terminal closed");
      }
    },
    (error) => {
      if (error) finish(`Terminal: ${error}`);
    },
  );
  stdin.on("data", onInput);
  stdout.on("resize", onResize);

  function finish(message?: string) {
    if (finished) return;
    finished = true;
    detach();
    stdin.off("data", onInput);
    stdout.off("resize", onResize);
    stdout.write(RESET);
    stdout.write("\x1b]2;t3tui\x07");
    void renderer.resume().then(() => {
      renderer.requestRender();
      onDone(message);
    });
  }
}
