import { describe, expect, test } from "bun:test";
import type { ProjectEntry } from "@t3tools/contracts";
import { homedir } from "node:os";

import type { ChangedFile } from "../src/model/details.ts";
import { fileRows, parentOf, previewKind, rootLabel, sizeLabel, type FileTreeInput } from "../src/model/files.ts";

const file = (path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry => ({ path, kind: "file", ...extra }) as ProjectEntry;
const folder = (path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry => ({ path, kind: "directory", ...extra }) as ProjectEntry;
const tree = (input: Partial<FileTreeInput>): FileTreeInput => ({ directories: new Map(), expanded: new Set(), loading: new Set(), ignored: new Set(), changes: [], ...input });
const change = (path: string, status: ChangedFile["status"]): ChangedFile => ({ path, status, insertions: status === "M" ? 1 : 0, deletions: 0 });
const names = (input: FileTreeInput) => fileRows(input).map((row) => (row.kind === "loading" ? `${"  ".repeat(row.depth)}…` : `${"  ".repeat(row.depth)}${row.name}`));

describe("fileRows", () => {
  const directories = new Map<string, readonly ProjectEntry[]>([
    ["", [file("b.md"), folder("src"), file("A.md"), folder(".git"), folder("docs")]],
    ["src", [file("src/z.ts"), folder("src/ui"), file("src/a.ts")]],
  ]);

  test("lists folders first, then files, by name whatever the case, and hides .git", () => {
    expect(names(tree({ directories }))).toEqual(["docs", "src", "A.md", "b.md"]);
  });

  test("shows an open folder's entries under it, or … while it lists", () => {
    expect(names(tree({ directories, expanded: new Set(["src"]) }))).toEqual(["docs", "src", "  ui", "  a.ts", "  z.ts", "A.md", "b.md"]);
    expect(names(tree({ directories, expanded: new Set(["docs"]), loading: new Set(["docs"]) }))).toEqual(["docs", "  …", "src", "A.md", "b.md"]);
  });

  test("marks changed files, untracked folders and everything in them, and folders with changes inside", () => {
    const changes = [change("src/a.ts", "M"), change("docs/", "?"), change("b.md", "?")];
    const rows = fileRows(tree({ directories: new Map([...directories, ["docs", [file("docs/new.md")]]]), expanded: new Set(["src", "docs"]), changes }));
    const row = (path: string) => rows.find((candidate) => candidate.path === path);
    expect(row("src/a.ts")).toMatchObject({ marker: "M" });
    expect(row("src/z.ts")).toMatchObject({ marker: null });
    expect(row("src")).toMatchObject({ marker: null, changedInside: true });
    expect(row("docs")).toMatchObject({ marker: "?", changedInside: false });
    expect(row("docs/new.md")).toMatchObject({ marker: "?" });
    expect(row("b.md")).toMatchObject({ marker: "?" });
  });

  test("counts as ignored what the listing says, what listIgnoredFiles names, and everything in an ignored folder", () => {
    const rows = fileRows(
      tree({
        directories: new Map([
          ["", [folder("dist", { ignored: true }), file("debug.log"), file("a.md")]],
          ["dist", [file("dist/out.js")]],
        ]),
        expanded: new Set(["dist"]),
        ignored: new Set(["debug.log"]),
      }),
    );
    expect(rows.map((row) => row.kind !== "loading" && [row.path, row.ignored])).toEqual([["dist", true], ["dist/out.js", true], ["a.md", false], ["debug.log", true]]);
  });
});

test("parentOf", () => {
  expect(parentOf("src/ui/a.ts")).toBe("src/ui");
  expect(parentOf("a.ts")).toBe("");
});

test("previewKind goes by extension", () => {
  expect(previewKind("docs/README.md")).toBe("markdown");
  expect(previewKind("logo.PNG")).toBe("image");
  expect(previewKind("src/a.ts")).toBe("code");
  expect(previewKind("Makefile")).toBe("code");
});

test("rootLabel shortens the home folder, then cuts from the middle", () => {
  expect(rootLabel(`${homedir()}/projects/t3tui`, 40)).toBe("~/projects/t3tui");
  expect(rootLabel(`${homedir()}/projects/deeply/nested/t3tui`, 12)).toBe("~/…/t3tui");
  expect(rootLabel("/srv/work/project", 12)).toBe("…/project");
});

test("sizeLabel", () => {
  expect(sizeLabel(512)).toBe("512 B");
  expect(sizeLabel(3 * 1024)).toBe("3 KB");
  expect(sizeLabel(5.5 * 1024 * 1024)).toBe("5.5 MB");
});
