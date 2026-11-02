import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import type { OrchestrationV2ThreadProjection, ServerConfig, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { T3Session } from "../client/session.ts";
import type { PaletteCommand } from "../model/palette.ts";
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
  const openDiff = (fullThread: boolean) => {
    const checkpoint = fullThread
      ? turns.map((turn) => turn.checkpoint).filter((checkpoint): checkpoint is TurnCheckpoint => checkpoint?.status === "ready").sort((a, b) => b.checkpointTurnCount - a.checkpointTurnCount)[0]
      : diffTurn(turns, selectedMessageId);
    if (!input.threadId || !input.cwd || !checkpoint) return input.say("No changes from this turn.");
    const toTurnCount = checkpoint.checkpointTurnCount;
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
  const revert = (restoreFiles = false) => {
    const projection = input.projection;
    if (!selected || !projection || reverting) return input.say("Select a turn with [ or ] first.");
    const provider = input.config?.providers.find((provider) => provider.instanceId === projection.thread.providerInstanceId);
    if (!provider || provider.supportsConversationRollback === false) return input.say("This provider does not support reverting conversation history. Start a new thread instead.", true);
    if (input.timeline?.isWorking) return input.say("Interrupt the current turn before reverting checkpoints.", true);
    const turnCount = selected.revertTurnCount;
    const checkpoint = turnCount === undefined ? undefined : findRevertCheckpoint(projection.checkpoints, turnCount);
    if (turnCount === undefined || !checkpoint) return input.say("This message has no available checkpoint to rewind to.", true);
    if (selected.hasAttachments) return input.say("Use the T3 Code app to rewind a message with attachments.", true);
    input.confirm({
      title: "Edit from here?",
      detail: "Rewind chat to before this message. Your prompt returns to the composer. “Revert files too” also undoes your own edits.",
      confirmLabel: restoreFiles ? "Revert files too" : "Revert and keep changes",
      run: () => {
        setReverting(true);
        input.session.rewind(projection, checkpoint, turnCount, restoreFiles).then(() => {
          input.restorePrompt(projection.thread.id, recallableComposerPrompt(selected.text));
          if (currentThread.current === projection.thread.id) { setCursor(null); input.setDiff(null); }
          input.say("Thread rewound");
        }, (error) => input.say(`Could not rewind: ${messageOf(error)}`, true)).finally(() => setReverting(false));
      },
    });
  };
  const commands: (PaletteCommand & { readonly run: () => void })[] = input.enabled && turns.length ? [
    { id: "previous-turn", title: "Select previous turn", shortcut: "[", keywords: ["turn", "cursor"], run: () => move(-1) },
    { id: "next-turn", title: "Select next turn", shortcut: "]", keywords: ["turn", "cursor"], run: () => move(1) },
    { id: "turn-diff", title: "View changes from this turn", shortcut: "D", keywords: ["diff", "checkpoint"], run: () => openDiff(false) },
    { id: "thread-diff", title: "View all changes in this thread", keywords: ["diff", "checkpoint"], run: () => openDiff(true) },
    ...(selected ? [
      { id: "turn-revert", title: "Revert to this turn", shortcut: "R", keywords: ["rollback", "rewind", "keep changes"], run: () => revert() },
      { id: "turn-revert-files", title: "Revert files too", keywords: ["rollback", "rewind", "turn"], run: () => revert(true) },
      { id: "turn-clear", title: "Clear turn selection", shortcut: "esc", run: () => setCursor(null) },
    ] : []),
  ] : [];
  if (input.diff) {
    commands.push(
      { id: "diff-previous-file", title: "Previous changed file", shortcut: "[", keywords: ["diff"], run: () => diffContext.move(-1) },
      { id: "diff-next-file", title: "Next changed file", shortcut: "]", keywords: ["diff"], run: () => diffContext.move(1) },
    );
    if (input.diff.source) commands.push({ id: "diff-context", title: "Show whole file / collapse context", shortcut: "x", keywords: ["diff", "expand", "unchanged"], run: diffContext.expand });
  }
  const onKey = (key: KeyEvent): boolean => {
    if (key.ctrl || key.meta || !input.enabled) return false;
    if (diffContext.onKey(key)) return true;
    if (key.name === "[" || key.name === "]") { move(key.name === "[" ? -1 : 1); return true; }
    if (key.name.toLowerCase() === "d" && key.shift) { openDiff(false); return true; }
    if (key.name.toLowerCase() === "r" && key.shift) { revert(); return true; }
    if (key.name === "escape" && !input.diff && selectedMessageId) { setCursor(null); return true; }
    return false;
  };
  return { selectedMessageId, commands, onKey, diffContext };
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
