import { describe, expect, test } from "bun:test";
import { ProviderInstanceId, type ServerConfig, type UsageSummary } from "@t3tools/contracts";

import { resetCreditOutcome, usageLimits, usageSummaryLines } from "../src/model/usage.ts";

const now = Date.parse("2026-11-02T12:00:00.000Z");

const provider = (usedPercent: number, extra: Record<string, unknown> = {}) => ({
  instanceId: "claude-1",
  driver: "claudeAgent",
  displayName: "Claude",
  enabled: true,
  installed: true,
  availability: "available",
  auth: { status: "authenticated", email: "a@example.com", label: "Max" },
  models: [],
  usageLimits: {
    checkedAt: "2026-11-02T11:00:00.000Z",
    windows: [{ id: "seven_day", kind: "weekly", label: "Weekly", usedPercent, resetsAt: "2026-11-04T12:00:00.000Z" }],
    resetCredits: { availableCount: 2, nextExpiresAt: "2026-11-09T12:00:00.000Z" },
  },
  ...extra,
});

const config = (providers: unknown[]) =>
  ({
    environment: { environmentId: "env-1", label: "This Mac" },
    providers,
  }) as unknown as ServerConfig;

describe("usageLimits", () => {
  test("lines read as room left, with banked credits the palette can spend", () => {
    const info = usageLimits(config([provider(40)]), now);
    expect(info.lines).toEqual([
      { label: "Claude · Max Weekly", value: "60% left · resets in 2d 0h" },
      { label: "Claude · Max reset credits", value: "2 reset credits banked · next expires in 7d 0h" },
    ]);
    expect(info.note).toBeNull();
    expect(info.credits).toEqual([{ label: "Claude · Max", input: { instanceId: ProviderInstanceId.make("claude-1") }, credits: { availableCount: 2, nextExpiresAt: "2026-11-09T12:00:00.000Z" } }]);
  });

  test("a near or reached window becomes the status note", () => {
    expect(usageLimits(config([provider(95)]), now).note).toBe("Claude Weekly: 5% left · resets in 2d 0h");
    expect(usageLimits(config([provider(100)]), now).note).toBe("Claude Weekly: limit reached · resets in 2d 0h");
    expect(usageLimits(null, now)).toEqual({ lines: [], note: null, credits: [] });
  });
});

describe("usageSummaryLines", () => {
  test("totals come first, then providers by cost", () => {
    const summary = {
      buckets: [
        { provider: "claude", costUsd: 3, totals: { uncachedInputTokens: 1000, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 500 } },
        { provider: "codex", costUsd: 7.5, totals: { uncachedInputTokens: 2000, cachedInputTokens: 1000, cacheCreationTokens: 0, outputTokens: 500 } },
      ],
      sources: [{ distinctSessions: 4 }],
    } as unknown as UsageSummary;
    const lines = usageSummaryLines(summary);
    expect(lines[0]!.label).toBe("Last 30 days");
    expect(lines[0]!.value).toContain("$10.50");
    expect(lines[0]!.value).toContain("4 sessions");
    expect(lines.slice(1).map((line) => line.label)).toEqual(["codex", "claude"]);
    expect(resetCreditOutcome({ outcome: "reset" })).toBe("Reset applied. Your windows have cleared.");
    expect(resetCreditOutcome({ outcome: "reset", warning: "Careful" })).toBe("Careful");
  });
});
