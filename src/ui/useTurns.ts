import type { ScrollBoxRenderable } from "@opentui/core";
import type { OrchestrationV2ThreadProjection, ServerConfig, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { T3Session } from "../client/session.ts";
import type { Binding } from "../model/keymap.ts";
import type { Timeline } from "../model/timeline.ts";
import { recallableComposerPrompt } from "../../vendor/t3code/apps/web/src/components/chat/composerPromptHistory.ts";
import { adjacentTurn, diffTurn, findRevertCheckpoint, type TurnCheckpoint } from "../model/turns.ts";
import type { Confirmation } from "./ConfirmBar.tsx";
import type { DiffState } from "./DiffView.tsx";
import { useDiffContext } from "./useDiffContext.ts";

/** Turn navigation, checkpoint review and rewind stay local to the open conversation. */
export function useTurns(input: {
  readonly session: T3Session;
  readonly threadId: ThreadId | undefined;
  readonly projection: OrchestrationV2ThreadProjection | null | undefined;
  readonly timeline: Timeline | null;
  readonly config: ServerConfig | null;
  readonly cwd: string | null;
  readonly ignoreWhitespace: boolean;
  readonly enabled: boolean;
  readonly diff: DiffState | null;
  readonly setDiff: Dispatch<SetStateAction<DiffState | null>>;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly confirm: (confirmation: Confirmation) => void;
  readonly say: (text: string, bad?: boolean) => void;
  readonly showConversation: () => void;
  readonly restorePrompt: (threadId: ThreadId, text: string) => void;
}) {
  const [cursor, setCursor] = useState<{ threadId: ThreadId; messageId: string } | null>(null);
  const [reverting, setReverting] = useState(false);
  const currentThread = useRef(input.threadId);
  currentThread.current = input.threadId;
  const turns = input.timeline?.turns ?? [];
  const selectedMessageId = input.enabled && cursor !== null && cursor.threadId === input.threadId && turns.some((turn) => turn.messageId === cursor.messageId) ? cursor.messageId : null;
  const selected = turns.find((turn) => turn.messageId === selectedMessageId);
  const diffContext = useDiffContext(input.session, input.diff, input.scrollRef);
  useEffect(() => { setCursor(null); }, [input.threadId]);

  const move = (direction: -1 | 1) => {
    const next = adjacentTurn(turns, selectedMessageId, direction);
    if (!next || !input.threadId) return;
    input.setDiff(null);
    input.showConversation();
    setCursor({ threadId: input.threadId, messageId: next.messageId });
    setTimeout(() => input.scrollRef.current?.scrollChildIntoView(`turn-${next.messageId}`), 0);
  };
  /** A click or right-click on a prompt points the cursor at it without scrolling away. */
  const select = (messageId: string) => {
    if (input.threadId && turns.some((turn) => turn.messageId === messageId)) setCursor({ threadId: input.threadId, messageId });
  };
  const openDiff = (fullThread: boolean, messageId = selectedMessageId) => {
    const checkpoint = fullThread
      ? turns.map((turn) => turn.checkpoint).filter((checkpoint): checkpoint is TurnCheckpoint => checkpoint?.status === "ready").sort((a, b) => b.checkpointTurnCount - a.checkpointTurnCount)[0]
      : diffTurn(turns, messageId);
    if (!checkpoint) return input.say("No changes from this turn.");
    showDiff(checkpoint.checkpointTurnCount, fullThread);
  };
  /** The changed-files line's diff: it already knows its checkpoint's turn count. */
  const openTurnDiff = (checkpointTurnCount: number) => showDiff(checkpointTurnCount, false);
  const showDiff = (toTurnCount: number, fullThread: boolean) => {
    if (!input.threadId || !input.cwd) return input.say("No changes from this turn.");
    const state: DiffState = { cwd: input.cwd, path: null, title: fullThread ? "Changes" : `Turn ${toTurnCount}`, status: "loading" };
    input.setDiff(state);
    input.showConversation();
    const request = { threadId: input.threadId, toTurnCount, ignoreWhitespace: input.ignoreWhitespace };
    const pending = fullThread ? input.session.fullThreadDiff(request) : input.session.turnDiff({ ...request, fromTurnCount: Math.max(0, toTurnCount - 1) });
    pending.then(
      (result) => input.setDiff((current) => current === state ? { ...state, status: "ready", patch: result.diff } : current),
      (error) => input.setDiff((current) => current === state ? { ...state, status: "error", error: messageOf(error) } : current),
    );
  };
  const revert = (restoreFiles = false, target = selected) => {
    const projection = input.projection;
    if (!target || !projection || reverting) return input.say("Select a turn with [ or ] first.");
    const provider = input.config?.providers.find((provider) => provider.instanceId === projection.thread.providerInstanceId);
    if (!provider || provider.supportsConversationRollback === false) return input.say("This provider does not support reverting conversation history. Start a new thread instead.", true);
    if (input.timeline?.isWorking) return input.say("Interrupt the current turn before reverting checkpoints.", true);
    const turnCount = target.revertTurnCount;
    const checkpoint = turnCount === undefined ? undefined : findRevertCheckpoint(projection.checkpoints, turnCount);
    if (turnCount === undefined || !checkpoint) return input.say("This message has no available checkpoint to rewind to.", true);
    if (target.hasAttachments) return input.say("Use the T3 Code app to rewind a message with attachments.", true);
    input.confirm({
      title: "Edit from here?",
      detail: "Rewind chat to before this message. Your prompt returns to the composer. “Revert files too” also undoes your own edits.",
      confirmLabel: restoreFiles ? "Revert files too" : "Revert and keep changes",
      run: () => {
        setReverting(true);
        input.session.rewind(projection, checkpoint, turnCount, restoreFiles).then(() => {
          input.restorePrompt(projection.thread.id, recallableComposerPrompt(target.text));
          if (currentThread.current === projection.thread.id) { setCursor(null); input.setDiff(null); }
          input.say("Thread rewound");
        }, (error) => input.say(`Could not rewind: ${messageOf(error)}`, true)).finally(() => setReverting(false));
      },
    });
  };
  const turnKeys = input.enabled && turns.length > 0;
  /**
   * Turn keys in navigation. A diff's own keys come first: there, [ and ] step through its
   * files rather than the turns.
   */
  const bindings: Binding[] = [
    ...(input.enabled && input.diff
      ? [
          { keys: ["["], run: () => diffContext.move(-1), command: { id: "diff-previous-file", title: "Previous changed file", keywords: ["diff"] } },
          { keys: ["]"], run: () => diffContext.move(1), command: { id: "diff-next-file", title: "Next changed file", keywords: ["diff"] } },
          ...(input.diff.source ? [{ keys: ["x", "enter"], run: () => diffContext.expand(), command: { id: "diff-context", title: "Show whole file / collapse context", keywords: ["diff", "expand", "unchanged"] } }] : []),
        ]
      : []),
    ...(turnKeys
      ? [
          { keys: ["["], run: () => move(-1), command: { id: "previous-turn", title: "Select previous turn", keywords: ["turn", "cursor"] } },
          { keys: ["]"], run: () => move(1), command: { id: "next-turn", title: "Select next turn", keywords: ["turn", "cursor"] } },
          { keys: ["D"], run: () => openDiff(false), command: { id: "turn-diff", title: "View changes from this turn", keywords: ["diff", "checkpoint"] } },
          { keys: [], run: () => openDiff(true), command: { id: "thread-diff", title: "View all changes in this thread", keywords: ["diff", "checkpoint"] } },
          // R says how to select a turn when none is.
          { keys: ["R"], run: () => revert(), ...(selected ? { command: { id: "turn-revert", title: "Revert to this turn", keywords: ["rollback", "rewind", "keep changes"] } } : {}) },
        ]
      : []),
    ...(turnKeys && selected
      ? [
          { keys: [], run: () => revert(true), command: { id: "turn-revert-files", title: "Revert files too", keywords: ["rollback", "rewind", "turn"] } },
          ...(input.diff ? [] : [{ keys: ["esc"], run: () => setCursor(null), command: { id: "turn-clear", title: "Clear turn selection" } }]),
        ]
      : []),
  ];
  /** The prompt's right-click menu. */
  const menuFor = (messageId: string) => {
    const turn = turns.find((candidate) => candidate.messageId === messageId);
    if (!turn) return [];
    const run = (action: () => void) => () => { select(messageId); action(); };
    return [
      { id: "turn-select", title: "Select this turn", hint: "[ ]", run: run(() => undefined) },
      { id: "turn-diff", title: "View changes from this turn", hint: "D", run: run(() => openDiff(false, messageId)) },
      ...(turn.revertTurnCount !== undefined ? [
        { id: "turn-revert", title: "Revert to before this prompt…", hint: "R", run: run(() => revert(false, turn)) },
        { id: "turn-revert-files", title: "Revert files too…", run: run(() => revert(true, turn)) },
      ] : []),
    ];
  };
  return { selectedMessageId, bindings, diffContext, select, menuFor, openTurnDiff };
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
