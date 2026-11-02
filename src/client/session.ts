import {
  CommandId,
  type OrchestrationGetTurnDiffInput,
  type OrchestrationGetFullThreadDiffInput,
  type ReviewDiffFileContentsInput,
  type OrchestrationV2Checkpoint,
  type TurnItemId,
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
  type ServerConfig,
  type ModelSelection,
  type OrchestrationMessageContext,
  type ProjectEntry,
  type RuntimeMode,
  type TerminalAttachStreamEvent,
  type TerminalSummary,
  type VcsRef,
  type OrchestrationV2ThreadLaunchInput,
  type OrchestrationV2ThreadShell,
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
import { applyCommandOutputFrame, EMPTY_COMMAND_OUTPUT, type CommandOutputView } from "@t3tools/client-runtime/state/command-output";
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

export interface ServerConfigState {
  readonly status: "loading" | "live" | "error";
  readonly config: ServerConfig | null;
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

  /** The server's config and settings, kept current as they change in the app. */
  watchServerConfig(listener: Listener<ServerConfigState>): () => void {
    return this.watchFeed<ServerConfigState>("config", { status: "loading", config: null }, listener, (update) =>
      this.requireConnection()
        .rpc[WS_METHODS.subscribeServerConfig]({})
        .pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              const current = this.feeds.get("config")?.state as ServerConfigState | undefined;
              const config = current?.config;
              switch (event.type) {
                case "snapshot":
                  return update({ status: "live", config: event.config });
                case "settingsUpdated":
                  return config && update({ config: { ...config, settings: event.payload.settings } });
                case "providerStatuses":
                  return config && update({ config: { ...config, providers: event.payload.providers } });
                case "keybindingsUpdated":
                  return config && update({ config: { ...config, keybindings: event.payload.keybindings, issues: event.payload.issues } });
              }
            }),
          ),
        ),
    );
  }

  /**
   * Every thread sharing this one's root, idle subagents included: the shell leaves those out.
   * Only for servers whose config advertises `shellThreadFamilies`.
   */
  async threadFamily(threadId: ThreadId): Promise<readonly OrchestrationV2ThreadShell[]> {
    const family = await Effect.runPromise(this.requireConnection().rpc[ORCHESTRATION_V2_WS_METHODS.getThreadFamily]({ threadId }));
    return family.threads;
  }

  /** The uncommitted diff (git diff HEAD, untracked files included), for one file or the whole tree. */
  async workingTreeDiff(cwd: string, path?: string, ignoreWhitespace = true): Promise<ReviewDiffPreviewSource | null> {
    const rpc = this.requireConnection().rpc;
    const result = await Effect.runPromise(
      rpc[WS_METHODS.reviewGetDiffPreview]({ cwd, ignoreWhitespace, ...(path ? { file: { path, previousPath: null, sourceKind: "working-tree" as const } } : {}) }),
    );
    return result.sources.find((source) => source.kind === "working-tree") ?? null;
  }

  /** Checkpoint ranges, matching the web's turn and thread diff selections. */
  turnDiff(input: OrchestrationGetTurnDiffInput) {
    return Effect.runPromise(this.requireConnection().rpc[ORCHESTRATION_V2_WS_METHODS.getTurnDiff](input));
  }

  fullThreadDiff(input: OrchestrationGetFullThreadDiffInput) {
    return Effect.runPromise(this.requireConnection().rpc[ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff](input));
  }

  diffFileContents(input: ReviewDiffFileContentsInput) {
    return Effect.runPromise(this.requireConnection().rpc[WS_METHODS.reviewGetDiffFileContents](input));
  }

  /** Expanded commands have no linger: closing their row stops the stream immediately. */
  watchCommandOutput(threadId: ThreadId, itemId: TurnItemId, listener: Listener<CommandOutputView>, onError: Listener<string>): () => void {
    let view = EMPTY_COMMAND_OUTPUT;
    const fiber = this.runInScope(this.requireConnection().rpc[ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput]({ threadId, itemId }).pipe(
      Stream.runForEach((frame) => Effect.sync(() => listener(view = applyCommandOutputFrame(view, frame)))),
      Effect.catchCause((cause) => Effect.sync(() => onError(prettyCause(cause)))),
    ));
    return () => { Effect.runFork(Fiber.interrupt(fiber)); };
  }

  /** Sends the checkpoint identity captured before opening the confirmation. */
  rollback(threadId: ThreadId, checkpoint: Pick<OrchestrationV2Checkpoint, "id" | "scopeId">, restoreFiles: boolean, commandId = newCommandId()): Promise<void> {
    return this.dispatch({ type: "checkpoint.rollback", commandId, threadId, scopeId: checkpoint.scopeId, checkpointId: checkpoint.id, restoreFiles });
  }

  /** Waits for the settled suffix and provider conversation to rewind, as the web does. */
  async rewind(initial: OrchestrationV2ThreadProjection, checkpoint: Pick<OrchestrationV2Checkpoint, "id" | "scopeId">, turnCount: number, restoreFiles: boolean): Promise<void> {
    const witness = initial.runs.filter((run) => run.ordinal > turnCount && ["completed", "interrupted", "failed", "cancelled"].includes(run.status))
      .sort((a, b) => b.ordinal - a.ordinal)[0];
    if (!witness) throw new Error("The thread has changed. Select a message to rewind again.");
    const providerThread = initial.providerThreads.find((thread) => thread.id === initial.thread.activeProviderThreadId);
    const commandId = newCommandId();
    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      let state: ThreadState | null = null;
      let unwatch = () => {};
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        unwatch();
        if (error !== undefined) reject(error); else resolve();
      };
      const inspect = () => {
        const next = state?.projection;
        if (!next) return;
        if (next.thread.rollbackFailure?.requestId === commandId) return finish(new Error(next.thread.rollbackFailure.message));
        const providerRewound = next.providerThreads.some((thread) => {
          const sameThread = thread.id === providerThread?.id;
          const freshRoot = turnCount === 0 && thread.ownerNodeId === null && thread.appThreadId === initial.thread.id &&
            thread.providerInstanceId === providerThread?.providerInstanceId && !initial.providerThreads.some((old) => old.id === thread.id);
          return (sameThread || freshRoot) && thread.lastRunOrdinal === (turnCount === 0 ? null : turnCount);
        });
        if (accepted && providerRewound && next.runs.some((run) => run.id === witness.id && run.status === "rolled_back")) finish();
      };
      const timer = setTimeout(() => finish(new Error("Timed out waiting for the thread to rewind.")), 120_000);
      unwatch = this.watchThread(initial.thread.id, (next) => { state = next; inspect(); });
      this.rollback(initial.thread.id, checkpoint, restoreFiles, commandId).then(() => { accepted = true; inspect(); }, finish);
    });
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
  /** `modelSelection` switches the thread's model (and options) with this message, as the web composer does. */
  /** `context` carries the records for thread mentions in the text. */
  sendMessage(threadId: ThreadId, text: string, mode: ComposerDispatchMode = "auto", modelSelection?: ModelSelection, context?: OrchestrationMessageContext): Promise<void> {
    const commandId = newCommandId();
    return this.dispatch({
      type: "message.dispatch",
      commandId,
      threadId,
      messageId: MessageId.make(commandId),
      text,
      attachments: [],
      ...(context ? { context } : {}),
      ...(modelSelection ? { modelSelection } : {}),
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

  // The thread menu's actions, as the web's useThreadActions sends them.
  settleThread(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.settle", commandId: newCommandId(), threadId });
  }

  /** reason "user" keeps it active until real activity, so auto-settle leaves it alone. */
  unsettleThread(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.unsettle", commandId: newCommandId(), threadId, reason: "user" });
  }

  pinThread(threadId: ThreadId, orderKey?: string): Promise<void> {
    return this.dispatch({ type: "thread.pin", commandId: newCommandId(), threadId, ...(orderKey ? { orderKey } : {}) });
  }

  unpinThread(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.unpin", commandId: newCommandId(), threadId });
  }

  snoozeThread(threadId: ThreadId, snoozedUntil: string): Promise<void> {
    return this.dispatch({ type: "thread.snooze", commandId: newCommandId(), threadId, snoozedUntil });
  }

  unsnoozeThread(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.unsnooze", commandId: newCommandId(), threadId, reason: "user" });
  }

  setAutoSettle(threadId: ThreadId, enabled: boolean): Promise<void> {
    return this.dispatch({ type: "thread.auto-settle.set", commandId: newCommandId(), threadId, enabled });
  }

  markUnread(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.mark-unread", commandId: newCommandId(), threadId });
  }

  renameThread(threadId: ThreadId, title: string): Promise<void> {
    return this.dispatch({ type: "thread.metadata.update", commandId: newCommandId(), threadId, title });
  }

  regenerateTitle(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.metadata.update", commandId: newCommandId(), threadId, regenerateTitle: true });
  }

  archiveThread(threadId: ThreadId): Promise<void> {
    return this.dispatch({ type: "thread.archive", commandId: newCommandId(), threadId });
  }

  /**
   * Deletes the thread. One with a runtime has its provider sessions detached first, as the
   * web's stopThreadSession does; their ids come from the thread's projection.
   */
  async deleteThread(threadId: ThreadId, hasRuntime: boolean): Promise<void> {
    if (hasRuntime) {
      const projection = await this.projectionOnce(threadId);
      const commandId = newCommandId();
      for (const providerSession of projection.providerSessions) {
        await this.dispatch({ type: "provider-session.detach", commandId: CommandId.make(`${commandId}:detach:${providerSession.id}`), threadId, providerSessionId: providerSession.id, reason: "client-requested" });
      }
    }
    return this.dispatch({ type: "thread.delete", commandId: newCommandId(), threadId });
  }

  /** The thread's projection, subscribing just long enough to get it. */
  private projectionOnce(threadId: ThreadId): Promise<OrchestrationV2ThreadProjection> {
    return new Promise((resolve, reject) => {
      let unwatch: (() => void) | null = null;
      let done = false;
      const finish = (action: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        queueMicrotask(() => unwatch?.());
        action();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("The thread did not load."))), 10_000);
      unwatch = this.watchThread(threadId, (state) => {
        if (state.projection) finish(() => resolve(state.projection!));
        else if (state.status === "error") finish(() => reject(new Error(state.error ?? "The thread did not load.")));
      });
      if (done) unwatch();
    });
  }

  setRuntimeMode(threadId: ThreadId, runtimeMode: RuntimeMode): Promise<void> {
    return this.dispatch({ type: "thread.runtime-mode.set", commandId: newCommandId(), threadId, runtimeMode });
  }

  /**
   * Creates a thread and sends its first message in one call, as the web app does when a
   * draft is first sent. Resolves with the new thread's id.
   */
  async launchThread(input: Omit<OrchestrationV2ThreadLaunchInput, "commandId" | "initialMessage"> & { readonly text: string; readonly context?: OrchestrationMessageContext | undefined }): Promise<ThreadId> {
    const { text, context, ...rest } = input;
    const commandId = newCommandId();
    const result = await Effect.runPromise(
      this.requireConnection().rpc[ORCHESTRATION_V2_WS_METHODS.launchThread]({ ...rest, commandId, initialMessage: { messageId: MessageId.make(commandId), text, ...(context ? { context } : {}), attachments: [] } }),
    );
    return result.threadId;
  }

  /** Files and folders under `cwd` matching `query`, as the composer's @ menu searches them. */
  async searchEntries(cwd: string, query: string, limit: number): Promise<readonly ProjectEntry[]> {
    const result = await Effect.runPromise(this.requireConnection().rpc[WS_METHODS.projectsSearchEntries]({ cwd, query, limit }));
    return result.entries;
  }

  /** Whether `cwd` is a repository, and its default branch (else the current one), for a new worktree's base. */
  async defaultRef(cwd: string): Promise<{ readonly isRepo: boolean; readonly ref: VcsRef | null }> {
    const result = await Effect.runPromise(this.requireConnection().rpc[WS_METHODS.vcsListRefs]({ cwd, refKind: "local" }));
    return { isRepo: result.isRepo, ref: result.refs.find((ref) => ref.isDefault) ?? result.refs.find((ref) => ref.current) ?? null };
  }

  /** Every open terminal on the server; filter by thread. */
  watchTerminals(listener: Listener<FeedState<TerminalSummary>>): () => void {
    return this.watchFeed<FeedState<TerminalSummary>>("terminals", { status: "loading", items: [] }, listener, (update) =>
      this.requireConnection()
        .rpc[WS_METHODS.subscribeTerminalMetadata]({})
        .pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              const items = (this.feeds.get("terminals")?.state as FeedState<TerminalSummary> | undefined)?.items ?? [];
              const same = (a: { threadId: string; terminalId: string }, b: { threadId: string; terminalId: string }) => a.threadId === b.threadId && a.terminalId === b.terminalId;
              switch (event.type) {
                case "snapshot":
                  return update({ status: "live", items: event.terminals });
                case "upsert":
                  return update({ status: "live", items: [...items.filter((item) => !same(item, event.terminal)), event.terminal] });
                case "remove":
                  return update({ items: items.filter((item) => !same(item, event)) });
              }
            }),
          ),
        ),
    );
  }

  /**
   * Attaches to a terminal (opening it in `cwd` if it isn't running) and streams its events.
   * Returns a function that detaches; the terminal keeps running.
   */
  attachTerminal(
    input: { readonly threadId: ThreadId; readonly terminalId: string; readonly cwd: string; readonly worktreePath: string | null; readonly cols: number; readonly rows: number },
    onEvent: Listener<TerminalAttachStreamEvent>,
    onEnd: (error?: string) => void,
  ): () => void {
    const fiber = Effect.runFork(
      this.requireConnection()
        .rpc[WS_METHODS.terminalAttach]({ ...input, restartIfNotRunning: true })
        .pipe(
          Stream.runForEach((event) => Effect.sync(() => onEvent(event))),
          Effect.match({ onFailure: (error) => onEnd(messageOf(error)), onSuccess: () => onEnd() }),
        ),
    );
    return () => void Effect.runFork(Fiber.interrupt(fiber));
  }

  writeTerminal(threadId: ThreadId, terminalId: string, data: string): Promise<void> {
    return Effect.runPromise(this.requireConnection().rpc[WS_METHODS.terminalWrite]({ threadId, terminalId, data }));
  }

  resizeTerminal(threadId: ThreadId, terminalId: string, cols: number, rows: number): Promise<void> {
    return Effect.runPromise(this.requireConnection().rpc[WS_METHODS.terminalResize]({ threadId, terminalId, cols, rows }));
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
