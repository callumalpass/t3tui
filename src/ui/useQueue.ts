import type { ModelSelection, OrchestrationV2ThreadProjection, RunId, ThreadId } from "@t3tools/contracts";
import { queuedRunEditBlockedReason, resolveQueuedEditExit } from "@t3tools/client-runtime/queued-run-edit";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useEffect, useState } from "react";

import type { T3Session } from "../client/session.ts";
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

  const key = (event: KeyEvent, mode: "nav" | "input" | "other"): boolean => {
    if (mode === "nav" && focus !== null) {
      const message = queued[focus]!;
      switch (event.name) {
        case "j":
        case "down":
          return setFocus(Math.min(queued.length - 1, focus + 1)), true;
        case "k":
        case "up":
          return setFocus(Math.max(0, focus - 1)), true;
        case "return":
        case "s":
          return sendNow(message), true;
        case "e":
          return beginEdit(message), true;
        case "x":
        case "d":
        case "backspace":
          return remove(message), true;
        case "escape":
        case "q":
          return setFocus(null), true;
      }
      return false;
    }
    if (mode === "nav" && event.name === "q" && event.shift && queued.length > 0) return setFocus(0), true;
    // The web's alt+↑: edit the last queued message.
    if (mode === "input" && event.meta && event.name === "up" && !editing && queued.length > 0) return beginEdit(queued[queued.length - 1]!), true;
    if (mode === "input" && event.name === "escape" && editing) return cancelEdit(), true;
    return false;
  };

  const first = queued[0];
  const last = queued[queued.length - 1];
  const commands = [
    ...(first && queue && (queue.canSendNow || queue.canPromoteToSteer) ? [{ id: "queue-send", title: "Queue: send first queued message", run: () => sendNow(first), keywords: ["steer", "now"] }] : []),
    ...(last ? [{ id: "queue-edit", title: "Queue: edit last queued message", run: () => beginEdit(last), shortcut: "alt+↑", keywords: ["change"] }] : []),
    ...(queued.length > 0 ? [{ id: "queue-focus", title: "Queue: go through queued messages", run: () => setFocus(0), shortcut: "Q", keywords: ["remove", "cancel", "delete"] }] : []),
    ...queued.map((message, index) => ({ id: `queue-remove:${message.runId}`, title: `Queue: remove ${index + 1}. ${message.text.replace(/\s+/g, " ").slice(0, 60)}`, run: () => remove(message), keywords: ["cancel", "delete"] })),
    ...(canResume ? [{ id: "queue-resume", title: queue?.resumableRunId ? "Continue where it left off" : "Send held queued messages", run: resume, keywords: ["resume", "interrupted"] }] : []),
  ];

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

  return { queue, queued, focus, focused: focus !== null, editingRunId: editing?.runId ?? null, editing: editing !== null, key, submit, commands, placeholder, actions };
}
