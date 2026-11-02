import { expect, test } from "bun:test";
import { parsePatch } from "diff";
import { splitPatch, wholeFilePatch } from "../src/model/diffs.ts";

const changed = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2 +2 @@\n-old\n+new\n";

test("diff files retain old paths and change types for contents requests", () => {
  const renamed = "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n";
  const deleted = "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n";
  const added = "diff --git a/add.ts b/add.ts\nnew file mode 100644\n--- /dev/null\n+++ b/add.ts\n@@ -0,0 +1 @@\n+added\n";
  const files = splitPatch(`${changed}${renamed}${deleted}${added}`);
  expect(files.map(({ path, oldPath, changeType }) => ({ path, oldPath, changeType }))).toEqual([
    { path: "a.ts", oldPath: "a.ts", changeType: "change" }, { path: "new.ts", oldPath: "old.ts", changeType: "rename-pure" },
    { path: "gone.ts", oldPath: "gone.ts", changeType: "deleted" }, { path: "add.ts", oldPath: "add.ts", changeType: "new" },
  ]);
});

test("whole-file expansion preserves unchanged context on both sides of the hunk", () => {
  const patch = wholeFilePatch(splitPatch(changed)[0]!, { oldContents: "before\nold\nafter\n", newContents: "before\nnew\nafter\n" });
  expect(parsePatch(patch)[0]?.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" before", "-old", "+new", " after"] });
});

test("truncated patches keep their file identity without parsing an incomplete hunk", () => {
  expect(splitPatch(changed.slice(0, -4))[0]?.path).toBe("a.ts");
  expect(splitPatch("diff --git a/a.ts b/a.ts\n--- a/a.ts\n")[0]?.path).toBe("a.ts");
});

test("whole-file expansion can show a pure rename with identical contents", () => {
  const file = splitPatch("diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n")[0]!;
  const patch = wholeFilePatch(file, { oldContents: "unchanged\n", newContents: "unchanged\n" });
  expect(parsePatch(patch)[0]?.hunks[0]?.lines).toEqual([" unchanged"]);
});
