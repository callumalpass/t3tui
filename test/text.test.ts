import { describe, expect, test } from "bun:test";

import { firstLine, truncate, truncateNumbered, truncatePath } from "../src/ui/text.ts";

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

describe("truncatePath", () => {
  test("keeps the first folder and the file name, dropping the middle", () => {
    expect(truncatePath("src/ui/TerminalPane.tsx", 40)).toBe("src/ui/TerminalPane.tsx");
    expect(truncatePath("src/ui/deep/er/TerminalPane.tsx", 22)).toBe("src/…/TerminalPane.tsx");
  });

  test("keeps the end of a name too long for that", () => {
    expect(truncatePath("src/ui/TerminalPane.tsx", 8)).toBe("…ane.tsx");
    expect(truncatePath("averyveryverylongname.ts", 10)).toBe("…ngname.ts");
  });
});

describe("truncateNumbered", () => {
  test("keeps the number at the end", () => {
    expect(truncateNumbered("Terminal 12", 20)).toBe("Terminal 12");
    expect(truncateNumbered("Terminal 2", 7)).toBe("Term… 2");
    expect(truncateNumbered("Scratch", 4)).toBe("Scr…");
  });
});
