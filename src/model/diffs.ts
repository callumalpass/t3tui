import { createTwoFilesPatch, parsePatch } from "diff";
import type { ReviewDiffFileContentsInput } from "@t3tools/contracts";

export interface PatchFile {
  readonly path: string;
  readonly oldPath: string;
  readonly changeType: ReviewDiffFileContentsInput["changeType"];
  readonly patch: string;
}

/** Retains both paths so renamed and deleted files expand against the right revisions. */
export function splitPatch(patch: string): PatchFile[] {
  return patch.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git ")).map((chunk) => {
    let parsed: ReturnType<typeof parsePatch>[number] | undefined;
    try { parsed = parsePatch(chunk.split(/^@@ /m)[0]!)[0]; } catch { /* A truncated preview can end inside a file header. */ }
    const oldPath = cleanPath(parsed?.oldFileName ?? /^diff --git a\/(.+?) b\//.exec(chunk)?.[1] ?? "file");
    const newPath = cleanPath(parsed?.newFileName ?? oldPath);
    const renamed = /^rename from /m.test(chunk);
    return { path: newPath === "/dev/null" ? oldPath : newPath, oldPath: oldPath === "/dev/null" ? newPath : oldPath,
      changeType: parsed?.isCreate || oldPath === "/dev/null" ? "new" : parsed?.isDelete || newPath === "/dev/null" ? "deleted" : renamed ? /^@@ /m.test(chunk) ? "rename-changed" : "rename-pure" : "change", patch: chunk };
  });
}

function cleanPath(path: string): string {
  return path.replace(/^[ab]\//, "");
}

/** The same unified renderer can show all unchanged lines after loading both file versions. */
export function wholeFilePatch(file: PatchFile, contents: { readonly oldContents: string; readonly newContents: string }): string {
  const patch = createTwoFilesPatch(file.oldPath, file.path, contents.oldContents, contents.newContents, undefined, undefined, { context: Infinity });
  if (contents.oldContents !== contents.newContents || contents.newContents.length === 0) return patch;
  const lines = contents.newContents.replace(/\n$/, "").split("\n");
  return `${patch}@@ -1,${lines.length} +1,${lines.length} @@\n${lines.map((line) => ` ${line}`).join("\n")}\n`;
}
