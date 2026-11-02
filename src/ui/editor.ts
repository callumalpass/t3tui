import type { CliRenderer } from "@opentui/core";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Hands the terminal to $VISUAL or $EDITOR on a copy of `text` and returns what was saved,
 * or null if the editor failed. The renderer is suspended meanwhile.
 */
export function editInEditor(renderer: CliRenderer, text: string): string | null {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const dir = mkdtempSync(join(tmpdir(), "t3tui-"));
  const file = join(dir, "prompt.md");
  writeFileSync(file, text);
  renderer.suspend();
  try {
    // Through the shell, so EDITOR="code --wait" works.
    const result = spawnSync(process.env.SHELL || "sh", ["-c", `${editor} "$1"`, "sh", file], { stdio: "inherit" });
    if (result.status !== 0) return null;
    return readFileSync(file, "utf8").replace(/\n$/, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    renderer.resume();
    renderer.requestRender();
  }
}
