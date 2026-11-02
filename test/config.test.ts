import { describe, expect, test } from "bun:test";

import { cycleConfig, DEFAULT_CONFIG, formatClock, parseConfig } from "../src/config.ts";
import { settingRows } from "../src/model/settings.ts";

describe("config", () => {
  test("keeps valid values and defaults the rest", () => {
    expect(parseConfig({ followUpBehavior: "queue", sendShortcut: "nope", diffIgnoreWhitespace: false, extra: 1 })).toEqual({
      ...DEFAULT_CONFIG,
      followUpBehavior: "queue",
      diffIgnoreWhitespace: false,
    });
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  test("cycles through each setting's choices", () => {
    const once = cycleConfig(DEFAULT_CONFIG, "timestampFormat");
    expect(once.timestampFormat).toBe("12-hour");
    expect(cycleConfig(cycleConfig(once, "timestampFormat"), "timestampFormat").timestampFormat).toBe("locale");
    expect(cycleConfig(DEFAULT_CONFIG, "diffIgnoreWhitespace").diffIgnoreWhitespace).toBe(false);
  });

  test("formats clock times", () => {
    expect(formatClock("09:05", "24-hour")).toBe("09:05");
    expect(formatClock("21:30", "12-hour")).toMatch(/^9:30\s?PM$/i);
    expect(formatClock("bad", "24-hour")).toBe("bad");
  });

  test("labels settings for the settings view", () => {
    const rows = settingRows({ ...DEFAULT_CONFIG, followUpBehavior: "queue" });
    expect(rows.map((row) => row.key)).toEqual(["followUpBehavior", "sendShortcut", "timestampFormat", "diffIgnoreWhitespace"]);
    expect(rows[0]?.value).toBe("queues");
  });
});
