import { afterEach, expect, test } from "bun:test";

import { applyTheme, colors, statusColor, terminalPalette, themeModeOf, toneColor } from "../src/ui/theme.ts";

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

const terminal = (background: string | null, foreground: string | null, palette: (string | null)[] = []) =>
  ({ palette, defaultForeground: foreground, defaultBackground: background, cursorColor: null, mouseForeground: null, mouseBackground: null, tekForeground: null, tekBackground: null, highlightBackground: null, highlightForeground: null }) as const;
const ansi = ["#000000", "#cc0000", "#00aa00", "#aaaa00", "#0000cc", "#aa00aa", "#00aaaa", "#cccccc", "#555555", "#ff5555", "#55ff55", "#ffff55", "#5555ff", "#ff55ff", "#55ffff", "#ffffff"];

test("auto reads dark or light from the terminal's background, and nothing without one", () => {
  expect(themeModeOf(terminal("#1d1f21", "#c5c8c6"))).toBe("dark");
  expect(themeModeOf(terminal("#fdf6e3", "#657b83"))).toBe("light");
  expect(themeModeOf(terminal(null, null))).toBeNull();
  expect(themeModeOf(null)).toBeNull();
});

test("the terminal palette steps off the terminal's background and takes its ANSI hues", () => {
  const palette = terminalPalette(terminal("#202020", "#d0d0d0", ansi))!;
  expect(palette.bg).toBe("#202020");
  expect(palette.text).toBe("#d0d0d0");
  // Small steps lighter, in order.
  const lightness = (hex: string) => Number.parseInt(hex.slice(1, 3), 16);
  expect(lightness(palette.panel)).toBeGreaterThan(lightness(palette.bg));
  expect(lightness(palette.element)).toBeGreaterThan(lightness(palette.panel));
  expect(lightness(palette.element) - lightness(palette.bg)).toBeLessThan(30);
  expect(palette.bad).toBe("#cc0000");
  expect(palette.good).toBe("#00aa00");
  expect(palette.warn).toBe("#aaaa00");
  expect(palette.accent).toBe("#5555ff");
  expect(palette.info).toBe("#00aaaa");
  for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
});

test("on a light terminal the steps go darker, and missing ANSI colours come from the light palette", () => {
  const palette = terminalPalette(terminal("#fafafa", "#202020"))!;
  expect(palette.panel < palette.bg).toBe(true);
  applyTheme("light");
  expect(palette.good).toBe(colors.good);
  applyTheme(palette);
  expect(colors.bg).toBe("#fafafa");
  expect(statusColor("good")).toBe(palette.good);
});

test("without the terminal's colours there is no terminal palette", () => {
  expect(terminalPalette(terminal("#202020", null, ansi))).toBeNull();
  expect(terminalPalette(null)).toBeNull();
});
