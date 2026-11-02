import type { CliRenderer } from "@opentui/core";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** $VISUAL or $EDITOR (falling back to vi) on `file`, through the shell so EDITOR="code --wait" works. */
export function editorCommand(file: string): string[] {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  return [process.env.SHELL || "sh", "-c", `${editor} "$1"`, "sh", file];
}

/** A scratch copy of `text` to edit: `read` returns what was saved, `remove` cleans up. */
export function scratchFile(text: string): { readonly path: string; readonly read: () => string; readonly remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "t3tui-"));
  const path = join(dir, "prompt.md");
  writeFileSync(path, text);
  return { path, read: () => readFileSync(path, "utf8").replace(/\n$/, ""), remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Hands the terminal to $VISUAL or $EDITOR on a copy of `text` and returns what was saved,
 * or null if the editor failed. The renderer is suspended meanwhile.
 */
export async function editInEditor(renderer: CliRenderer, text: string): Promise<string | null> {
  const file = scratchFile(text);
  await renderer.suspend();
  try {
    const [command, ...args] = editorCommand(file.path);
    const result = spawnSync(command!, args, { stdio: "inherit" });
    if (result.status !== 0) return null;
    return file.read();
  } finally {
    file.remove();
    await renderer.resume();
    renderer.requestRender();
  }
}
