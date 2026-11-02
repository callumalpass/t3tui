import { describe, expect, test } from "bun:test";

import { isWebUrl, pathAt } from "../src/model/links.ts";

const at = (text: string, word: string) => pathAt(text, text.indexOf(word));

describe("paths in text", () => {
  test("a click anywhere in a path finds the whole path", () => {
    const text = "I changed src/ui/App.tsx and test/app.test.tsx.";
    expect(at(text, "src")).toBe("src/ui/App.tsx");
    expect(at(text, "App")).toBe("src/ui/App.tsx");
    expect(at(text, "app.test")).toBe("test/app.test.tsx");
  });

  test("line numbers and leading dots are path syntax", () => {
    expect(at("see ./bin.ts:12:4 for it", "bin")).toBe("./bin.ts");
    expect(at("in ../shared/x.ts, line 3", "shared")).toBe("../shared/x.ts");
    expect(at("open ~/notes.md now", "notes")).toBe("~/notes.md");
    expect(at("(README.md)", "README")).toBe("README.md");
  });

  test("words, URLs and punctuation are not paths", () => {
    expect(at("the build is done", "build")).toBeNull();
    expect(at("see https://example.com/a.html", "example")).toBeNull();
    expect(at("see https://example.com/a.html", "https")).toBeNull();
    expect(at("a, b", ",")).toBeNull();
    expect(at("version 1.2", "1.2")).toBeNull();
  });

  test("web links open in the browser; file: links and bare targets are files", () => {
    expect(isWebUrl("https://example.com")).toBe(true);
    expect(isWebUrl("mailto:me@example.com")).toBe(true);
    expect(isWebUrl("file:///tmp/a.ts")).toBe(false);
    expect(isWebUrl("src/ui/App.tsx")).toBe(false);
  });
});
