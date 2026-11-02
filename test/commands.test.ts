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
  test("a queued message is a valid message.dispatch", async () => {
    const { session, sent } = capturingSession();
    await session.sendMessage(threadId, "hello");
    expect(sent).toHaveLength(1);
    expect(isCommand(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({ type: "message.dispatch", threadId, text: "hello", dispatchMode: { type: "queue_after_active" } });
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
