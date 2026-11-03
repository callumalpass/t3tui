import { describe, expect, test } from "bun:test";

import { browserCommand, isWebUrl, pathAt } from "../src/model/links.ts";

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

describe("on Windows", () => {
  test("finds paths with backslashes and drives", () => {
    const text = "see src\\ui\\App.tsx:12 and C:\\Users\\me\\notes.md, or ..\\a.ts";
    expect(pathAt(text, text.indexOf("App"), "win32")).toBe("src\\ui\\App.tsx");
    expect(pathAt(text, text.indexOf("Users"), "win32")).toBe("C:\\Users\\me\\notes.md");
    expect(pathAt(text, text.indexOf("a.ts"), "win32")).toBe("..\\a.ts");
  });

  test("leaves URLs and line numbers alone", () => {
    expect(pathAt("https://example.com/a", 12, "win32")).toBeNull();
    expect(pathAt("at a:b/c.ts", 8, "win32")).toBeNull();
  });

  test("backslashes are not path characters elsewhere", () => {
    expect(pathAt("src\\ui\\App.tsx", 8, "linux")).toBe("App.tsx");
  });
});

test("opens the browser the platform's way, past cmd's reach on Windows", () => {
  const url = "https://example.com/?a=1&b=2";
  expect(browserCommand(url, "linux")).toEqual(["xdg-open", url]);
  expect(browserCommand(url, "darwin")).toEqual(["open", url]);
  expect(browserCommand(url, "win32")).toEqual(["rundll32.exe", "url.dll,FileProtocolHandler", url]);
});
