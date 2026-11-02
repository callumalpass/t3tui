import { describe, expect, test } from "bun:test";
import { CheckpointId, CheckpointScopeId, OrchestrationGetFullThreadDiffInput, OrchestrationGetTurnDiffInput, OrchestrationV2Command, ProviderThreadId, ReviewDiffFileContentsInput, RunId, ThreadId, TurnItemId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { T3Session, type ThreadState } from "../src/client/session.ts";
import { v2Projection } from "../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";

const threadId = ThreadId.make("thread-1");
const checkpoint = { id: CheckpointId.make("checkpoint-before-selected-prompt"), scopeId: CheckpointScopeId.make("root-scope") };

describe("turn RPCs without a server", () => {
  test("both rollback choices dispatch the captured checkpoint and validate against the contract", async () => {
    const session = new T3Session();
    const sent: unknown[] = [];
    Object.assign(session, { dispatch: async (command: unknown) => { sent.push(command); } });
    await session.rollback(threadId, checkpoint, false);
    await session.rollback(threadId, checkpoint, true);
    expect(sent.every(Schema.is(OrchestrationV2Command))).toBe(true);
    expect(sent[0]).toMatchObject({ type: "checkpoint.rollback", threadId, checkpointId: checkpoint.id, scopeId: checkpoint.scopeId, restoreFiles: false });
    expect(sent[1]).toMatchObject({ restoreFiles: true });
    expect(sent[0]).not.toHaveProperty("turnCount");
  });

  test("checkpoint ranges and file-contents requests match the RPC schemas", async () => {
    const session = new T3Session();
    const sent: { method: string; input: unknown }[] = [];
    const rpc = Object.fromEntries(["orchestration.getTurnDiff", "orchestration.getFullThreadDiff", "review.getDiffFileContents"].map((method) => [method, (input: unknown) => { sent.push({ method, input }); return Effect.succeed({ diff: "", oldContents: "old", newContents: "new" }); }]));
    Object.assign(session, { connection: { rpc } });
    await session.turnDiff({ threadId, fromTurnCount: 4, toTurnCount: 5, ignoreWhitespace: true });
    await session.fullThreadDiff({ threadId, toTurnCount: 5, ignoreWhitespace: false });
    await session.diffFileContents({ cwd: "/workspace", sourceKind: "working-tree", baseRef: "HEAD", headRef: null, oldPath: "old.ts", newPath: "new.ts", changeType: "rename-changed" });
    expect(Schema.is(OrchestrationGetTurnDiffInput)(sent[0]?.input)).toBe(true);
    expect(Schema.is(OrchestrationGetFullThreadDiffInput)(sent[1]?.input)).toBe(true);
    expect(Schema.is(ReviewDiffFileContentsInput)(sent[2]?.input)).toBe(true);
    expect(sent.map((request) => request.method)).toEqual(["orchestration.getTurnDiff", "orchestration.getFullThreadDiff", "review.getDiffFileContents"]);
  });

  test("expanded output normalizes frames and unsubscribes immediately", async () => {
    const session = new T3Session();
    let finishStream!: () => void;
    const finished = new Promise<void>((resolve) => { finishStream = resolve; });
    let receive!: () => void;
    const received = new Promise<void>((resolve) => { receive = resolve; });
    const outputs: string[] = [];
    const stream = Stream.concat(Stream.make(
      { kind: "replace" as const, text: "first\n", running: true, truncated: false },
      { kind: "append" as const, text: "second", running: true, truncated: false },
    ), Stream.never).pipe(Stream.ensuring(Effect.sync(finishStream)));
    Object.assign(session, { connection: { rpc: { "orchestration.subscribeCommandOutput": (input: unknown) => {
      expect(input).toEqual({ threadId, itemId: TurnItemId.make("command-1") });
      return stream;
    } } }, runInScope: Effect.runFork });
    const close = session.watchCommandOutput(threadId, TurnItemId.make("command-1"), (view) => { outputs.push(view.output.text); if (outputs.length === 2) receive(); }, (error) => { throw new Error(error); });
    await received;
    close();
    await finished;
    expect(outputs).toEqual(["first\n", "first\nsecond"]);
  });
});

function rewindSession() {
  const session = new T3Session();
  const providerThreadId = ProviderThreadId.make("provider-thread");
  const initial = { ...v2Projection, thread: { ...v2Projection.thread, activeProviderThreadId: providerThreadId }, runs: [{ id: RunId.make("run-5"), ordinal: 5, status: "completed" }], providerThreads: [{ id: providerThreadId, lastRunOrdinal: 5 }] } as unknown as OrchestrationV2ThreadProjection;
  let observe!: (state: ThreadState) => void;
  let command: { commandId: string } | undefined;
  let closed = false;
  Object.assign(session, { watchThread: (_: unknown, listener: (state: ThreadState) => void) => { observe = listener; return () => { closed = true; }; }, dispatch: async (next: { commandId: string }) => { command = next; } });
  const emit = (projection: OrchestrationV2ThreadProjection) => observe({ status: "live", projection, history: { cursor: null, hasMore: false, loading: false } });
  return { session, initial, emit, command: () => command!, closed: () => closed };
}

test("rewind waits for the rolled-back suffix and the provider conversation, not just command acceptance", async () => {
  const rig = rewindSession();
  let resolved = false;
  const pending = rig.session.rewind(rig.initial, checkpoint, 2, false).then(() => { resolved = true; });
  await Promise.resolve();
  rig.emit(rig.initial);
  await Promise.resolve();
  expect(resolved).toBe(false);
  const next = { ...rig.initial, runs: rig.initial.runs.map((run) => ({ ...run, status: "rolled_back" as const })) };
  rig.emit(next);
  await Promise.resolve();
  expect(resolved).toBe(false);
  rig.emit({ ...next, providerThreads: next.providerThreads.map((thread) => ({ ...thread, lastRunOrdinal: 2 })) });
  await pending;
  expect(resolved).toBe(true);
  expect(rig.closed()).toBe(true);
});

test("rewind reports the matching server failure and closes its listener", async () => {
  const rig = rewindSession();
  const pending = rig.session.rewind(rig.initial, checkpoint, 2, true);
  rig.emit({ ...rig.initial, thread: { ...rig.initial.thread, rollbackFailure: { requestId: rig.command().commandId, message: "cannot restore" } } } as OrchestrationV2ThreadProjection);
  await expect(pending).rejects.toThrow("cannot restore");
  expect(rig.closed()).toBe(true);
});
