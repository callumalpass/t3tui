import { describe, expect, test } from "bun:test";

import { firstLine, truncate } from "../src/ui/text.ts";

describe("truncate", () => {
  test("collapses whitespace and clips with an ellipsis", () => {
    expect(truncate("a  b\nc", 10)).toBe("a b c");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abcdef", 0)).toBe("…");
  });

  test("keeps leading whitespace collapsed to one space", () => {
    // The majority of the old copies did not trim; only QueuePanel's did.
    expect(truncate("  hi", 10)).toBe(" hi");
  });
});

describe("firstLine", () => {
  test("takes the first trimmed line, collapsed", () => {
    expect(firstLine("  hello   world\nsecond line")).toBe("hello world");
    expect(firstLine("")).toBe("");
  });

  test("caps at 100 characters", () => {
    const long = "x".repeat(150);
    expect(firstLine(long)).toBe(`${"x".repeat(99)}…`);
  });
});
