import { describe, expect, test } from "bun:test";
import { AttachmentCreateUploadUrlInput, AttachmentDeleteInput, NodeId, OrchestrationV2Command, OrchestrationV2ThreadLaunchInput, ProjectId, ProviderConsumeResetCreditInput, ProviderInstanceId, RunId, ScheduledTaskDeleteInput, ThreadId, RuntimeRequestId, UsageSummaryInput, type ChatAttachment, type OrchestrationV2Subagent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { T3Session } from "../src/client/session.ts";

// Captures what the session would dispatch, without a server, and checks it
// against the server's own command schema.
function capturingSession() {
  const session = new T3Session();
  const sent: unknown[] = [];
  (session as unknown as { dispatch: (command: unknown) => Promise<void> }).dispatch = async (command) => {
    sent.push(command);
  };
  return { session, sent };
}

const isCommand = Schema.is(OrchestrationV2Command);
const threadId = ThreadId.make("thread-1");

describe("commands tui3 dispatches", () => {
  test("messages dispatch like the web composer: auto, steer or queue", async () => {
    const { session, sent } = capturingSession();
    await session.sendMessage(threadId, "hello");
    await session.sendMessage(threadId, "change course", "steer");
    await session.sendMessage(threadId, "after that", "queue");
    expect(sent.every(isCommand)).toBe(true);
    expect(sent[0]).toMatchObject({ type: "message.dispatch", threadId, text: "hello", dispatchMode: { type: "start_immediately" }, deliveryIntent: "auto" });
    expect(sent[1]).toMatchObject({ dispatchMode: { type: "start_immediately" }, deliveryIntent: "steer" });
    expect(sent[2]).toMatchObject({ dispatchMode: { type: "queue_after_active" } });
    expect(sent[2]).not.toHaveProperty("deliveryIntent");
  });

  test("declining with feedback, answering and dismissing questions are valid", async () => {
    const { session, sent } = capturingSession();
    const requestId = RuntimeRequestId.make("req-1");
    await session.respond(threadId, requestId, "decline", "use the staging bucket");
    await session.answer(threadId, requestId, { q1: "yes", q2: ["a", "b"] });
    await session.dismissQuestion(threadId, requestId);
    expect(sent.every(isCommand)).toBe(true);
    expect(sent[0]).toMatchObject({ decision: "decline", feedback: "use the staging bucket" });
    expect(sent[1]).toMatchObject({ type: "runtime-request.respond", answers: { q1: "yes", q2: ["a", "b"] } });
    expect(sent[2]).toMatchObject({ type: "thread.user-input.dismiss" });
  });

  test("a visit is a valid thread.visit", async () => {
    const { session, sent } = capturingSession();
    await session.visit(threadId);
    expect(isCommand(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({ type: "thread.visit", threadId, opened: true });
  });

  test("an approval is a valid runtime-request.respond", async () => {
    const { session, sent } = capturingSession();
    await session.respond(threadId, RuntimeRequestId.make("req-1"), "acceptForSession");
    expect(isCommand(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({ type: "runtime-request.respond", decision: "acceptForSession" });
  });

  test("stop is a valid thread.stop", async () => {
    const { session, sent } = capturingSession();
    await session.stopThread(threadId);
    expect(isCommand(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({ type: "thread.stop", threadId });
  });

  test("a model change rides on the next message, and a mode change is its own command", async () => {
    const { session, sent } = capturingSession();
    const modelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] };
    await session.sendMessage(threadId, "carry on", "auto", modelSelection);
    await session.setRuntimeMode(threadId, "approval-required");
    expect(sent.every(isCommand)).toBe(true);
    expect(sent[0]).toMatchObject({ type: "message.dispatch", modelSelection });
    expect(sent[1]).toMatchObject({ type: "thread.runtime-mode.set", runtimeMode: "approval-required" });
  });

  test("a new thread launches with a payload the server accepts", async () => {
    const session = new T3Session();
    let payload: unknown;
    const rpc = { "orchestration.launchThread": (input: unknown) => ((payload = input), Effect.succeed({ threadId: ThreadId.make("new-1") })) };
    (session as unknown as { connection: unknown }).connection = { rpc };
    const id = await session.launchThread({
      projectId: ProjectId.make("p1"),
      title: "Fix the flaky test",
      generateTitle: true,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "worktree", baseRef: "main", startFromOrigin: true },
      text: "Fix the flaky test",
    });
    expect(id as string).toBe("new-1");
    expect(Schema.is(OrchestrationV2ThreadLaunchInput)(payload)).toBe(true);
    expect(payload).toMatchObject({ initialMessage: { text: "Fix the flaky test", attachments: [] } });
  });

  test("attachments ride on a message and on a new thread's first message", async () => {
    const attachment = { type: "image", id: "upload-1", name: "shot.png", mimeType: "image/png", sizeBytes: 12 } as ChatAttachment;
    const { session, sent } = capturingSession();
    await session.sendMessage(threadId, "see this", "auto", undefined, undefined, [attachment]);
    expect(isCommand(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({ type: "message.dispatch", attachments: [attachment] });

    const launching = new T3Session();
    let payload: unknown;
    const rpc = { "orchestration.launchThread": (input: unknown) => ((payload = input), Effect.succeed({ threadId: ThreadId.make("new-2") })) };
    (launching as unknown as { connection: unknown }).connection = { rpc };
    await launching.launchThread({
      projectId: ProjectId.make("p1"),
      title: "Attached image",
      generateTitle: true,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
      text: "see this",
      attachments: [attachment],
    });
    expect(Schema.is(OrchestrationV2ThreadLaunchInput)(payload)).toBe(true);
    expect(payload).toMatchObject({ initialMessage: { attachments: [attachment] } });
  });

  test("upload mint, delete, usage, reset credit and automation delete payloads validate", async () => {
    const session = new T3Session();
    const calls = new Map<string, unknown>();
    const rpc = new Proxy(
      {},
      {
        get: (_target, method) => (input: unknown) => {
          calls.set(String(method), input);
          if (method === "attachments.createUploadUrl") return Effect.succeed({ attachmentId: "upload-9", relativeUrl: "/upload?sig=x", expiresAt: 1 });
          if (method === "server.getUsageSummary") return Effect.succeed({ buckets: [] });
          if (method === "provider.consumeResetCredit") return Effect.succeed({ outcome: "reset" });
          return Effect.succeed({});
        },
      },
    );
    (session as unknown as { connection: unknown }).connection = { rpc, target: { httpBaseUrl: "http://127.0.0.1:9" } };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    try {
      const uploaded = await session.uploadAttachment({ type: "image", name: "shot.png", mimeType: "image/png", sizeBytes: 3 }, new Uint8Array([1, 2, 3]));
      expect(uploaded).toEqual({ type: "image", id: "upload-9", name: "shot.png", mimeType: "image/png", sizeBytes: 3 });
    } finally {
      globalThis.fetch = originalFetch;
    }
    await session.deleteAttachment("upload-9");
    await session.usageSummary({ sinceDay: "2026-10-03" as never, untilDay: "2026-11-02" as never, timeZone: "UTC" });
    await session.consumeResetCredit({ instanceId: ProviderInstanceId.make("claude-1") });
    await session.deleteAutomation("task-1" as never);
    expect(Schema.is(AttachmentCreateUploadUrlInput)(calls.get("attachments.createUploadUrl"))).toBe(true);
    expect(Schema.is(AttachmentDeleteInput)(calls.get("attachments.delete"))).toBe(true);
    expect(Schema.is(UsageSummaryInput)(calls.get("server.getUsageSummary"))).toBe(true);
    expect(Schema.is(ProviderConsumeResetCreditInput)(calls.get("provider.consumeResetCredit"))).toBe(true);
    expect(Schema.is(ScheduledTaskDeleteInput)(calls.get("scheduledTasks.delete"))).toBe(true);
  });
});

describe("queue, resume and subagent commands", () => {
  const runId = RunId.make("run-2");

  test("queue controls dispatch as the web's QueuedRunsControl", async () => {
    const { session, sent } = capturingSession();
    await session.startQueuedRun(threadId, runId);
    await session.promoteQueuedRun(threadId, runId, RunId.make("run-1"));
    await session.cancelQueuedRun(threadId, runId);
    await session.editQueuedRun(threadId, runId, "reworded");
    await session.resumeQueue(threadId);
    expect(sent.every(isCommand)).toBe(true);
    expect(sent.map((command) => (command as { type: string }).type)).toEqual(["queued-run.start", "queued-message.promote-to-steer", "queued-run.cancel", "queued-run.edit", "queue.resume"]);
  });

  test("resuming continues the interrupted run, then releases the held queue", async () => {
    const { session, sent } = capturingSession();
    await session.continueRun(threadId, RunId.make("run-1"), true);
    expect(sent.every(isCommand)).toBe(true);
    expect(sent[0]).toMatchObject({ type: "message.dispatch", text: "Continue where you left off.", manualContinuationOfRunId: "run-1", dispatchMode: { type: "start_immediately" } });
    expect(sent[1]).toMatchObject({ type: "queue.resume" });
  });

  test("an app-owned subagent is stopped from its parent and in its own thread", async () => {
    const { session, sent } = capturingSession();
    const child = ThreadId.make("child-1");
    await session.stopSubagent({ id: NodeId.make("node-1"), threadId, runId: RunId.make("run-1"), origin: "app_owned", childThreadId: child } as OrchestrationV2Subagent);
    expect(sent.every(isCommand)).toBe(true);
    expect(sent[0]).toMatchObject({ type: "subagent.stop", threadId, subagentId: "node-1" });
    expect(sent[1]).toMatchObject({ type: "thread.stop", threadId: child });
  });
});
