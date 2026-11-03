import type { CliRenderer } from "@opentui/core";

import { browserCommand } from "../model/links.ts";

/** Opens a web link in the desktop's browser; `fail` hears why it couldn't, as over SSH. */
export function openInBrowser(url: string, fail: (reason: string) => void): void {
  try {
    const command = browserCommand(url);
    // The environment as it is now: Bun otherwise looks the opener up on the PATH it started with.
    const child = Bun.spawn(command, { env: process.env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    void child.exited.then((code) => {
      if (code !== 0) fail(`${command[0]} exited with ${code}`);
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/** The screen row `y` as drawn, and the index in it of the character in column `x`. */
export function screenTextAt(renderer: CliRenderer, x: number, y: number): { readonly text: string; readonly index: number } | null {
  const row = new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true)).split("\n")[y];
  if (row === undefined) return null;
  // Wide characters take two columns but one place in the text.
  let column = 0;
  let index = 0;
  for (const char of row) {
    column += Bun.stringWidth(char);
    if (column > x) return { text: row, index };
    index += char.length;
  }
  return null;
}
