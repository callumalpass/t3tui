import { describe, expect, test } from "bun:test";
import { ScheduledTaskUpsertInput, type OrchestrationProjectShell, type ScheduledTask } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { automationTemplate, newAutomationTemplate, parseAutomation } from "../src/model/automations.ts";

const projects = [
  { id: "p1", title: "tasknotes", workspaceRoot: "/repo/tasknotes" },
  { id: "p2", title: "t3tui", workspaceRoot: "/repo/t3tui" },
] as unknown as OrchestrationProjectShell[];

const task = (extra: Record<string, unknown> = {}) =>
  ({
    id: "task-1",
    title: "Nightly tidy",
    prompt: "Tidy the notes.\nThen summarise.",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
    projectId: "p1",
    threadId: "t1",
    workspaceStrategy: { type: "worktree", baseRef: "main", startFromOrigin: true },
    modelSelection: { instanceId: "codex", model: "gpt-5", options: [{ id: "effort", value: "high" }] },
    runtimeMode: "full-access",
    interactionMode: "default",
    ...extra,
  }) as unknown as ScheduledTask;

const isUpsert = Schema.is(ScheduledTaskUpsertInput);

describe("automation templates", () => {
  test("an edited task round-trips, keeping its model options", () => {
    const parsed = parseAutomation(automationTemplate(task(), projects), projects, task());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(isUpsert(parsed.input)).toBe(true);
    expect(parsed.input).toMatchObject({
      id: "task-1",
      requireExisting: true,
      title: "Nightly tidy",
      prompt: "Tidy the notes.\nThen summarise.",
      schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      projectId: "p1",
      threadId: "t1",
      workspaceStrategy: { type: "worktree", baseRef: "main", startFromOrigin: true },
      modelSelection: { instanceId: "codex", model: "gpt-5", options: [{ id: "effort", value: "high" }] },
    });
  });

  test("a new task takes the edited title, interval and prompt", () => {
    const text = newAutomationTemplate(projects, { projectId: "p2", threadId: "", modelSelection: { instanceId: "claude" as never, model: "opus" }, runtimeMode: "auto" })
      .replace("Title: ", "Title: Sweep")
      .replace("Schedule: fixed 09:00 Mon,Tue,Wed,Thu,Fri", "Schedule: interval 2h")
      .replace("Prompt:\n", "Prompt:\nSweep the inbox.\n");
    const parsed = parseAutomation(text, projects);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(isUpsert(parsed.input)).toBe(true);
    expect(parsed.input).toMatchObject({ title: "Sweep", schedule: { type: "interval", everyMs: 7_200_000 }, projectId: "p2", threadId: null, runtimeMode: "auto" });
    expect(parsed.input).not.toHaveProperty("id");
  });

  test("the web form's checks apply: complete, a minute or more, a checkout path", () => {
    const blank = newAutomationTemplate(projects, { projectId: "p1", threadId: "", modelSelection: { instanceId: "codex" as never, model: "gpt-5" }, runtimeMode: "full-access" });
    expect(parseAutomation(blank, projects)).toEqual({ ok: false, error: "Scheduled task is incomplete: add a title, prompt, project, and model." });
    const filled = blank.replace("Title: ", "Title: X").replace("Prompt:\n", "Prompt:\nDo it.\n");
    expect(parseAutomation(filled.replace("Schedule: fixed 09:00 Mon,Tue,Wed,Thu,Fri", "Schedule: interval 0m"), projects).ok).toBe(false);
    expect(parseAutomation(filled.replace("Workspace: worktree", "Workspace: existing_worktree"), projects)).toMatchObject({ ok: false, error: expect.stringContaining("Checkout path is required") });
    expect(parseAutomation(filled.replace("Project: tasknotes", "Project: nope"), projects).ok).toBe(false);
    expect(parseAutomation(filled.replace("Schedule: fixed 09:00 Mon,Tue,Wed,Thu,Fri", "Schedule: whenever"), projects).ok).toBe(false);
  });

  test("editing a webhook task keeps its signature and dedupe, and leaves filters stored", () => {
    const hook = task({
      schedule: {
        type: "webhook",
        signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
        maxDeliveryAgeMinutes: 60,
        dedupe: { replayKey: "{{headers.x-id}}" },
        filters: [{ path: "body.action", op: "equals", value: "open" }],
      },
    });
    const parsed = parseAutomation(automationTemplate(hook, projects), projects, hook);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(isUpsert(parsed.input)).toBe(true);
    expect(parsed.input.schedule).toEqual({
      type: "webhook",
      signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
      maxDeliveryAgeMinutes: 60,
      dedupe: { replayKey: "{{headers.x-id}}" },
    });
  });
});
