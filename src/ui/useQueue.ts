import type { ModelSelection, OrchestrationV2ThreadProjection, RunId, ThreadId } from "@t3tools/contracts";
import { queuedRunEditBlockedReason, resolveQueuedEditExit } from "@t3tools/client-runtime/queued-run-edit";
import type { TextareaRenderable } from "@opentui/core";
import { useEffect, useState } from "react";

import type { T3Session } from "../client/session.ts";
import type { Binding } from "../model/keymap.ts";
import { queueState, type QueuedMessage } from "../model/queue.ts";

interface QueuedEdit {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly original: string;
  /** The composer's own draft, put back when the edit ends. */
  readonly stash: string;
}

/**
 * The web's queue controls for the open thread: send a queued message now, edit it in the
 * composer, remove it, and resume after an interrupt.
 */
export function useQueue(input: {
  readonly session: T3Session;
  readonly threadId: ThreadId | undefined;
  readonly projection: OrchestrationV2ThreadProjection | null | undefined;
  readonly composer: () => TextareaRenderable | null;
  readonly openQuestionCount: number;
  readonly modelSelection: ModelSelection | undefined;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  readonly say: (text: string, bad?: boolean) => void;
  readonly toInput: () => void;
}) {
  const { session, threadId, run, say } = input;
  const queue = input.projection ? queueState(input.projection) : null;
  const queued = queue?.queued ?? [];
  const [focusRaw, setFocus] = useState<number | null>(null);
  const focus = focusRaw === null || queued.length === 0 ? null : Math.min(focusRaw, queued.length - 1);
  const [editing, setEditing] = useState<QueuedEdit | null>(null);

  const setComposer = (text: string) => {
    const composer = input.composer();
    composer?.setText(text);
    composer?.gotoBufferEnd();
  };

  // An edit ends when the thread changes, or when its message leaves the queue (sent or removed).
  const editLeftQueue = editing !== null && queue !== null && !queued.some((message) => message.runId === editing.runId);
  useEffect(() => {
    if (editing && editing.threadId !== threadId) setEditing(null);
  }, [threadId]);
  useEffect(() => {
    if (!editLeftQueue || !editing) return;
    const exit = resolveQueuedEditExit({ editChanged: (input.composer()?.plainText ?? "") !== editing.original, threadDraftEmpty: editing.stash.trim() === "" });
    if (exit !== "kept") setComposer(editing.stash);
    say(exit === "kept" ? "That message left the queue; your edit stays in the composer" : "That message left the queue");
    setEditing(null);
  }, [editLeftQueue]);

  const beginEdit = (message: QueuedMessage) => {
    if (!threadId) return;
    if (!message.editable) return say("A guest's message can be removed, not edited", true);
    const blocked = queuedRunEditBlockedReason({ openQuestionCount: input.openQuestionCount });
    if (blocked) return say(blocked, true);
    const stash = editing ? editing.stash : (input.composer()?.plainText ?? "");
    setEditing({ threadId, runId: message.runId, original: message.text, stash });
    setComposer(message.text);
    setFocus(null);
    input.toInput();
  };

  const cancelEdit = () => {
    if (!editing) return;
    setComposer(editing.stash);
    setEditing(null);
  };

  const sendNow = (message: QueuedMessage) => {
    if (!threadId || !queue) return;
    if (queue.canSendNow) return run("Sent", () => session.startQueuedRun(threadId, message.runId));
    if (queue.canPromoteToSteer && queue.activeRunId) return run("Steered", () => session.promoteQueuedRun(threadId, message.runId, queue.activeRunId!));
    say("This message waits for the current run to finish", true);
  };

  const remove = (message: QueuedMessage) => threadId && run("Removed from queue", () => session.cancelQueuedRun(threadId, message.runId));

  const canResume = queue !== null && (queue.resumableRunId !== null || queue.held);
  const resume = () => {
    if (!threadId || !queue || !canResume) return;
    run(queue.resumableRunId ? "Continuing" : "Sending held messages", () => session.continueRun(threadId, queue.resumableRunId, queue.held, input.modelSelection));
  };

  /** Enter in the composer: saves an edit, or resumes when the box is empty. True when handled. */
  const submit = (text: string): boolean => {
    if (editing && threadId) {
      if (!text) {
        say("A queued message can't be empty; Q then x removes it", true);
        return true;
      }
      const { runId, stash } = editing;
      setEditing(null);
      setComposer(stash);
      run("Queued message updated", () => session.editQueuedRun(threadId, runId, text));
      return true;
    }
    if (!text && canResume) {
      resume();
      return true;
    }
    return false;
  };

  const first = queued[0];
  const last = queued[queued.length - 1];
  const focused = focus === null ? undefined : queued[focus];
  const onFocused = (action: (message: QueuedMessage) => void) => () => focused && action(focused);
  const keys = {
    /** In navigation: Q goes through the queue. */
    nav: queued.length > 0 ? [{ keys: ["Q"], run: () => setFocus(0), hint: "queue", command: { id: "queue-focus", title: "Queue: go through queued messages", keywords: ["remove", "cancel", "delete"] } }] : [],
    /** While going through the queue: the focused message's keys. */
    focused: focus === null ? [] : [
      { keys: ["j", "↓"], label: "j/k", run: () => setFocus(Math.min(queued.length - 1, focus + 1)), hint: "move" },
      { keys: ["k", "↑"], run: () => setFocus(Math.max(0, focus - 1)) },
      { keys: ["enter", "s"], run: onFocused(sendNow), hint: "send now" },
      { keys: ["e"], run: onFocused(beginEdit), hint: "edit" },
      { keys: ["x", "d", "backspace"], run: onFocused(remove), hint: "remove" },
      { keys: ["esc", "q"], run: () => setFocus(null), hint: "back" },
    ],
    /** In the composer: the web's alt+↑ edits the last queued message. */
    input: last && !editing ? [{ keys: ["alt+↑"], run: () => beginEdit(last), hint: "edit queued", command: { id: "queue-edit", title: "Queue: edit last queued message", keywords: ["change"] } }] : [],
    /** In the composer while it holds a queued message. */
    editing: editing ? [
      { keys: ["enter"], label: "enter", hint: "save the queued message" },
      { keys: ["esc"], run: cancelEdit, hint: "cancel the edit" },
    ] : [],
    /** Palette-only commands. */
    palette: [
      ...(first && queue && (queue.canSendNow || queue.canPromoteToSteer) ? [{ keys: [], run: () => sendNow(first), command: { id: "queue-send", title: "Queue: send first queued message", keywords: ["steer", "now"] } }] : []),
      ...queued.map((message, index) => ({ keys: [], run: () => remove(message), command: { id: `queue-remove:${message.runId}`, title: `Queue: remove ${index + 1}. ${message.text.replace(/\s+/g, " ").slice(0, 60)}`, keywords: ["cancel", "delete"] } })),
      ...(canResume ? [{ keys: [], run: resume, command: { id: "queue-resume", title: queue?.resumableRunId ? "Continue where it left off" : "Send held queued messages", keywords: ["resume", "interrupted"] } }] : []),
    ],
  } satisfies Record<string, Binding[]>;

  const placeholder = editing ? "Edit the queued message (enter saves, esc cancels)" : canResume ? (queue?.resumableRunId ? "Ask anything, or press enter to continue where it left off" : "Ask anything, or press enter to send the held messages") : null;

  const at = (index: number, action: (message: QueuedMessage) => void) => () => {
    const message = queued[index];
    if (message) action(message);
  };
  const actions = {
    focus: (index: number) => setFocus(index),
    sendNow: (index: number) => at(index, sendNow)(),
    edit: (index: number) => at(index, beginEdit)(),
    remove: (index: number) => at(index, remove)(),
    resume: canResume ? resume : null,
  };

  return { queue, queued, focus, focused: focus !== null, editingRunId: editing?.runId ?? null, editing: editing !== null, keys, submit, placeholder, actions };
}
