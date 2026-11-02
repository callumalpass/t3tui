import {
  CommandId,
  MessageId,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2ThreadHistoryPage,
  type OrchestrationV2Command,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadProjection,
  type ProviderApprovalDecision,
  type RuntimeRequestId,
  type ThreadId,
  type DiscoveredLocalServer,
  type GitActionProgressEvent,
  type GitRunStackedActionResult,
  type GitStackedAction,
  type ProjectId,
  type ReviewDiffPreviewSource,
  type ScheduledTask,
  type ScheduledTaskId,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  WS_METHODS,
} from "@t3tools/contracts";
import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import { mergeOlderHistoryIntoProjection } from "@t3tools/client-runtime/state/thread-history-merge";
import type { ComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { boundedSnapshotProjection } from "@t3tools/shared/orchestrationV2BoundedSnapshot";
import { appendFileSync } from "node:fs";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { applyShellStreamEvent, mergeShellSnapshotProjects } from "../../vendor/t3code/packages/client-runtime/src/state/shellReducer.ts";
import { connect, type Connection } from "./rpc.ts";

export type ConnectionStatus =
  | { readonly type: "connecting" }
  | { readonly type: "live" }
  | { readonly type: "reconnecting"; readonly message: string }
  | { readonly type: "error"; readonly message: string };

export interface ShellState {
  readonly status: ConnectionStatus;
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  readonly serverUrl: string | null;
}

/** Older turns the server left out of the snapshot, fetched page by page. */
export interface ThreadHistory {
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error?: string;
}

export interface ThreadState {
  readonly status: "loading" | "live" | "error";
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly history: ThreadHistory;
  readonly error?: string;
}

/** Git status of a working directory, as the server's status stream reports it. */
export interface VcsState {
  readonly status: "loading" | "live" | "error";
  readonly local: VcsStatusLocalResult | null;
  readonly remote: VcsStatusRemoteResult | null;
  readonly error?: string;
}

/** A server-wide list that streams whole: local servers or scheduled tasks. */
export interface FeedState<T> {
  readonly status: "loading" | "live" | "error";
  readonly items: readonly T[];
  readonly error?: string;
}

export interface GitActionRequest {
  readonly cwd: string;
  readonly action: GitStackedAction;
  /** Left out, the server writes one with a model. */
  readonly commitMessage?: string;
  readonly threadId?: ThreadId;
  readonly projectId?: ProjectId;
}

type Listener<T> = (value: T) => void;

/** Streaming deltas arrive far faster than a terminal can usefully redraw. */
const THREAD_NOTIFY_MS = 33;
/** Threads you leave stay subscribed this long, so switching back is instant. */
const THREAD_LINGER_MS = 60_000;
/** Waits between reconnect attempts after the socket drops. */
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

const NO_HISTORY: ThreadHistory = { cursor: null, hasMore: false, loading: false };

const debugPath = process.env.TUI3_DEBUG;
/** Appends to the file named by TUI3_DEBUG; the TUI owns stdout and stderr. */
export function debugLog(message: string): void {
  if (debugPath) appendFileSync(debugPath, `${new Date().toISOString()} ${message}\n`);
}

const decodeHistoryPage = Schema.decodeUnknownSync(Schema.toCodecJson(OrchestrationV2ThreadHistoryPage));

/** A subscription shared by every listener of the same key, restarted after reconnects. */
interface FeedEntry {
  state: unknown;
  readonly listeners: Set<Listener<unknown>>;
  readonly stream: () => Effect.Effect<unknown, unknown>;
  fiber: Fiber.Fiber<unknown, unknown> | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;
}

interface ThreadEntry {
  state: ThreadState;
  readonly listeners: Set<Listener<ThreadState>>;
  fiber: Fiber.Fiber<unknown, unknown> | null;
  notifyTimer: ReturnType<typeof setTimeout> | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * One connection to T3 Code: a live shell (projects and threads) plus on-demand
 * thread subscriptions, exposed as plain listeners for the UI. When the socket
 * drops, it reconnects and resubscribes everything.
 */
export class T3Session {
  private scope: Scope.Closeable | null = null;
  private connection: Connection | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private recovering = false;
  private shell: ShellState = { status: { type: "connecting" }, snapshot: null, serverUrl: null };
  private readonly shellListeners = new Set<Listener<ShellState>>();
  private readonly threads = new Map<ThreadId, ThreadEntry>();
  private readonly feeds = new Map<string, FeedEntry>();

  async start(): Promise<void> {
    const scope = Effect.runSync(Scope.make());
    this.scope = scope;
    try {
      this.connection = await Effect.runPromise(connect.pipe(Scope.provide(scope)));
    } catch (error) {
      this.scope = null;
      await Effect.runPromise(Scope.close(scope, Exit.void));
      if (this.reconnectAttempt > 0) return this.scheduleReconnect(messageOf(error));
      this.setShell({ status: { type: "error", message: messageOf(error) } });
      return;
    }
    this.recovering = false;
    this.setShell({ serverUrl: this.connection.target.httpBaseUrl });
    this.runInScope(this.shellStream());
    for (const [threadId, entry] of this.threads) entry.fiber = this.runInScope(this.threadStream(threadId));
    for (const entry of this.feeds.values()) entry.fiber = this.runInScope(entry.stream());
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.closeScope();
  }

  getShell(): ShellState {
    return this.shell;
  }

  onShell(listener: Listener<ShellState>): () => void {
    this.shellListeners.add(listener);
    listener(this.shell);
    return () => this.shellListeners.delete(listener);
  }

  /**
   * Subscribes to one thread's live projection. The stream outlives its last
   * listener by THREAD_LINGER_MS, so flipping between threads doesn't reload them.
   */
  watchThread(threadId: ThreadId, listener: Listener<ThreadState>): () => void {
    let entry = this.threads.get(threadId);
    if (!entry) {
      entry = { state: { status: "loading", projection: null, history: NO_HISTORY }, listeners: new Set(), fiber: null, notifyTimer: null, lingerTimer: null };
      this.threads.set(threadId, entry);
      if (this.connection) entry.fiber = this.runInScope(this.threadStream(threadId));
      debugLog(`subscribe ${threadId}`);
    }
    if (entry.lingerTimer) clearTimeout(entry.lingerTimer);
    entry.lingerTimer = null;
    entry.listeners.add(listener);
    listener(entry.state);
    const watched = entry;
    return () => {
      watched.listeners.delete(listener);
      if (watched.listeners.size > 0) return;
      watched.lingerTimer = setTimeout(() => {
        if (watched.listeners.size > 0 || this.threads.get(threadId) !== watched) return;
        this.threads.delete(threadId);
        debugLog(`unsubscribe ${threadId}`);
        if (watched.notifyTimer) clearTimeout(watched.notifyTimer);
        if (watched.fiber) Effect.runFork(Fiber.interrupt(watched.fiber));
      }, THREAD_LINGER_MS);
    };
  }

  /** Subscribes to a working directory's git status: branch, changes, and the remote's ahead/behind and PR. */
  watchVcs(cwd: string, listener: Listener<VcsState>): () => void {
    return this.watchFeed<VcsState>(`vcs:${cwd}`, { status: "loading", local: null, remote: null }, listener, (update) =>
      this.requireConnection()
        .rpc[WS_METHODS.subscribeVcsStatus]({ cwd, includeRemote: true })
        .pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              switch (event._tag) {
                case "snapshot":
                  return update({ status: "live", local: event.local, remote: event.remote });
                case "localUpdated":
                  return update({ status: "live", local: event.local });
                case "remoteUpdated":
                  return update({ remote: event.remote });
              }
            }),
          ),
        ),
    );
  }

  /** Local servers the server has discovered, across all threads; each says which thread started it. */
  watchServers(listener: Listener<FeedState<DiscoveredLocalServer>>): () => void {
    return this.watchFeed<FeedState<DiscoveredLocalServer>>("servers", { status: "loading", items: [] }, listener, (update) =>
      this.requireConnection()
        .rpc[WS_METHODS.subscribeDiscoveredLocalServers]({})
        .pipe(Stream.runForEach((list) => Effect.sync(() => update({ status: "live", items: list.servers })))),
    );
  }

  /** Every scheduled task (automation); each names its thread, if any. */
  watchAutomations(listener: Listener<FeedState<ScheduledTask>>): () => void {
    return this.watchFeed<FeedState<ScheduledTask>>("automations", { status: "loading", items: [] }, listener, (update) =>
      this.requireConnection()
        .rpc[WS_METHODS.scheduledTasksSubscribe]({})
        .pipe(Stream.runForEach((list) => Effect.sync(() => update({ status: "live", items: list.tasks })))),
    );
  }

  /** The uncommitted diff (git diff HEAD, untracked files included), for one file or the whole tree. */
  async workingTreeDiff(cwd: string, path?: string): Promise<ReviewDiffPreviewSource | null> {
    const rpc = this.requireConnection().rpc;
    const result = await Effect.runPromise(
      rpc[WS_METHODS.reviewGetDiffPreview]({ cwd, ...(path ? { file: { path, previousPath: null, sourceKind: "working-tree" as const } } : {}) }),
    );
    return result.sources.find((source) => source.kind === "working-tree") ?? null;
  }

  /** Runs a commit / push / PR action, reporting progress as it goes. Rejects with the server's message on failure. */
  async runGitAction(request: GitActionRequest, onProgress: Listener<GitActionProgressEvent>): Promise<GitRunStackedActionResult> {
    const rpc = this.requireConnection().rpc;
    let result: GitRunStackedActionResult | null = null;
    let failure: string | null = null;
    await Effect.runPromise(
      rpc[WS_METHODS.gitRunStackedAction]({ actionId: crypto.randomUUID(), ...request }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            onProgress(event);
            if (event.kind === "action_finished") result = event.result;
            if (event.kind === "action_failed") failure = event.message;
          }),
        ),
      ),
    );
    if (failure) throw new Error(failure);
    if (!result) throw new Error("The git action ended without a result.");
    return result;
  }

  setAutomationEnabled(id: ScheduledTaskId, enabled: boolean): Promise<unknown> {
    return Effect.runPromise(this.requireConnection().rpc[WS_METHODS.scheduledTasksSetEnabled]({ id, enabled }));
  }

  runAutomationNow(id: ScheduledTaskId): Promise<unknown> {
    return Effect.runPromise(this.requireConnection().rpc[WS_METHODS.scheduledTasksRunNow]({ id }));
  }

  stopServer(server: Pick<DiscoveredLocalServer, "pid" | "port">): Promise<unknown> {
    if (server.pid === null) return Promise.reject(new Error("The server's process is unknown."));
    return Effect.runPromise(this.requireConnection().rpc[WS_METHODS.previewStopLocalServer]({ pid: server.pid, port: server.port }));
  }

  /** Fetches the next page of older turns and prepends it. Resolves false when there was nothing to load. */
  async loadEarlier(threadId: ThreadId): Promise<boolean> {
    const entry = this.threads.get(threadId);
    const cursor = entry?.state.history.cursor;
    if (!entry || !cursor || !entry.state.history.hasMore || entry.state.history.loading) return false;
    const { target, credential } = this.requireConnection();
    this.setThread(threadId, { history: { ...entry.state.history, loading: true } });
    try {
      const url = new URL(`/api/orchestration/threads/${encodeURIComponent(threadId)}/history`, target.httpBaseUrl);
      url.searchParams.set("cursor", cursor);
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${credential.bearerToken}`, [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
      });
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
      const page = decodeHistoryPage(await response.json());
      // A resubscribe while the page was in flight replaced the projection; drop the stale page.
      if (entry.state.history.cursor !== cursor || !entry.state.projection) return false;
      this.setThread(threadId, {
        projection: mergeOlderHistoryIntoProjection(entry.state.projection, page.items),
        history: { cursor: page.nextCursor, hasMore: page.hasMoreHistory, loading: false },
      });
      return true;
    } catch (error) {
      this.setThread(threadId, { history: { ...entry.state.history, loading: false, error: messageOf(error) } });
      throw error;
    }
  }

  /**
   * Sends a message the way the web composer does: "auto" when idle, otherwise
   * "steer" (into the active run) or "queue" (after it). See resolveComposerDispatchMode.
   */
  sendMessage(threadId: ThreadId, text: string, mode: ComposerDispatchMode = "auto"): Promise<void> {
    const commandId = newCommandId();
    return this.dispatch({
      type: "message.dispatch",
      commandId,
      threadId,
      messageId: MessageId.make(commandId),
      text,
      attachments: [],
      ...(mode === "queue" ? { dispatchMode: { type: "queue_after_active" } } : { dispatchMode: { type: "start_immediately" }, deliveryIntent: mode }),
      createdBy: "user",
      creationSource: "web",
    });
  }

  respond(threadId: ThreadId, requestId: RuntimeRequestId, decision: ProviderApprovalDecision, feedback?: string): Promise<void> {
    return this.dispatch({ type: "runtime-request.respond", commandId: newCommandId(), threadId, requestId, decision, ...(feedback ? { feedback } : {}) });
  }

  /** Answers a user-input request; answers map question id to an option value, typed text, or several values. */
  answer(threadId: ThreadId, requestId: RuntimeRequestId, answers: Record<string, string | readonly string[]>): Promise<void> {
    return this.dispatch({ type: "runtime-request.respond", commandId: newCommandId(), threadId, requestId, answers: answers as Record<string, string | string[]> });
  }

  dismissQuestion(threadId: ThreadId, requestId: RuntimeRequestId): Promise<void> {
    return this.dispatch({ type: "thread.user-input.dismiss", commandId: newCommandId(), threadId, requestId });
  }

  /** Moves the thread's read watermark, as opening it in the web app does. TUI3_NO_VISIT=1 peeks without it. */
  visit(threadId: ThreadId): Promise<void> {
    if (process.env.TUI3_NO_VISIT === "1") return Promise.resolve();
    return this.dispatch({ type: "thread.visit", commandId: newCommandId(), threadId, visitedAt: new Date().toISOString(), opened: true });
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
              this.reconnectAttempt = 0;
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
      Effect.catchCause((cause) => Effect.sync(() => this.connectionLost(prettyCause(cause)))),
      // The shell stream only ends when the socket does.
      Effect.ensuring(Effect.sync(() => this.connectionLost("connection closed"))),
    );
  }

  private threadStream(threadId: ThreadId) {
    const rpc = this.requireConnection().rpc;
    // Bounded: the server sends the recent window and a cursor for older turns,
    // which keeps long threads under the socket's message size limit.
    return rpc[ORCHESTRATION_V2_WS_METHODS.subscribeThread]({ threadId, requestCompletionMarker: true, acceptBoundedSnapshot: true }).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          const entry = this.threads.get(threadId);
          if (!entry) return;
          switch (item.kind) {
            case "synchronized":
              this.setThread(threadId, { status: "live" });
              return;
            case "snapshot": {
              const projection = boundedSnapshotProjection(item);
              debugLog(`snapshot ${threadId} items=${projection.visibleTurnItems.length} more=${item.hasMoreHistory === true}`);
              this.setThread(threadId, {
                projection,
                history: { cursor: item.historyCursor ?? null, hasMore: item.hasMoreHistory === true, loading: false },
              });
              return;
            }
            case "event":
              this.setThread(threadId, { projection: applyOrchestrationV2ProjectionEvent(entry.state.projection, item.event) });
              return;
            case "unknown-event":
              return;
          }
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const message = prettyCause(cause);
          // A dropped socket is the shell's to recover from; the thread resubscribes after.
          if (!isSocketFailure(message)) this.setThread(threadId, { status: "error", error: message });
        }),
      ),
    );
  }

  /**
   * Shares one stream per key among listeners and keeps it THREAD_LINGER_MS after the last
   * leaves. `stream` applies updates through the callback it's given.
   */
  private watchFeed<S extends { readonly status: string; readonly error?: string }>(
    key: string,
    initial: S,
    listener: Listener<S>,
    stream: (update: (patch: Partial<S>) => void) => Effect.Effect<unknown, unknown>,
  ): () => void {
    let entry = this.feeds.get(key);
    if (!entry) {
      const update = (patch: Partial<S>) => {
        const current = this.feeds.get(key);
        if (!current) return;
        current.state = { ...(current.state as S), ...patch };
        for (const notify of current.listeners) notify(current.state);
      };
      const run = () =>
        stream(update).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              const message = prettyCause(cause);
              if (!isSocketFailure(message)) update({ status: "error", error: message } as Partial<S>);
            }),
          ),
        );
      entry = { state: initial, listeners: new Set(), stream: run, fiber: null, lingerTimer: null };
      this.feeds.set(key, entry);
      if (this.connection) entry.fiber = this.runInScope(run());
    }
    if (entry.lingerTimer) clearTimeout(entry.lingerTimer);
    entry.lingerTimer = null;
    const untyped = listener as Listener<unknown>;
    entry.listeners.add(untyped);
    listener(entry.state as S);
    const watched = entry;
    return () => {
      watched.listeners.delete(untyped);
      if (watched.listeners.size > 0) return;
      watched.lingerTimer = setTimeout(() => {
        if (watched.listeners.size > 0 || this.feeds.get(key) !== watched) return;
        this.feeds.delete(key);
        if (watched.fiber) Effect.runFork(Fiber.interrupt(watched.fiber));
      }, THREAD_LINGER_MS);
    };
  }

  private connectionLost(message: string): void {
    if (this.stopped || this.recovering) return;
    this.recovering = true;
    debugLog(`connection lost: ${message}`);
    void this.closeScope().then(() => this.scheduleReconnect(message));
  }

  private scheduleReconnect(message: string): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.reconnectAttempt++;
    this.setShell({ status: { type: "reconnecting", message } });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start();
    }, delay);
  }

  private async closeScope(): Promise<void> {
    const scope = this.scope;
    this.scope = null;
    this.connection = null;
    for (const entry of this.threads.values()) entry.fiber = null;
    for (const entry of this.feeds.values()) entry.fiber = null;
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
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

  /** Applies the patch now but tells listeners at most once per THREAD_NOTIFY_MS. */
  private setThread(threadId: ThreadId, patch: Partial<ThreadState>): void {
    const entry = this.threads.get(threadId);
    if (!entry) return;
    entry.state = { ...entry.state, ...patch };
    if (entry.notifyTimer) return;
    // The first snapshot, status and history changes show at once; streamed events batch.
    const immediate = patch.status !== undefined || patch.history !== undefined || entry.state.status === "loading";
    const notify = () => {
      entry.notifyTimer = null;
      for (const listener of entry.listeners) listener(entry.state);
    };
    if (immediate) notify();
    else entry.notifyTimer = setTimeout(notify, THREAD_NOTIFY_MS);
  }
}

const isSocketFailure = (message: string) => /Socket(Close|Open|Generic)?Error|socket/i.test(message);

const newCommandId = () => CommandId.make(crypto.randomUUID());

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const prettyCause = (cause: unknown) => {
  const text = String((cause as { toString?: () => string })?.toString?.() ?? cause);
  return text.split("\n")[0] ?? text;
};
