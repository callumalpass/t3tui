import { describe, expect, test } from "bun:test";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { createAlerts, type Alert } from "../src/model/alerts.ts";

const at = (ms: number) => DateTime.makeUnsafe(ms);
const thread = (extra: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "fix the build",
  projectId: "p1",
  status: "running",
  activeRunId: "run-1",
  latestRunId: "run-1",
  latestRunRequestedAt: at(100),
  latestRunStartedAt: at(110),
  latestRunCompletedAt: null,
  pendingRuntimeRequest: null,
  latestUserMessageAt: null,
  lineage: { relationshipToParent: null, parentThreadId: null },
  modelSelection: { instanceId: "codex", model: "gpt" },
  archivedAt: null,
  deletedAt: null,
  settledOverride: null,
  settledAt: null,
  pinnedAt: null,
  lastVisitedAt: at(50),
  hasActionableProposedPlan: false,
  interactionMode: "default",
  createdAt: at(0),
  updatedAt: at(120),
  ...extra,
});
const snapshot = (threads: unknown[]) => ({ projects: [], threads }) as unknown as OrchestrationV2ShellSnapshot;
const approval = { pendingRuntimeRequest: { id: "q", kind: "command", createdAt: at(130) }, updatedAt: at(130) };

describe("alerts", () => {
  test("say nothing about state that was there on connect, then alert once per new attention", () => {
    const seen: Alert[] = [];
    const alerts = createAlerts((alert) => seen.push(alert));
    alerts.observe(snapshot([thread(approval)]));
    expect(seen).toEqual([]);

    alerts.clear();
    alerts.observe(snapshot([thread()]));
    alerts.observe(snapshot([thread(approval)]));
    alerts.observe(snapshot([thread({ ...approval, updatedAt: at(140) })]));
    expect(seen.map((alert) => [alert.title, alert.thread.title])).toEqual([["Approval needed", "fix the build"]]);
  });

  test("leave subagents to their parent", () => {
    const seen: Alert[] = [];
    const alerts = createAlerts((alert) => seen.push(alert));
    const child = { id: "c1", lineage: { relationshipToParent: "subagent", parentThreadId: "t1" } };
    alerts.observe(snapshot([thread(child)]));
    alerts.observe(snapshot([thread({ ...child, ...approval })]));
    expect(seen).toEqual([]);
  });
});
