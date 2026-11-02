import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { secretRequestAnswerInput } from "@t3tools/client-runtime/secret-request";
import type { KeyEvent } from "@opentui/core";
import { usePaste } from "@opentui/react";
import { useEffect, useState } from "react";

import type { T3Session } from "../client/session.ts";
import { pendingSecretRequest } from "../model/queue.ts";

const decoder = new TextDecoder();

/**
 * The open thread's pending secret request and its masked field. The field takes keys itself
 * (the composer never sees the value, so it can't be sent as a message by mistake).
 */
export function useSecretRequest(input: { readonly session: T3Session; readonly projection: OrchestrationV2ThreadProjection | null | undefined }) {
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

  /** Keys for the field while it's focused, and enter / x on the card in navigation. */
  const key = (event: KeyEvent, nav: boolean, questionPending: boolean): boolean => {
    if (!request) return false;
    if (value === null) {
      if (!nav) return false;
      if (event.name === "return") return setValue(""), true;
      if (event.name === "x" && !questionPending) return answer({ type: "decline" }), true;
      return false;
    }
    if (event.ctrl && event.name === "c") return false;
    if (event.name === "escape") setValue(null);
    else if (event.name === "return") answer({ type: "save", secret: value });
    else if (event.name === "backspace") setValue(value.slice(0, -1));
    else if (event.ctrl && event.name === "u") setValue("");
    else if (!event.ctrl && !event.meta && event.sequence.length === 1 && event.sequence >= " ") setValue(value + event.sequence);
    return true;
  };

  const commands = request
    ? [
        { id: "secret-answer", title: `Answer secret request: ${request.label}`, run: () => setValue(""), shortcut: "enter", keywords: ["password", "token", "key", "credential"] },
        { id: "secret-decline", title: `Decline secret request: ${request.label}`, run: () => answer({ type: "decline" }), keywords: ["password", "token", "key", "credential"] },
      ]
    : [];

  return { request, value, error, busy, focused: value !== null, key, commands };
}
