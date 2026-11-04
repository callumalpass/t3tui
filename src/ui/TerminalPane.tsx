import { EmbeddedTerminalRenderable, type EmbeddedTerminalDataSource } from "@opentui/core";
import { extend } from "@opentui/react";
import { useEffect, useRef, type ReactNode } from "react";

import type { T3Session } from "../client/session.ts";
import { isWindowsAbsolute } from "../model/paths.ts";
import { BAR } from "./edges.ts";
import { keepConptyWrap, type TerminalTarget } from "./terminalAttach.ts";
import { colors } from "./theme.ts";
import { useEvent } from "./useEvent.ts";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    embeddedTerminal: typeof EmbeddedTerminalRenderable;
  }
}

extend({ embeddedTerminal: EmbeddedTerminalRenderable });

/** What runs in the pane: one of T3's terminals, or a program run here, like $EDITOR. */
export type PaneProgram =
  | { readonly kind: "server"; readonly id: string; readonly target: TerminalTarget }
  | { readonly kind: "local"; readonly id: string; readonly title: string; readonly command: readonly string[]; readonly cwd?: string | undefined; readonly onExit: (code: number) => void };

/** How the pane talks to its program once it knows its size. */
interface Link {
  readonly send: (data: Uint8Array, source: EmbeddedTerminalDataSource) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly stop: () => void;
}

/**
 * A terminal filling its box: the drawer, a tab of the right-hand column or the composer's
 * place. Keys go to its program while it has focus, its size follows the box, and it closes
 * when the program exits. Its left edge and header light up while it has the keys. Key it by
 * the program's id.
 */
export function TerminalPane(props: {
  readonly program: PaneProgram;
  readonly session: T3Session;
  readonly focused: boolean;
  /** The row above the terminal: its title, or the drawer's tabs; none under the column's own tabs. */
  readonly header?: ReactNode;
  readonly onFocus: () => void;
  readonly onClose: (message?: string) => void;
}) {
  const { program, focused } = props;
  const terminal = useRef<EmbeddedTerminalRenderable | null>(null);
  const link = useRef<Link | null>(null);
  const onFocus = useEvent(props.onFocus);
  const onClose = useEvent(props.onClose);

  useEffect(() => () => link.current?.stop(), []);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    if (focused) term.focus();
    else term.blur();
  }, [focused]);
  // A click the program takes as a mouse event still focuses the terminal; that is the pane's focus too.
  useEffect(() => {
    const term = terminal.current;
    term?.on("focused", onFocus);
    return () => void term?.off("focused", onFocus);
  }, [onFocus]);

  const start = (term: EmbeddedTerminalRenderable, cols: number, rows: number) => {
    paint(term);
    link.current = program.kind === "server" ? attachServer(props.session, program.target, term, cols, rows, onClose) : spawnLocal(program, term, cols, rows, onClose);
  };

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      overflow="hidden"
      backgroundColor={colors.panel}
      border={["left"]}
      customBorderChars={BAR}
      borderColor={focused ? colors.accent : colors.faint}
      onMouseDown={onFocus}
    >
      {props.header ? (
        <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={focused ? colors.element : colors.panel}>
          {props.header}
        </box>
      ) : null}
      <embeddedTerminal
        ref={terminal}
        flexGrow={1}
        // Without a height of its own it starts at 24 rows, which can't shrink: a shorter box would clip it, and the program would draw rows nobody sees.
        flexShrink={1}
        minHeight={0}
        width="100%"
        onTerminalResize={function (this: EmbeddedTerminalRenderable, cols: number, rows: number) {
          if (link.current) link.current.resize(cols, rows);
          else start(this, cols, rows);
        }}
        onData={(data, source) => link.current?.send(data, source)}
      />
    </box>
  );
}

/** The program's default colours are the pane's. */
function paint(term: EmbeddedTerminalRenderable): void {
  term.write(`\x1b]10;${colors.text}\x1b\\\x1b]11;${colors.panel}\x1b\\`);
}

/**
 * One of T3's terminals: its scrollback, then live output; typed keys go to it. Only keys:
 * the emulator's own answers to queries replayed from history must not reach the shell.
 */
function attachServer(session: T3Session, target: TerminalTarget, term: EmbeddedTerminalRenderable, cols: number, rows: number, close: (message?: string) => void): Link {
  const { threadId, terminalId } = target;
  const decoder = new TextDecoder();
  const output = isWindowsAbsolute(target.cwd) ? keepConptyWrap : (data: string) => data;
  let stopped = false;
  let detach = () => {};
  const end = (message?: string) => {
    if (stopped) return;
    stopped = true;
    detach();
    close(message);
  };
  detach = session.attachTerminal(
    { threadId, terminalId, cwd: target.cwd, worktreePath: target.worktreePath, cols, rows },
    (event) => {
      if (stopped) return;
      switch (event.type) {
        case "snapshot":
        case "restarted":
          term.write("\x1bc");
          paint(term);
          term.write(output(event.snapshot.history));
          return;
        case "output":
          term.write(output(event.data));
          return;
        case "cleared":
          term.write("\x1b[H\x1b[2J");
          return;
        case "error":
          term.write(`\r\n\x1b[31m[${event.message}]\x1b[0m\r\n`);
          return;
        case "exited":
          return end(`${target.label} exited`);
        case "closed":
          return end("Terminal closed");
      }
    },
    (error) => end(error ? `Terminal: ${error}` : undefined),
  );
  // A fake or failing session can end the stream before it returns.
  if (stopped) detach();
  return {
    send: (data, source) => {
      if (source === "input" && !stopped) session.writeTerminal(threadId, terminalId, decoder.decode(data, { stream: true })).catch(() => {});
    },
    resize: (next, height) => void session.resizeTerminal(threadId, terminalId, next, height).catch(() => {}),
    stop: () => {
      stopped = true;
      detach();
    },
  };
}

/**
 * The emulator's answers, except that it doesn't know in-band resize (mode 2048). It says it
 * does, but never sends the reports, and a program that takes it at its word, like Neovim,
 * stops listening for SIGWINCH and so never sees the pane change size.
 */
function withoutInBandResize(data: Uint8Array): Uint8Array {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: this matches an escape sequence
  return Buffer.from(Buffer.from(data).toString("latin1").replace(/\x1b\[\?2048;\d\$y/g, "\x1b[?2048;0$y"), "latin1");
}

/** A program run here on its own pty, answering its terminal queries through the emulator. */
function spawnLocal(program: Extract<PaneProgram, { kind: "local" }>, term: EmbeddedTerminalRenderable, cols: number, rows: number, close: (message?: string) => void): Link {
  const output = process.platform === "win32" ? (data: Uint8Array) => Buffer.from(keepConptyWrap(Buffer.from(data).toString("latin1")), "latin1") : (data: Uint8Array) => data;
  let stopped = false;
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([...program.command], {
      ...(program.cwd ? { cwd: program.cwd } : {}),
      terminal: { cols, rows, data: (_pty, data) => term.write(output(data)) },
    });
  } catch (error) {
    // A missing program throws here, inside a resize; let the pane say so rather than the render loop.
    queueMicrotask(() => {
      program.onExit(127);
      close(`Couldn't start ${program.command[0]}: ${error instanceof Error ? error.message : String(error)}`);
    });
    return { send: () => {}, resize: () => {}, stop: () => {} };
  }
  void child.exited.then((code) => {
    if (stopped) return;
    stopped = true;
    program.onExit(code);
    close();
  });
  return {
    send: (data, source) => void child.terminal?.write(source === "response" ? withoutInBandResize(data) : data),
    resize: (next, height) => child.terminal?.resize(next, height),
    stop: () => {
      if (stopped) return;
      stopped = true;
      child.kill();
    },
  };
}
