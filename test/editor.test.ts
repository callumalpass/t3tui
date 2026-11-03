import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { isNvim, scratchFile, windowsCommand, windowsWords } from "../src/ui/editor.ts";

test("splits a Windows command line on spaces outside quotes", () => {
  expect(windowsWords('"C:\\Program Files\\Git\\usr\\bin\\vim.exe" -p')).toEqual(["C:\\Program Files\\Git\\usr\\bin\\vim.exe", "-p"]);
  expect(windowsWords("code --wait")).toEqual(["code", "--wait"]);
});

test("runs a .cmd through cmd, and anything else as it is", () => {
  const which = (program: string) => ({ code: "C:\\VS Code\\bin\\code.cmd", nvim: "C:\\nvim\\nvim.exe" })[program] ?? null;
  expect(windowsCommand("code --wait", which)).toEqual(["cmd.exe", "/c", "call", "C:\\VS Code\\bin\\code.cmd", "--wait"]);
  expect(windowsCommand("nvim", which)).toEqual(["C:\\nvim\\nvim.exe"]);
  expect(windowsCommand("missing", which)).toEqual(["missing"]);
});

test("knows Neovim by name or path", () => {
  expect(isNvim("nvim")).toBe(true);
  expect(isNvim("/usr/bin/nvim")).toBe(true);
  expect(isNvim("C:\\Program Files\\Neovim\\bin\\nvim.exe")).toBe(true);
  expect(isNvim("vim")).toBe(false);
});

test("reads back a scratch file saved with CRLF", () => {
  const file = scratchFile("");
  writeFileSync(file.path, "one\r\ntwo\r\n");
  expect(file.read()).toBe("one\ntwo");
  file.remove();
});
