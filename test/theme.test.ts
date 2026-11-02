import { afterEach, expect, test } from "bun:test";

import { applyTheme, colors, statusColor, toneColor } from "../src/ui/theme.ts";

afterEach(() => applyTheme("dark"));

test("the light palette replaces every colour, and the tone maps follow it", () => {
  const dark = { ...colors };
  applyTheme("light");
  for (const key of Object.keys(dark) as (keyof typeof dark)[]) expect(colors[key]).not.toBe(dark[key]);
  expect(statusColor("bad")).toBe(colors.bad);
  expect(toneColor("normal")).toBe(colors.text);
  applyTheme("dark");
  expect(colors).toEqual(dark);
});
