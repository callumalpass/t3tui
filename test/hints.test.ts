import { describe, expect, test } from "bun:test";

import { hintKey } from "../src/model/hints.ts";

describe("clickable key hints", () => {
  test("single keys, shifted keys and ctrl chords", () => {
    expect(hintKey("y approve", "nav")).toEqual({ name: "y", sequence: "y", shift: false, ctrl: false });
    expect(hintKey("Y always", "nav")).toEqual({ name: "y", sequence: "Y", shift: true, ctrl: false });
    expect(hintKey("ctrl+k commands", "nav")).toEqual({ name: "k", sequence: "\x0b", shift: false, ctrl: true });
    expect(hintKey("esc close", "palette")?.name).toBe("escape");
    expect(hintKey(". actions", "nav")?.name).toBe(".");
    expect(hintKey("/ filter", "nav")?.name).toBe("/");
  });

  test("choices of keys, ranges and sending chords stay text", () => {
    expect(hintKey("j/k threads", "nav")).toBeNull();
    expect(hintKey("ctrl+n/p thread", "input")).toBeNull();
    expect(hintKey("1-9 pick", "nav")).toBeNull();
    expect(hintKey("alt+enter steer", "input")).toBeNull();
    expect(hintKey("alt+↑ edit queued", "input")).toBeNull();
    expect(hintKey("shift+enter or \\ newline", "input")).toBeNull();
    expect(hintKey("enter send", "input")).toBeNull();
    expect(hintKey("enter confirm", "confirm")?.name).toBe("return");
  });
});
