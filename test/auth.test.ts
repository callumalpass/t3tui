import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { t3Command } from "../src/client/auth.ts";

const appCopy = join(homedir(), ".t3", "bin", "t3");
const installerCopy = join(homedir(), ".local", "bin", "t3.cmd");

describe("t3Command", () => {
  const saved = { bin: process.env.T3TUI_T3_BIN, home: process.env.T3CODE_HOME };

  beforeEach(() => {
    delete process.env.T3TUI_T3_BIN;
    delete process.env.T3CODE_HOME;
  });

  afterEach(() => {
    delete process.env.T3TUI_T3_BIN;
    if (saved.bin !== undefined) process.env.T3TUI_T3_BIN = saved.bin;
    if (saved.home !== undefined) process.env.T3CODE_HOME = saved.home;
  });

  test("prefers the desktop app's copy, then the PATH", () => {
    expect(t3Command((path) => path === appCopy, () => "/usr/bin/t3")).toEqual([appCopy]);
    expect(t3Command((path) => path === "/usr/bin/t3", () => "/usr/bin/t3")).toEqual(["/usr/bin/t3"]);
  });

  test("runs where the Windows installer puts it, which needs cmd", () => {
    expect(t3Command((path) => path === installerCopy, () => null)).toEqual(["cmd.exe", "/c", "call", installerCopy]);
  });

  test("runs a .cmd on the PATH through cmd too", () => {
    const shim = "C:\\npm\\t3.CMD";
    expect(t3Command((path) => path === shim, () => shim)).toEqual(["cmd.exe", "/c", "call", shim]);
  });

  test("falls back to the bare name so the error names it", () => {
    expect(t3Command(() => false, () => null)).toEqual(["t3"]);
  });

  test("T3TUI_T3_BIN wins", () => {
    process.env.T3TUI_T3_BIN = "/opt/t3";
    expect(t3Command(() => true, () => "/usr/bin/t3")).toEqual(["/opt/t3"]);
  });
});
