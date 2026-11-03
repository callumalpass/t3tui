import type { CliRenderer } from "@opentui/core";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const editorSetting = () => process.env.VISUAL || process.env.EDITOR || "vi";
const shell = () => process.env.SHELL || "sh";
/** The editor's program, without its arguments. */
const editorProgram = () => editorSetting().trim().split(/\s+/)[0] ?? "vi";

/**
 * $VISUAL or $EDITOR (falling back to vi) on `file`, through the shell so EDITOR="code --wait" works.
 * With `listen`, Neovim serves that socket, so more files can go to it (see nvimRemote).
 */
export function editorCommand(file: string, listen?: string): string[] {
  const editor = editorSetting();
  return listen ? [shell(), "-c", `${editor} --listen "$2" "$1"`, "sh", file, listen] : [shell(), "-c", `${editor} "$1"`, "sh", file];
}

/** Whether the editor is Neovim, which can take more files and be asked to quit through a socket. */
export const editorIsNvim = () => basename(editorProgram()) === "nvim";

/** A socket for a Neovim started here, in a temp folder of its own (`remove` cleans up). Kept short: sockets have a length limit. */
export function nvimSocket(): { readonly path: string; readonly remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "t3tui-nvim-"));
  return { path: join(dir, "nvim.sock"), remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Asks the Neovim on `socket` for something: `["--remote-expr", expr]` or `["--remote-send", keys]`.
 * Resolves to what it printed, or null if it couldn't be reached. Unlike `--remote`, these
 * never fall back to editing in a Neovim of their own.
 */
export async function nvimRemote(socket: string, args: readonly string[]): Promise<string | null> {
  const child = Bun.spawn([shell(), "-c", `${editorProgram()} --server "$@"`, "sh", socket, ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return code === 0 ? output : null;
}

/** Opens `file` in the Neovim on `socket`, in its current window. */
export const nvimOpen = (socket: string, file: string) => nvimRemote(socket, ["--remote-expr", `execute('drop ' .. fnameescape(${vimString(file)}))`]);
/** Asks the Neovim on `socket` to quit; it asks about unsaved changes itself. */
export const nvimQuit = (socket: string) => nvimRemote(socket, ["--remote-send", "<C-\\><C-N>:confirm qa<CR>"]);
/** Whether the Neovim on `socket` has unsaved changes; null if it couldn't be reached. */
export const nvimModified = async (socket: string) => {
  const count = await nvimRemote(socket, ["--remote-expr", "len(getbufinfo({'bufmodified': 1}))"]);
  return count === null ? null : Number.parseInt(count, 10) > 0;
};

const vimString = (text: string) => `'${text.replaceAll("'", "''")}'`;

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
