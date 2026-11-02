import { EmbeddedTerminalRenderable, type EmbeddedTerminalDataSource } from "@opentui/core";
import { extend } from "@opentui/react";
import { useEffect, useRef } from "react";

import type { T3Session } from "../client/session.ts";
import { BAR } from "./edges.ts";
import type { TerminalTarget } from "./terminalAttach.ts";
import { truncate } from "./text.ts";
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
  | { readonly kind: "server"; readonly id: string; readonly title: string; readonly target: TerminalTarget }
  | { readonly kind: "local"; readonly id: string; readonly title: string; readonly command: readonly string[]; readonly cwd?: string | undefined; readonly onExit: (code: number) => void };

/** How the pane talks to its program once it knows its size. */
interface Link {
  readonly send: (data: Uint8Array, source: EmbeddedTerminalDataSource) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly stop: () => void;
}

/**
 * A terminal in the right-hand column: keys go to its program while it has focus, its size
 * follows the column, and it closes when the program exits. Key it by the program's id.
 */
export function TerminalPane(props: {
  readonly program: PaneProgram;
  readonly session: T3Session;
  readonly focused: boolean;
  /** A column this wide beside the conversation, or the conversation's place: from `left`, `height` tall. */
  readonly place: { readonly width: number } | { readonly left: number; readonly height: number };
  readonly onFocus: () => void;
  readonly onClose: (message?: string) => void;
}) {
  const { program, focused, place } = props;
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
      {...("width" in place ? { width: place.width, flexShrink: 0 } : { position: "absolute", left: place.left, right: 0, top: 0, height: place.height })}
      minHeight={0}
      flexDirection="column"
      overflow="hidden"
      backgroundColor={colors.panel}
      border={["left"]}
      customBorderChars={BAR}
      borderColor={focused ? colors.accent : colors.panel}
      onMouseDown={onFocus}
    >
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={focused ? colors.text : colors.muted} wrapMode="none">{truncate(program.title, Math.max(8, ("width" in place ? place.width : 80) - 17))}</text>
        <box flexGrow={1} />
        <text fg={colors.faint} wrapMode="none" flexShrink={0}>{focused ? "ctrl+\\ leave" : "ctrl+\\ focus"}</text>
      </box>
      <embeddedTerminal
        ref={terminal}
        flexGrow={1}
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
          term.write(event.snapshot.history);
          return;
        case "output":
          term.write(event.data);
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

/** A program run here on its own pty, answering its terminal queries through the emulator. */
function spawnLocal(program: Extract<PaneProgram, { kind: "local" }>, term: EmbeddedTerminalRenderable, cols: number, rows: number, close: (message?: string) => void): Link {
  let stopped = false;
  const child = Bun.spawn([...program.command], {
    ...(program.cwd ? { cwd: program.cwd } : {}),
    terminal: { cols, rows, data: (_pty, data) => term.write(data) },
  });
  void child.exited.then((code) => {
    if (stopped) return;
    stopped = true;
    program.onExit(code);
    close();
  });
  return {
    send: (data) => void child.terminal?.write(data),
    resize: (next, height) => child.terminal?.resize(next, height),
    stop: () => {
      if (stopped) return;
      stopped = true;
      child.kill();
    },
  };
}
