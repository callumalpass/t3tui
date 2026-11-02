import { describe, expect, test } from "bun:test";
import { OrchestrationV2Command, ThreadId, RuntimeRequestId } from "@t3tools/contracts";
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
});
