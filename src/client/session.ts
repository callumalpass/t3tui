import {
  CommandId,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2Command,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadProjection,
  type ProviderApprovalDecision,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { applyShellStreamEvent, mergeShellSnapshotProjects } from "../../vendor/t3code/packages/client-runtime/src/state/shellReducer.ts";
import { connect, type Connection } from "./rpc.ts";

export type ConnectionStatus =
  | { readonly type: "connecting" }
  | { readonly type: "live" }
  | { readonly type: "error"; readonly message: string };

export interface ShellState {
  readonly status: ConnectionStatus;
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  readonly serverUrl: string | null;
}

export interface ThreadState {
  readonly status: "loading" | "live" | "error";
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly error?: string;
}

type Listener<T> = (value: T) => void;

/**
 * One connection to T3 Code: a live shell (projects and threads) plus on-demand
 * thread subscriptions, exposed as plain listeners for the UI.
 */
export class T3Session {
  private scope: Scope.Closeable | null = null;
  private connection: Connection | null = null;
  private shell: ShellState = { status: { type: "connecting" }, snapshot: null, serverUrl: null };
  private readonly shellListeners = new Set<Listener<ShellState>>();
  private readonly threads = new Map<ThreadId, { state: ThreadState; listeners: Set<Listener<ThreadState>>; fiber: Fiber.Fiber<unknown, unknown> | null }>();

  async start(): Promise<void> {
    const scope = Effect.runSync(Scope.make());
    this.scope = scope;
    try {
      this.connection = await Effect.runPromise(connect.pipe(Scope.provide(scope)));
    } catch (error) {
      this.setShell({ status: { type: "error", message: messageOf(error) } });
      return;
    }
    this.setShell({ serverUrl: this.connection.target.httpBaseUrl });
    this.runInScope(this.shellStream());
  }

  async stop(): Promise<void> {
    const scope = this.scope;
    this.scope = null;
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
  }

  getShell(): ShellState {
    return this.shell;
  }

  onShell(listener: Listener<ShellState>): () => void {
    this.shellListeners.add(listener);
    listener(this.shell);
    return () => this.shellListeners.delete(listener);
  }

  /** Subscribes to one thread's live projection; the stream stops when the last listener leaves. */
  watchThread(threadId: ThreadId, listener: Listener<ThreadState>): () => void {
    let entry = this.threads.get(threadId);
    if (!entry) {
      entry = { state: { status: "loading", projection: null }, listeners: new Set(), fiber: null };
      this.threads.set(threadId, entry);
      entry.fiber = this.runInScope(this.threadStream(threadId));
    }
    entry.listeners.add(listener);
    listener(entry.state);
    return () => {
      const current = this.threads.get(threadId);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.threads.delete(threadId);
        if (current.fiber) Effect.runFork(Fiber.interrupt(current.fiber));
      }
    };
  }

  sendMessage(threadId: ThreadId, text: string, mode: "queue" | "steer" = "queue"): Promise<void> {
    const commandId = newCommandId();
    const running = this.threads.get(threadId)?.state.projection?.runs.findLast((run) => isActiveRun(run.status));
    return this.dispatch({
      type: "message.dispatch",
      commandId,
      threadId,
      messageId: MessageId.make(commandId),
      text,
      attachments: [],
      dispatchMode:
        mode === "steer" && running
          ? { type: "steer_active", targetRunId: running.id }
          : { type: "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });
  }

  respond(threadId: ThreadId, requestId: RuntimeRequestId, decision: ProviderApprovalDecision): Promise<void> {
    return this.dispatch({ type: "runtime-request.respond", commandId: newCommandId(), threadId, requestId, decision });
  }

  /** Stops whatever the thread is running, the way the GUI's stop button does. */
  stopThread(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.stop", commandId: newCommandId(), threadId });
  }

  private async dispatch(command: OrchestrationV2Command): Promise<void> {
    const rpc = this.requireConnection().rpc;
    await Effect.runPromise(rpc[ORCHESTRATION_V2_WS_METHODS.dispatchCommand](command));
  }

  private shellStream() {
    const rpc = this.requireConnection().rpc;
    return rpc[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({ requestCompletionMarker: true, omitIdleSubagents: true, omitOlderSettled: true }).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          const previous = this.shell.snapshot;
          switch (item.kind) {
            case "synchronized":
              this.setShell({ status: { type: "live" } });
              return;
            case "snapshot":
              // Follow-up snapshots that carry resolved repository roots only enrich projects.
              this.setShell({
                snapshot:
                  item.resolvedRepositoryIdentityRoots === undefined
                    ? item.snapshot
                    : mergeShellSnapshotProjects(previous, item.snapshot, { resolvedRepositoryIdentityRoots: item.resolvedRepositoryIdentityRoots }),
              });
              return;
            default:
              if (previous) this.setShell({ snapshot: applyShellStreamEvent(previous, item) });
          }
        }),
      ),
      Effect.catchCause((cause) => Effect.sync(() => this.setShell({ status: { type: "error", message: prettyCause(cause) } }))),
    );
  }

  private threadStream(threadId: ThreadId) {
    const rpc = this.requireConnection().rpc;
    return rpc[ORCHESTRATION_V2_WS_METHODS.subscribeThread]({ threadId, requestCompletionMarker: true }).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          const entry = this.threads.get(threadId);
          if (!entry) return;
          switch (item.kind) {
            case "synchronized":
              this.setThread(threadId, { status: "live" });
              return;
            case "snapshot":
              this.setThread(threadId, { projection: item.projection });
              return;
            case "event":
              this.setThread(threadId, { projection: applyOrchestrationV2ProjectionEvent(entry.state.projection, item.event) });
              return;
            case "unknown-event":
              return;
          }
        }),
      ),
      Effect.catchCause((cause) => Effect.sync(() => this.setThread(threadId, { status: "error", error: prettyCause(cause) }))),
    );
  }

  private runInScope<A, E>(effect: Effect.Effect<A, E>): Fiber.Fiber<unknown, unknown> {
    const scope = this.scope;
    if (!scope) throw new Error("Session is not started.");
    return Effect.runFork(effect.pipe(Effect.forkIn(scope), Effect.flatMap(Fiber.join)));
  }

  private requireConnection(): Connection {
    if (!this.connection) throw new Error("Not connected to T3 Code.");
    return this.connection;
  }

  private setShell(patch: Partial<ShellState>): void {
    this.shell = { ...this.shell, ...patch };
    for (const listener of this.shellListeners) listener(this.shell);
  }

  private setThread(threadId: ThreadId, patch: Partial<ThreadState>): void {
    const entry = this.threads.get(threadId);
    if (!entry) return;
    entry.state = { ...entry.state, ...patch };
    for (const listener of entry.listeners) listener(entry.state);
  }
}

const isActiveRun = (status: string) => status === "preparing" || status === "starting" || status === "running" || status === "waiting";

const newCommandId = () => CommandId.make(crypto.randomUUID());

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const prettyCause = (cause: unknown) => {
  const text = String((cause as { toString?: () => string })?.toString?.() ?? cause);
  return text.split("\n")[0] ?? text;
};
