import {
  buildPendingUserInputAnswers,
  resolvePendingUserInputAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import type { ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import type { ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import type { Binding } from "../model/keymap.ts";
import type { T3Session } from "../client/session.ts";

interface QuestionDraft {
  readonly index: number;
  readonly answers: Record<string, PendingUserInputDraftAnswer>;
}

/**
 * The web composer's question flow: one question at a time, picked by digit or click or typed
 * in the composer, answered together once all are in.
 */
export function useQuestion(deps: {
  readonly session: T3Session;
  readonly threadId: ThreadId | undefined;
  /** The question waiting in the open thread. */
  readonly request: ThreadPendingUserInput | undefined;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  readonly say: (text: string, bad?: boolean) => void;
}) {
  const { session, threadId, request, run, say } = deps;
  const [drafts, setDrafts] = useState<ReadonlyMap<string, QuestionDraft>>(new Map());
  const draft = request ? (drafts.get(request.requestId) ?? { index: 0, answers: {} }) : undefined;
  const question = request && draft ? request.questions[draft.index] : undefined;
  const save = (requestId: string, next: QuestionDraft) => setDrafts((map) => new Map(map).set(requestId, next));

  /** Moves on: the next question, or the answers once all are in. */
  const advance = (next: QuestionDraft) => {
    if (!threadId || !request) return;
    const asked = request.questions[next.index];
    if (!asked || resolvePendingUserInputAnswer(asked, next.answers[asked.id]) === null) {
      save(request.requestId, next);
      return say("Pick an option or type an answer.", true);
    }
    if (next.index + 1 < request.questions.length) return save(request.requestId, { ...next, index: next.index + 1 });
    const answers = buildPendingUserInputAnswers(request.questions, next.answers);
    if (!answers) return say("Some questions are unanswered.", true);
    save(request.requestId, next);
    run("Answered", () => session.answer(threadId, request.requestId, answers));
  };

  const pick = (optionIndex: number) => {
    if (!request || !draft || !question) return;
    const option = question.options[optionIndex];
    if (!option) return;
    const next = { ...draft, answers: { ...draft.answers, [question.id]: togglePendingUserInputOptionSelection(question, draft.answers[question.id], option.value ?? option.label) } };
    save(request.requestId, next);
    // Single choice moves on by itself, after a beat to show the pick.
    if (!question.multiSelect) setTimeout(() => advance(next), 200);
  };

  /** A typed answer from the composer; empty sends what's picked. */
  const answer = (text: string) => {
    if (!draft || !question) return;
    const typed = text ? setPendingUserInputCustomAnswer(question, draft.answers[question.id], text) : draft.answers[question.id];
    advance({ ...draft, answers: { ...draft.answers, ...(typed ? { [question.id]: typed } : {}) } });
  };

  const next = () => draft && advance(draft);

  const dismiss = threadId && request?.dismissible ? () => run("Dismissed", () => session.dismissQuestion(threadId, request.requestId)) : undefined;

  const keys = request
    ? {
        pick: { keys: [], label: "1-9", hint: "pick" } satisfies Binding,
        digits: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit): Binding => ({ keys: [String(digit)], run: () => pick(digit - 1) })),
        dismiss: dismiss ? ({ keys: ["x"], run: dismiss, hint: "dismiss", command: { id: "dismiss", title: "Dismiss question" } } satisfies Binding) : null,
      }
    : null;

  return { request, draft, question, pick, answer, next, dismiss, keys };
}
