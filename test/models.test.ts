import { describe, expect, test } from "bun:test";
import type { ModelSelection, ProviderInstanceId, ServerConfig } from "@t3tools/contracts";

import { modelSummary, optionValue, selectableProviders, withModel, withOption } from "../src/model/models.ts";

const effort = { id: "effort", label: "Thinking", type: "select", options: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }] } as const;
const fast = { id: "fast", label: "Fast", type: "boolean" } as const;
const config = {
  providers: [
    {
      instanceId: "claude",
      driver: "claude",
      enabled: true,
      models: [
        { slug: "opus", name: "Claude Opus", isCustom: false, isDefault: true, capabilities: { optionDescriptors: [effort, fast] } },
        { slug: "haiku", name: "Claude Haiku", isCustom: false, capabilities: { optionDescriptors: [fast] } },
      ],
    },
    { instanceId: "gone", driver: "codex", enabled: true, availability: "unavailable", models: [] },
    { instanceId: "off", driver: "codex", enabled: false, models: [] },
  ],
} as unknown as ServerConfig;
const opus: ModelSelection = { instanceId: "claude" as ProviderInstanceId, model: "opus" };

describe("models", () => {
  test("lists only enabled, available providers", () => {
    expect(selectableProviders(config).map((provider) => provider.instanceId as string)).toEqual(["claude"]);
  });

  test("summarises the model with its options, using defaults until chosen", () => {
    expect(modelSummary(config, opus)).toBe("Claude Opus · High");
    expect(modelSummary(config, withOption(withOption(opus, "effort", "low"), "fast", true))).toBe("Claude Opus · Low · Fast");
    expect(optionValue(opus, effort)).toBe("high");
  });

  test("switching model keeps only the options the new model has", () => {
    const tuned = withOption(withOption(opus, "effort", "low"), "fast", true);
    expect(withModel(config, tuned, "claude" as ProviderInstanceId, "haiku")).toEqual({ instanceId: "claude" as ProviderInstanceId, model: "haiku", options: [{ id: "fast", value: true }] });
  });
});
