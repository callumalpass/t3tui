import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { secretRequestAnswerInput } from "@t3tools/client-runtime/secret-request";
import type { KeyEvent } from "@opentui/core";
import { usePaste } from "@opentui/react";
import { useEffect, useState } from "react";

import type { T3Session } from "../client/session.ts";
import type { Binding } from "../model/keymap.ts";
import { pendingSecretRequest } from "../model/queue.ts";

const decoder = new TextDecoder();

/**
 * The open thread's pending secret request and its masked field. The field takes keys itself
 * (the composer never sees the value, so it can't be sent as a message by mistake).
 */
export function useSecretRequest(input: {
  readonly session: T3Session;
  readonly projection: OrchestrationV2ThreadProjection | null | undefined;
  /** x dismisses a question first, so it only declines the secret when no question is open. */
  readonly questionPending: boolean;
}) {
  const request = input.projection ? pendingSecretRequest(input.projection) : null;
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(null);
    setError(null);
  }, [request?.id]);

  usePaste((event) => {
    if (value === null) return;
    event.preventDefault();
    setValue(value + decoder.decode(event.bytes).replace(/[\r\n]+/g, ""));
  });

  const answer = (reply: { readonly type: "save"; readonly secret: string } | { readonly type: "decline" }) => {
    const answerInput = request ? secretRequestAnswerInput(request, reply) : null;
    if (!answerInput || busy) return;
    setBusy(true);
    setError(null);
    input.session
      .answerSecret(answerInput)
      .then(() => setValue(null))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setBusy(false));
  };

  /** Typing in the focused field: characters, backspace and ctrl+u. Every key stays here. */
  const type = (event: KeyEvent) => {
    if (value === null) return;
    if (event.name === "backspace") setValue(value.slice(0, -1));
    else if (event.ctrl && event.name === "u") setValue("");
    else if (!event.ctrl && !event.meta && event.sequence.length === 1 && event.sequence >= " ") setValue(value + event.sequence);
  };

  const actions = {
    focus: () => setValue(""),
    cancel: () => setValue(null),
    save: () => value !== null && answer({ type: "save", secret: value }),
    decline: () => answer({ type: "decline" }),
  };

  const keywords = ["password", "token", "key", "credential"];
  /** On the card in navigation: enter opens the field, x declines. While the field is focused: its own keys. */
  const bindings: Binding[] = !request
    ? []
    : value === null
      ? [
          { keys: ["enter"], run: actions.focus, hint: "answer the secret request", command: { id: "secret-answer", title: `Answer secret request: ${request.label}`, keywords } },
          { keys: input.questionPending ? [] : ["x"], run: actions.decline, ...(input.questionPending ? {} : { hint: "decline" }), command: { id: "secret-decline", title: `Decline secret request: ${request.label}`, keywords } },
        ]
      : [
          { keys: [], label: "", hint: "type or paste the secret" },
          { keys: ["enter"], run: actions.save, hint: "save securely" },
          { keys: ["esc"], run: actions.cancel, hint: "cancel" },
        ];

  return { request, value, error, busy, focused: value !== null, bindings, type, actions };
}
