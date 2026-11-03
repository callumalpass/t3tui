import type { ProjectEntry } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import type { T3Session } from "../client/session.ts";
import type { ChangedFile } from "../model/details.ts";
import { fileRows, parentOf } from "../model/files.ts";
import { keys } from "../model/keymap.ts";

/** As many results as the web's file search shows. */
const SEARCH_LIMIT = 200;
/** Re-lists after a burst of changes settle. */
const REFRESH_DELAY_MS = 300;

/** A workspace's tree as this run has seen it: the folders listed, which are open, and the selection. */
interface Workspace {
  readonly directories: ReadonlyMap<string, readonly ProjectEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly ignored: ReadonlySet<string>;
  readonly selected: string | null;
}
const EMPTY: Workspace = { directories: new Map(), expanded: new Set(), ignored: new Set(), selected: null };

export interface FileSearch {
  readonly query: string;
  /** The query line has the keys. */
  readonly editing: boolean;
  /** null while the search runs. */
  readonly results: readonly ProjectEntry[] | null;
  readonly selected: number;
}

/**
 * The Files tab: the workspace's folders listed lazily as they open, with git's marks and
 * ignored entries, a `/` search over the workspace, and the keys that open, preview, mention
 * and copy what's selected. Each workspace keeps its tree for the run.
 */
export function useFiles(deps: {
  readonly session: T3Session;
  readonly live: boolean;
  /** The thread's worktree, else its project's root. */
  readonly cwd: string | null;
  /** The tab is on screen: the root lists the first time it is. */
  readonly visible: boolean;
  /** The working tree's changes, as the Changes list has them. */
  readonly changes: readonly ChangedFile[];
  /** A turn runs; one finishing re-lists the open folders. */
  readonly working: boolean;
  /** The server answers listIgnoredFiles. */
  readonly ignoredListing: boolean;
  readonly open: (path: string) => void;
  readonly preview: (path: string) => void;
  readonly mention: (path: string, kind: ProjectEntry["kind"]) => void;
  readonly copy: (path: string) => void;
  /** Gives the keys back. */
  readonly leave: () => void;
  readonly say: (text: string, bad?: boolean) => void;
}) {
  const { session, cwd, visible, live, say } = deps;
  const [workspaces, setWorkspaces] = useState<ReadonlyMap<string, Workspace>>(new Map());
  /** Folders being listed, as `cwd\0path`. */
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [rootError, setRootError] = useState<{ readonly cwd: string; readonly message: string } | null>(null);
  const [search, setSearch] = useState<FileSearch | null>(null);
  const workspace = (cwd ? workspaces.get(cwd) : undefined) ?? EMPTY;
  const update = (at: string, change: (previous: Workspace) => Workspace) => setWorkspaces((previous) => new Map(previous).set(at, change(previous.get(at) ?? EMPTY)));
  const inFlight = useRef(new Set<string>());

  const list = (at: string, path: string) => {
    const key = `${at}\0${path}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setLoading((previous) => new Set(previous).add(key));
    session.listEntries(at, path).then(
      (entries) => {
        // A folder's listing can include deeper paths; this one shows its own children.
        update(at, (previous) => ({ ...previous, directories: new Map(previous.directories).set(path, entries.filter((entry) => parentOf(entry.path) === path)) }));
        if (path === "") setRootError(null);
      },
      (error) => (path === "" ? setRootError({ cwd: at, message: messageOf(error) }) : say(`Could not list ${path}: ${messageOf(error)}`, true)),
    ).finally(() => {
      inFlight.current.delete(key);
      setLoading((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    });
  };
  const listIgnored = (at: string) => {
    if (!deps.ignoredListing) return;
    session.listIgnoredFiles(at).then(
      (files) => update(at, (previous) => ({ ...previous, ignored: new Set(files.map((file) => file.path)) })),
      () => {},
    );
  };
  /** Lists again the root and every open folder that's listed, and what git ignores. */
  const refresh = () => {
    if (!cwd) return;
    for (const path of ["", ...workspace.expanded]) if (path === "" || workspace.directories.has(path)) list(cwd, path);
    listIgnored(cwd);
    if (search?.query.trim()) runSearch(search.query);
  };

  // The root lists the first time the tab shows for a workspace; after that, showing it re-lists.
  const listed = cwd !== null && workspace.directories.has("");
  useEffect(() => {
    if (!visible || !cwd || !live) return;
    if (!listed) {
      list(cwd, "");
      listIgnored(cwd);
    } else refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs as the tab shows, or the workspace changes.
  }, [visible, cwd, live]);
  // A turn finishing, or git's changes moving, re-lists the open folders while the tab shows.
  const changesKey = deps.changes.map((file) => `${file.status}${file.path}`).join("\n");
  const settled = useRef({ changesKey, working: deps.working });
  useEffect(() => {
    const previous = settled.current;
    settled.current = { changesKey, working: deps.working };
    if (!visible || !listed || (previous.changesKey === changesKey && !(previous.working && !deps.working))) return;
    const timer = setTimeout(refresh, REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the changes or the turn do.
  }, [changesKey, deps.working]);

  const rows = useMemo(
    () =>
      fileRows({
        directories: workspace.directories,
        expanded: workspace.expanded,
        loading: new Set([...loading].flatMap((key) => (cwd && key.startsWith(`${cwd}\0`) ? [key.slice(cwd.length + 1)] : []))),
        ignored: workspace.ignored,
        changes: deps.changes,
      }),
    [workspace, loading, cwd, deps.changes],
  );
  const entries = rows.filter((row) => row.kind !== "loading");
  const selectedIndex = Math.max(0, entries.findIndex((row) => row.path === workspace.selected));
  const selected = entries[selectedIndex];

  const select = (path: string) => cwd && update(cwd, (previous) => ({ ...previous, selected: path }));
  const setExpanded = (path: string, open: boolean) => {
    if (!cwd) return;
    update(cwd, (previous) => {
      const expanded = new Set(previous.expanded);
      if (open) expanded.add(path);
      else expanded.delete(path);
      return { ...previous, expanded };
    });
    if (open && !workspace.directories.has(path)) list(cwd, path);
  };
  const move = (delta: number) => {
    const next = entries[Math.max(0, Math.min(entries.length - 1, selectedIndex + delta))];
    if (next) select(next.path);
  };
  /** l: opens a folder, or steps into one already open; opens a file. */
  const forward = () => {
    if (!selected) return;
    if (selected.kind === "file") return deps.open(selected.path);
    if (!selected.expanded) return setExpanded(selected.path, true);
    const child = entries[selectedIndex + 1];
    if (child && parentOf(child.path) === selected.path) select(child.path);
  };
  /** h: closes a folder, or goes to the folder it's in. */
  const back = () => {
    if (!selected) return;
    if (selected.kind === "directory" && selected.expanded) return setExpanded(selected.path, false);
    const parent = parentOf(selected.path);
    if (parent) select(parent);
  };
  /** A click: selects, opens or closes a folder, and opens a file already selected. */
  const click = (path: string) => {
    const row = entries.find((candidate) => candidate.path === path);
    if (!row) return;
    const wasSelected = selected?.path === path;
    select(path);
    if (row.kind === "directory") setExpanded(path, !row.expanded);
    else if (wasSelected) deps.open(path);
  };

  // Search: debounced as the composer's @ search is.
  const runSearch = (query: string) => {
    const at = cwd;
    if (!at) return;
    session.searchEntries(at, query.trim(), SEARCH_LIMIT).then(
      (results) => setSearch((previous) => (previous?.query === query ? { ...previous, results: results.filter((entry) => !entry.path.split("/").includes(".git")) } : previous)),
      (error) => {
        setSearch((previous) => (previous?.query === query ? { ...previous, results: [] } : previous));
        say(`Search failed: ${messageOf(error)}`, true);
      },
    );
  };
  useEffect(() => setSearch(null), [cwd]);
  const query = search?.query ?? "";
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => runSearch(query), 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs as the query changes.
  }, [query, cwd]);
  const onQuery = (value: string) => setSearch((previous) => ({ query: value, editing: previous?.editing ?? true, results: value.trim() ? null : [], selected: 0 }));
  const results = search?.results ?? [];
  const result = results[Math.min(search?.selected ?? 0, results.length - 1)];
  const moveResult = (delta: number) => setSearch((previous) => previous && { ...previous, selected: Math.max(0, Math.min(results.length - 1, previous.selected + delta)) });
  const clearSearch = () => setSearch(null);
  /** A folder found by search shows in the tree, open, its parents open above it. */
  const reveal = (path: string) => {
    if (!cwd) return;
    const parts = path.split("/");
    const folders = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    update(cwd, (previous) => ({ ...previous, expanded: new Set([...previous.expanded, ...folders]), selected: path }));
    for (const folder of folders) if (!workspace.directories.has(folder)) list(cwd, folder);
    clearSearch();
  };
  const openResult = (entry: ProjectEntry | undefined) => {
    if (!entry) return;
    if (entry.kind === "directory") return reveal(entry.path);
    setSearch((previous) => previous && { ...previous, editing: false });
    deps.open(entry.path);
  };

  const target = search ? result : selected;
  const mention = () => target && deps.mention(target.path, target.kind);
  const copy = () => target && deps.copy(target.path);
  const preview = () => target?.kind === "file" && deps.preview(target.path);
  const startSearch = () => setSearch((previous) => ({ query: previous?.query ?? "", editing: true, results: previous?.results ?? [], selected: previous?.selected ?? 0 }));

  /** While the query line has the keys: what it doesn't type. */
  const searchKeys = keys(
    { keys: ["↓", "ctrl+n"], label: "↑/↓", run: () => moveResult(1), hint: "move" },
    { keys: ["↑", "ctrl+p"], run: () => moveResult(-1) },
    // The query line's own submit opens it.
    { keys: [], label: "enter", hint: "open" },
    { keys: ["tab"], run: () => setSearch((previous) => previous && { ...previous, editing: false }), hint: "results" },
    { keys: ["esc"], run: clearSearch, hint: "clear" },
  );
  /** While the results have the keys. */
  const resultKeys = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => moveResult(1), hint: "move" },
    { keys: ["k", "↑"], run: () => moveResult(-1) },
    { keys: ["enter", "l", "→"], run: () => openResult(result), hint: "open" },
    { keys: ["m"], run: mention, hint: "mention" },
    { keys: ["y"], run: copy, hint: "copy path" },
    { keys: ["p"], run: preview, hint: "preview" },
    { keys: ["/"], run: startSearch, hint: "search" },
    { keys: ["g"], run: () => moveResult(-results.length) },
    { keys: ["G"], run: () => moveResult(results.length) },
    { keys: ["esc"], run: clearSearch, hint: "clear" },
  );
  const treeKeys = keys(
    { keys: ["j", "↓"], label: "j/k", run: () => move(1), hint: "move" },
    { keys: ["k", "↑"], run: () => move(-1) },
    { keys: ["l", "enter", "→"], run: forward, hint: "open" },
    { keys: ["h", "←"], run: back },
    { keys: ["/"], run: startSearch, hint: "search" },
    { keys: ["m"], run: mention, hint: "mention" },
    { keys: ["y"], run: copy, hint: "copy path" },
    { keys: ["p"], run: preview, hint: "preview" },
    { keys: ["r"], run: refresh, hint: "refresh" },
    { keys: ["g"], run: () => move(-entries.length) },
    { keys: ["G"], run: () => move(entries.length) },
    { keys: ["esc"], run: deps.leave, hint: "back" },
  );

  return {
    rows,
    selected: selected?.path ?? null,
    search,
    loadingRoot: !listed && cwd !== null && (loading.has(`${cwd}\0`) || !rootError),
    error: rootError?.cwd === cwd ? rootError.message : null,
    click,
    onQuery,
    /** Enter in the query line: opens the highlighted result. */
    submit: () => openResult(result),
    /** A click on a search result: selects it, or opens it once selected. */
    clickResult: (index: number) => {
      if (index === search?.selected && !search.editing) return openResult(results[index]);
      setSearch((previous) => previous && { ...previous, editing: false, selected: index });
    },
    keys: search?.editing ? searchKeys : search ? resultKeys : treeKeys,
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
