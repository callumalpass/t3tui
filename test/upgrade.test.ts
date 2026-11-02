import { expect, test } from "bun:test";

import { assetName, checksumFor, isCompiled } from "../src/upgrade.ts";

test("names the release asset for a platform", () => {
  expect(assetName("darwin", "arm64")).toBe("t3tui-darwin-arm64");
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
