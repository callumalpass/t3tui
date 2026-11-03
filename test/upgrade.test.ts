import { expect, test } from "bun:test";

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assetName, checksumFor, isCompiled, isEmbeddedPath, removeOldBinaries, replaceBinary } from "../src/upgrade.ts";

test("names the release asset for a platform", () => {
  expect(assetName("darwin", "arm64")).toBe("t3tui-darwin-arm64");
  expect(assetName("win32", "x64")).toBe("t3tui-windows-x64.exe");
});

test("knows Bun's embedded filesystem on every platform", () => {
  expect(isEmbeddedPath("/$bunfs/root/t3tui-linux-x64")).toBe(true);
  expect(isEmbeddedPath("B:\\~BUN\\root\\t3tui-windows-x64.exe")).toBe(true);
  expect(isEmbeddedPath("B:/~BUN/root/t3tui-windows-x64.exe")).toBe(true);
  expect(isEmbeddedPath("/home/me/t3tui/src/upgrade.ts")).toBe(false);
  expect(isEmbeddedPath("C:\\t3tui\\src\\upgrade.ts")).toBe(false);
});

test("on Windows, moves the old binary aside and removes it on the next start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t3tui-upgrade-"));
  const target = join(dir, "t3tui.exe");
  writeFileSync(target, "old");
  writeFileSync(join(dir, "notes.txt"), "mine");
  await replaceBinary(target, new TextEncoder().encode("new"), "win32");
  expect(readFileSync(target, "utf8")).toBe("new");
  expect(readdirSync(dir).filter((name) => name.includes(".old-"))).toHaveLength(1);
  removeOldBinaries(target);
  expect(readdirSync(dir).sort()).toEqual(["notes.txt", "t3tui.exe"]);
});

test("elsewhere, renames straight over the binary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t3tui-upgrade-"));
  const target = join(dir, "t3tui");
  writeFileSync(target, "old");
  await replaceBinary(target, new TextEncoder().encode("new"), "linux");
  expect(readFileSync(target, "utf8")).toBe("new");
  expect(readdirSync(dir)).toEqual(["t3tui"]);
  expect(existsSync(`${target}.upgrade-${process.pid}`)).toBe(false);
});

test("reads a hash from a sha256sum listing", () => {
  const sums = "aaa  t3tui-linux-x64.gz\nbbb *t3tui-darwin-arm64.gz\n";
  expect(checksumFor(sums, "t3tui-linux-x64.gz")).toBe("aaa");
  expect(checksumFor(sums, "t3tui-darwin-arm64.gz")).toBe("bbb");
  expect(checksumFor(sums, "t3tui-linux-arm64.gz")).toBeUndefined();
});

test("knows it's running from source", () => {
  expect(isCompiled()).toBe(false);
});
