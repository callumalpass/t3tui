import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { keys, type Binding } from "../model/keymap.ts";
import type { PaneProgram } from "./TerminalPane.tsx";
import type { TerminalTarget } from "./terminalAttach.ts";

export type Placement = "bottom" | "side";
export type ColumnTab = "details" | "editor" | "terminal";
/** The pane that takes the keys in "pane" mode. */
export type PaneFocus = "terminal" | "editor" | "message";
type LocalProgram = Extract<PaneProgram, { kind: "local" }>;

const COLUMN_TAB_LABELS: Record<ColumnTab, string> = { details: "Details", editor: "Editor", terminal: "Terminal" };

/**
 * The panes around the conversation: each thread's terminals (in the drawer below it, or the
 * right-hand column's Terminal tab), a file in $EDITOR in the column's Editor tab, and the
 * message in $EDITOR in the composer's place. Which one has the keys, and the keys between them.
 */
export function usePanes(deps: {
  readonly threadId: ThreadId | undefined;
  /** The open thread's terminals on the server. */
  readonly terminals: readonly TerminalTarget[];
  readonly placement: Placement;
  /** Whether the right-hand column shows; its setting, and changing it for this run only. */
  readonly column: boolean;
  readonly columnPref: boolean | null;
  readonly setColumnPref: (show: boolean | null) => void;
  /** Whether a pane has the keys, and giving them to one or back to the conversation. */
  readonly focused: boolean;
  readonly focus: (focused: boolean) => void;
  readonly say: (text: string, bad?: boolean) => void;
}) {
  const { threadId, placement, column, focused, say } = deps;
  /** Per thread: the terminal its drawer shows, and whether the drawer is open. */
  const [drawers, setDrawers] = useState<ReadonlyMap<ThreadId, { readonly target: TerminalTarget; readonly open: boolean }>>(new Map());
  /** Terminals that closed or exited here, until the server's list catches up. */
  const [ended, setEnded] = useState<ReadonlySet<string>>(new Set());
  const [editor, setEditor] = useState<LocalProgram | null>(null);
  const [message, setMessage] = useState<LocalProgram | null>(null);
  const [tab, setTab] = useState<ColumnTab>("details");
  const [target, setTarget] = useState<PaneFocus>("terminal");
  /** The column's setting before a tab opened it, to go back to once that tab closes. */
  const restore = useRef<{ readonly pref: boolean | null } | null>(null);

  const endedKey = (terminal: TerminalTarget) => `${terminal.threadId}:${terminal.terminalId}`;
  const drawer = threadId ? drawers.get(threadId) : undefined;
  const listed = deps.terminals.filter((terminal) => !ended.has(endedKey(terminal)));
  // A terminal just opened shows before the server lists it.
  const tabs = drawer && !ended.has(endedKey(drawer.target)) && !listed.some((terminal) => terminal.terminalId === drawer.target.terminalId) ? [...listed, drawer.target] : listed;
  const terminal = drawer?.open ? drawer.target : null;
  const side = placement === "side";

  const columnTabs: ColumnTab[] = ["details", ...(editor ? ["editor" as const] : []), ...(side && terminal ? ["terminal" as const] : [])];
  const columnTab = columnTabs.includes(tab) ? tab : "details";
  const shown: Record<PaneFocus, boolean> = {
    terminal: terminal !== null && (!side || (column && columnTab === "terminal")),
    editor: column && columnTab === "editor",
    message: message !== null,
  };
  const focusedPane = focused && shown[target] ? target : null;
  // A pane that went away, or out of sight, gives the keys back.
  useEffect(() => {
    if (focused && !shown[target]) deps.focus(false);
  });

  const enter = (pane: PaneFocus) => {
    setTarget(pane);
    deps.focus(true);
  };
  const showTab = (next: ColumnTab) => {
    setTab(next);
    if (column) return;
    restore.current ??= { pref: deps.columnPref };
    deps.setColumnPref(true);
  };
  /** The column goes back to how it was once nothing but Details is left in it. */
  const tabGone = (othersLeft: boolean) => {
    if (othersLeft || !restore.current) return;
    deps.setColumnPref(restore.current.pref);
    restore.current = null;
  };
  const setDrawer = (id: ThreadId, value: { readonly target: TerminalTarget; readonly open: boolean }) => setDrawers((previous) => new Map(previous).set(id, value));

  /** Shows a terminal, as a tab of the drawer or of the column, and gives it the keys. */
  const openTerminal = (next: TerminalTarget) => {
    setEnded((previous) => {
      const rest = new Set(previous);
      rest.delete(endedKey(next));
      return rest;
    });
    setDrawer(next.threadId, { target: next, open: true });
    if (side) showTab("terminal");
    enter("terminal");
  };
  const hideTerminal = () => {
    if (!threadId || !drawer) return;
    setDrawer(threadId, { ...drawer, open: false });
    if (side) tabGone(editor !== null);
  };
  /** ctrl+j: hides the terminal when it shows, or shows the last one, or `open` finds one. */
  const toggleTerminal = (open: () => void) => {
    if (shown.terminal) return hideTerminal();
    if (drawer && tabs.some((candidate) => candidate.terminalId === drawer.target.terminalId)) return openTerminal(drawer.target);
    open();
  };
  const selectTab = (index: number) => {
    const next = tabs[index];
    if (next) setDrawer(next.threadId, { target: next, open: true });
  };
  /** A terminal closed or exited: its tab goes, the next one shows, and the last takes the drawer with it. */
  const terminalEnded = (gone: TerminalTarget, note?: string) => {
    setEnded((previous) => new Set(previous).add(endedKey(gone)));
    const next = tabs.find((candidate) => candidate.terminalId !== gone.terminalId);
    if (next) setDrawer(gone.threadId, { target: next, open: drawers.get(gone.threadId)?.open ?? true });
    else {
      setDrawers((previous) => {
        const rest = new Map(previous);
        rest.delete(gone.threadId);
        return rest;
      });
      if (side && gone.threadId === threadId) tabGone(editor !== null);
    }
    if (note) say(note);
  };

  /** A file in $EDITOR, in the column's Editor tab. An editor may hold unsaved work, so it isn't replaced. */
  const openEditor = (program: LocalProgram) => {
    if (editor && editor.id !== program.id) return say("The editor is still open; ctrl+\\ there and quit it first.", true);
    setEditor(program);
    showTab("editor");
    enter("editor");
  };
  const editorClosed = (note?: string) => {
    setEditor(null);
    tabGone(side && terminal !== null);
    if (note) say(note);
  };
  /** The message in $EDITOR, in the composer's place. */
  const openMessage = (program: LocalProgram) => {
    setMessage(program);
    enter("message");
  };

  // ctrl+\ goes back to the pane that last had the keys, or the first that shows.
  const next = ([target, "message", "editor", "terminal"] as const).find((pane) => shown[pane]);
  const paneKey: Binding | null = next
    ? { keys: ["ctrl+\\"], run: () => (focused ? deps.focus(false) : enter(next)), hint: focused ? "leave pane" : "pane", command: { id: "pane-focus", title: focused ? "Leave the pane" : "Focus the pane", keywords: ["terminal", "editor"] } }
    : null;
  /** alt+1…9 pick the terminal tab, while the terminal shows. */
  const tabKeys: Binding[] = shown.terminal ? tabs.slice(0, 9).map((_, index) => ({ keys: [`alt+${index + 1}`], run: () => selectTab(index) })) : [];
  const cycle = (step: 1 | -1) => setTab(columnTabs[(columnTabs.indexOf(columnTab) + step + columnTabs.length) % columnTabs.length]!);
  /** { and } step through the column's tabs; [ and ] step through turns. */
  const columnKeys: Binding[] =
    column && columnTabs.length > 1
      ? [
          { keys: ["}"], run: () => cycle(1), command: { id: "column-next", title: "Next tab in the right column", keywords: ["details", "editor", "terminal"] } },
          { keys: ["{"], run: () => cycle(-1), command: { id: "column-previous", title: "Previous tab in the right column", keywords: ["details", "editor", "terminal"] } },
        ]
      : [];
  /** While a pane has the keys, all it keeps are these. */
  const focusedKeys = keys(paneKey, focusedPane === "terminal" && tabKeys);

  return {
    terminal,
    tabs,
    editor,
    message,
    columnTabs: columnTabs.map((id) => ({ id, label: COLUMN_TAB_LABELS[id] })),
    columnTab,
    setColumnTab: setTab,
    focusedPane,
    enter,
    openTerminal,
    hideTerminal,
    toggleTerminal,
    selectTab,
    terminalEnded,
    openEditor,
    editorClosed,
    openMessage,
    messageClosed: () => setMessage(null),
    keys: { pane: paneKey, tabs: tabKeys, column: columnKeys, focused: focusedKeys },
  };
}
