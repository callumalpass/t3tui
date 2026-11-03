import type { ThreadId } from "@t3tools/contracts";
import { basename } from "node:path";
import { useEffect, useRef, useState } from "react";

import { keys, type Binding } from "../model/keymap.ts";
import { nvimModified, nvimQuit } from "./editor.ts";
import type { PaneProgram } from "./TerminalPane.tsx";
import type { TerminalTarget } from "./terminalAttach.ts";

export type Placement = "bottom" | "side";
/** The panes that take the keys, in the order focus moves through them after the conversation. */
export type PaneFocus = "message" | "drawer" | "column";
const PANE_ORDER: readonly PaneFocus[] = ["message", "drawer", "column"];
/** How long ctrl+\ waits for the key after it. */
const PREFIX_MS = 2000;
const DETAILS = "details";
const FILES = "files";
/** The column's tab for the shown terminal, in side placement. */
const TERMINAL = "terminal";
type LocalProgram = Extract<PaneProgram, { kind: "local" }>;

/** A program run here in $EDITOR, with Neovim's socket when it serves one. */
export interface EditorProgram {
  readonly program: LocalProgram;
  readonly socket: string | null;
}
/** A file in $EDITOR, in a tab of the column: the path its tab shows, relative to the workspace. */
export interface EditorTab extends EditorProgram {
  readonly path: string;
}
/** A workspace file shown read-only in a tab of the column: its path relative to `cwd`. */
export interface PreviewTab {
  readonly id: string;
  readonly path: string;
  readonly cwd: string;
}
export interface ColumnTab {
  readonly id: string;
  readonly label: string;
  readonly kind: "details" | "files" | "editor" | "preview" | "terminal";
}

/**
 * The panes around the conversation: each thread's terminals (in the drawer below it, or as
 * tabs of the right-hand column), the Files tab, files in $EDITOR or previewed in the column's
 * tabs, and the message in $EDITOR in the composer's place. Which one has the keys, and the ctrl+\ prefix that moves
 * them, picks tabs, closes and zooms.
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
  /** Whether the details panel has the keys: the column counts as focused for tabs and zoom. */
  readonly detailsFocused: boolean;
  /** Finds or starts a terminal for the thread, a new one, and closing one (after asking). */
  readonly openTerminal: () => void;
  readonly newTerminal: () => void;
  readonly closeTerminal: (target: TerminalTarget) => void;
  readonly say: (text: string, bad?: boolean) => void;
}) {
  const { threadId, placement, column, focused, say } = deps;
  /** Per thread: the terminal its drawer shows, and whether the drawer is open. */
  const [drawers, setDrawers] = useState<ReadonlyMap<ThreadId, { readonly target: TerminalTarget; readonly open: boolean }>>(new Map());
  /** Terminals that closed or exited here, until the server's list catches up. */
  const [ended, setEnded] = useState<ReadonlySet<string>>(new Set());
  /** Terminals this run has shown, which the strip under the message box names while the drawer is hidden. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [editors, setEditors] = useState<readonly EditorTab[]>([]);
  const [previews, setPreviews] = useState<readonly PreviewTab[]>([]);
  const [message, setMessage] = useState<EditorProgram | null>(null);
  const [tab, setTab] = useState<string>(DETAILS);
  const [target, setTarget] = useState<PaneFocus>("drawer");
  const [prefix, setPrefix] = useState(false);
  const [zoomed, setZoomed] = useState<PaneFocus | null>(null);
  /** Editors with unsaved changes, checked as the column hides (they can't change while it's hidden). */
  const [modified, setModified] = useState<ReadonlySet<string>>(new Set());
  const prefixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The column's setting before a tab opened it, to go back to once that tab closes. */
  const restore = useRef<{ readonly pref: boolean | null } | null>(null);
  /** The program tab the column showed last, for focusing the column from Details. */
  const lastProgramTab = useRef<string | null>(null);

  const key = (terminal: TerminalTarget) => `${terminal.threadId}:${terminal.terminalId}`;
  const drawer = threadId ? drawers.get(threadId) : undefined;
  const listed = deps.terminals.filter((terminal) => !ended.has(key(terminal)));
  // A terminal just opened shows before the server lists it.
  const tabs = drawer && !ended.has(key(drawer.target)) && !listed.some((terminal) => terminal.terminalId === drawer.target.terminalId) ? [...listed, drawer.target] : listed;
  const terminal = drawer?.open ? drawer.target : null;
  /** The terminal ctrl+j shows, and the palette's close and clear act on. */
  const activeTerminal = (drawer && tabs.some((candidate) => candidate.terminalId === drawer.target.terminalId) ? drawer.target : tabs[0]) ?? null;
  const side = placement === "side";

  const terminalTabId = (terminalId: string) => `${TERMINAL}:${terminalId}`;
  const columnTabs: ColumnTab[] = [
    { id: DETAILS, label: "Details", kind: "details" },
    { id: FILES, label: "Files", kind: "files" },
    ...editors.map((editor): ColumnTab => ({ id: editor.program.id, label: editor.path, kind: "editor" })),
    ...previews.map((preview): ColumnTab => ({ id: preview.id, label: preview.path, kind: "preview" })),
    ...(side && terminal ? tabs.map((candidate): ColumnTab => ({ id: terminalTabId(candidate.terminalId), label: candidate.label, kind: "terminal" })) : []),
  ];
  const columnTab = tab === TERMINAL && side && terminal ? terminalTabId(terminal.terminalId) : tab === FILES || editors.some((editor) => editor.program.id === tab) || previews.some((preview) => preview.id === tab) ? tab : DETAILS;
  const activeColumnTab = columnTabs.find((candidate) => candidate.id === columnTab)!;
  /** The tabs that hold something of their own: programs and previews. */
  const programTabs = columnTabs.filter((candidate) => candidate.kind !== "details" && candidate.kind !== "files");
  const shown: Record<PaneFocus, boolean> = {
    message: message !== null,
    drawer: terminal !== null && !side,
    column: column && columnTab !== DETAILS,
  };
  /** What focus can move to: open panes, and the column while it shows Files or holds a program, even hidden. */
  const open: Record<PaneFocus, boolean> = { ...shown, column: shown.column || programTabs.length > 0 };
  const available = PANE_ORDER.filter((pane) => open[pane]);
  const focusedPane = focused && shown[target] ? target : null;
  const zoomShown = zoomed !== null && (zoomed === "column" ? column : shown[zoomed]);
  // A pane that went away, or out of sight, gives the keys back, and its zoom.
  useEffect(() => {
    if (focused && !shown[target]) deps.focus(false);
    if (zoomed && !zoomShown) setZoomed(null);
  });
  useEffect(() => () => void (prefixTimer.current && clearTimeout(prefixTimer.current)), []);
  // The ● for unsaved changes while the column is hidden: Neovim says; other editors can't.
  const sockets = editors.flatMap((editor) => (editor.socket ? [`${editor.program.id}\n${editor.socket}`] : [])).join("\n");
  useEffect(() => {
    if (column || !sockets) {
      setModified(new Set());
      return;
    }
    let current = true;
    const checks = editors.flatMap((editor) => (editor.socket ? [nvimModified(editor.socket).then((changed) => (changed ? [editor.program.id] : []))] : []));
    void Promise.all(checks).then((ids) => current && setModified(new Set(ids.flat())));
    return () => {
      current = false;
    };
  }, [column, sockets]);

  /** Gives a pane the keys; the column on `tab`, or the tab it showed last, or Files. */
  const enter = (pane: PaneFocus, tab?: string) => {
    if (pane === "column" && tab) showColumnTab(tab);
    else if (pane === "column" && columnTab === DETAILS) {
      const next = columnTabs.find((candidate) => candidate.id === lastProgramTab.current || (lastProgramTab.current === TERMINAL && candidate.kind === "terminal")) ?? programTabs[0];
      showColumnTab(next?.id ?? FILES);
    } else if (pane === "column") showColumnTab(columnTab);
    setTarget(pane);
    deps.focus(true);
  };
  /** Shows a column tab, showing the column for it if it was hidden. */
  const showColumnTab = (id: string) => {
    const terminalTab = tabs.find((candidate) => terminalTabId(candidate.terminalId) === id);
    if (terminalTab) setDrawer(terminalTab.threadId, { target: terminalTab, open: true });
    const next = terminalTab ? TERMINAL : id;
    setTab(next);
    if (next !== DETAILS) lastProgramTab.current = next;
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

  /** Shows a terminal, as a tab of the drawer or of the column; `focus` gives it the keys. */
  const showTerminal = (next: TerminalTarget, focus: boolean) => {
    setEnded((previous) => {
      const rest = new Set(previous);
      rest.delete(key(next));
      return rest;
    });
    setSeen((previous) => (previous.has(key(next)) ? previous : new Set(previous).add(key(next))));
    setDrawer(next.threadId, { target: next, open: true });
    if (side) showColumnTab(TERMINAL);
    if (!focus) return;
    setTarget(side ? "column" : "drawer");
    deps.focus(true);
  };
  const openTerminal = (next: TerminalTarget) => showTerminal(next, true);
  const hideTerminal = () => {
    if (!threadId || !drawer) return;
    setDrawer(threadId, { ...drawer, open: false });
    if (side) tabGone(editors.length + previews.length > 0);
  };
  const terminalShown = terminal !== null && (!side || (column && activeColumnTab.kind === "terminal"));
  /** ctrl+j: hides the terminal when it shows, or shows the last one, or finds one. */
  const toggleTerminal = () => {
    if (terminalShown) return hideTerminal();
    if (activeTerminal) return openTerminal(activeTerminal);
    deps.openTerminal();
  };
  const selectTab = (index: number) => {
    const next = tabs[index];
    if (next) showTerminal(next, false);
  };
  /** A terminal closed or exited: its tab goes, the next one shows, and the last takes the drawer with it. */
  const terminalEnded = (gone: TerminalTarget, note?: string) => {
    setEnded((previous) => new Set(previous).add(key(gone)));
    const next = tabs.find((candidate) => candidate.terminalId !== gone.terminalId);
    if (next) setDrawer(gone.threadId, { target: next, open: drawers.get(gone.threadId)?.open ?? true });
    else {
      setDrawers((previous) => {
        const rest = new Map(previous);
        rest.delete(gone.threadId);
        return rest;
      });
      if (side && gone.threadId === threadId) tabGone(editors.length + previews.length > 0);
    }
    if (note) say(note);
  };

  /** A file in $EDITOR, in a tab of its own in the column, with the keys. */
  const openEditor = (editor: EditorTab) => {
    setEditors((previous) => (previous.some((candidate) => candidate.program.id === editor.program.id) ? previous : [...previous, editor]));
    showColumnTab(editor.program.id);
    setTarget("column");
    deps.focus(true);
  };
  /** Another file went to an editor already running (Neovim's socket): its tab names it and takes the keys. */
  const editorOpened = (id: string, path: string) => {
    setEditors((previous) => previous.map((editor) => (editor.program.id === id ? { ...editor, path } : editor)));
    showColumnTab(id);
    setTarget("column");
    deps.focus(true);
  };
  const editorClosed = (id: string, note?: string) => {
    setEditors((previous) => previous.filter((editor) => editor.program.id !== id));
    tabGone(editors.length > 1 || previews.length > 0 || (side && terminal !== null));
    if (note) say(note);
  };
  /** A file read-only in a tab of its own in the column, with the keys. */
  const openPreview = (path: string, cwd: string) => {
    const id = `preview:${cwd}:${path}`;
    setPreviews((previous) => (previous.some((preview) => preview.id === id) ? previous : [...previous, { id, path, cwd }]));
    enter("column", id);
  };
  /** A preview closes back to Files, which it was opened from. */
  const closePreview = (id: string) => {
    setPreviews((previous) => previous.filter((preview) => preview.id !== id));
    if (columnTab === id) setTab(FILES);
  };
  /** The message in $EDITOR, in the composer's place. */
  const openMessage = (next: EditorProgram) => {
    setMessage(next);
    setTarget("message");
    deps.focus(true);
  };

  /** Asks an editor to quit: Neovim through its socket, where it asks about unsaved changes itself. Others would lose them, so no. */
  const quitEditor = (editor: EditorProgram, name: string, pane: PaneFocus) => {
    if (!editor.socket) return say(`Quit ${name} from inside it; closing it here could lose unsaved changes.`, true);
    enter(pane);
    void nvimQuit(editor.socket).then((sent) => sent === null && say(`Could not reach the editor for ${name}.`, true));
  };
  /** Closes a tab: a terminal after asking, an editor by asking it to quit. Details stays. */
  const closeTab = (id: string) => {
    const terminalTab = tabs.find((candidate) => candidate.terminalId === id || terminalTabId(candidate.terminalId) === id);
    if (terminalTab) return deps.closeTerminal(terminalTab);
    const editor = editors.find((candidate) => candidate.program.id === id);
    if (editor) return quitEditor(editor, basename(editor.path), "column");
    if (previews.some((preview) => preview.id === id)) closePreview(id);
  };
  const closeFocused = () => {
    if (focusedPane === "drawer" && terminal) return closeTab(terminal.terminalId);
    if (focusedPane === "column" && columnTab === FILES) return say("Files stays; d hides the column.", true);
    if (focusedPane === "column") return closeTab(columnTab);
    if (focusedPane === "message" && message) return quitEditor(message, "the message", "message");
    say(deps.detailsFocused ? "Details stays; d hides the column." : "No pane has the keys; ctrl+\\ tab moves them to one.", true);
  };

  /** The pane ctrl+\ ctrl+\ goes back to: the one that last had the keys, or the first that's open. */
  const last = ([target, ...PANE_ORDER] as const).find((pane) => open[pane]) ?? null;
  const toggle = () => {
    if (focused) return deps.focus(false);
    if (last) return enter(last);
    say("No pane is open; ctrl+j opens a terminal.");
  };
  /** Steps focus through the conversation and the open panes, in order. */
  const step = (by: 1 | -1) => {
    const ring: (PaneFocus | null)[] = [null, ...available];
    const next = ring[(ring.indexOf(focusedPane) + by + ring.length) % ring.length] ?? null;
    if (next) enter(next);
    else deps.focus(false);
  };
  const focusDrawer = () => {
    if (terminal) return side ? enter("column") : enter("drawer");
    toggleTerminal();
  };
  const focusColumn = () => enter("column");
  /** 1…9: a tab of the focused strip, the column's or else the drawer's. */
  const pickTab = (index: number) => {
    if (focusedPane !== "column" && !deps.detailsFocused) return selectTab(index);
    const next = columnTabs[index];
    if (next?.kind === "details") showColumnTab(next.id);
    else if (next) enter("column", next.id);
  };
  const toggleZoom = () => {
    if (zoomed) return setZoomed(null);
    const pane = focusedPane ?? (deps.detailsFocused ? "column" : last);
    if (!pane) return say("No pane is open to zoom.", true);
    if (!focusedPane && !deps.detailsFocused) enter(pane);
    setZoomed(pane);
  };

  const startPrefix = () => {
    if (prefixTimer.current) clearTimeout(prefixTimer.current);
    prefixTimer.current = setTimeout(() => setPrefix(false), PREFIX_MS);
    setPrefix(true);
  };
  const endPrefix = () => {
    if (prefixTimer.current) clearTimeout(prefixTimer.current);
    prefixTimer.current = null;
    setPrefix(false);
  };
  /** ctrl+\ takes the next key, wherever the keys are. */
  const prefixKey: Binding = { keys: ["ctrl+\\"], run: startPrefix, hint: "panes" };
  /** The keys after ctrl+\: any other key just cancels it. */
  const prefixKeys: Binding[] = keys(
    { keys: [], label: "ctrl+\\", hint: "…" },
    { keys: ["ctrl+\\"], run: toggle },
    { keys: ["tab"], run: () => step(1), hint: "next" },
    { keys: ["shift+tab"], run: () => step(-1) },
    { keys: ["j"], run: focusDrawer, hint: "drawer" },
    { keys: ["l"], run: focusColumn, hint: "column" },
    { keys: ["k", "h"], run: () => deps.focus(false) },
    { keys: [], label: "1-9", hint: "tab" },
    Array.from({ length: 9 }, (_, index): Binding => ({ keys: [`${index + 1}`], run: () => pickTab(index) })),
    { keys: ["x"], run: closeFocused, hint: "close" },
    { keys: ["z"], run: toggleZoom, hint: zoomed ? "unzoom" : "zoom" },
    { keys: ["n"], run: deps.newTerminal, hint: "new" },
    { keys: ["esc"], run: () => {}, hint: "cancel" },
  );
  /** Where the keys are, by name. */
  const focusedName = focusedPane === "message" ? "message" : focusedPane === "drawer" ? terminal?.label : focusedPane === "column" ? (activeColumnTab.kind === "editor" || activeColumnTab.kind === "preview" ? basename(activeColumnTab.label) : activeColumnTab.label) : undefined;
  /** The hint bar while a pane has the keys. */
  const focusedKeys: Binding[] = focusedName
    ? [
        { keys: [], label: "keys:", hint: focusedName },
        { keys: [], label: "ctrl+\\ ctrl+\\", run: toggle, hint: "leave" },
        { keys: [], label: "ctrl+\\", run: startPrefix, hint: "panes" },
      ]
    : [];
  /** Palette commands for what the prefix does. */
  const commands: Binding[] = keys(
    available.length > 0 && { keys: [], label: "ctrl+\\ tab", run: () => step(1), command: { id: "pane-next", title: "Pane: next", keywords: ["focus", "terminal", "editor", "switch"] } },
    (available.length > 0 || deps.detailsFocused) && { keys: [], label: "ctrl+\\ z", run: toggleZoom, command: { id: "pane-zoom", title: zoomed ? "Pane: unzoom" : "Pane: zoom", keywords: ["maximize", "fullscreen", "fill"] } },
  );

  return {
    terminal,
    tabs,
    activeTerminal,
    /** Terminals this run showed that still run, while the terminal is hidden. */
    running: terminal ? [] : tabs.filter((candidate) => seen.has(key(candidate))),
    editors,
    previews,
    modified,
    message,
    columnTabs,
    columnTab,
    /** What the column's shown tab is. */
    columnKind: activeColumnTab.kind,
    showColumnTab,
    focusedPane,
    /** Whether a terminal has the keys, in the drawer or the column. */
    terminalFocused: focusedPane === "drawer" || (focusedPane === "column" && activeColumnTab.kind === "terminal"),
    zoomed: zoomShown ? zoomed : null,
    prefix,
    endPrefix,
    enter,
    openTerminal,
    hideTerminal,
    toggleTerminal,
    selectTab,
    terminalEnded,
    closeTab,
    openEditor,
    editorOpened,
    editorClosed,
    openPreview,
    /** Shows Files and gives it the keys. */
    showFiles: () => enter("column", FILES),
    openMessage,
    messageClosed: () => setMessage(null),
    keys: { prefix: prefixKey, afterPrefix: prefixKeys, focused: focusedKeys, commands },
    /** Whether ctrl+\ has a pane to go to, for the hint. */
    any: available.length > 0,
  };
}
