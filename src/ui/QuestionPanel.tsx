import type { ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import { isPendingUserInputOptionSelected, type PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";

import { colors } from "./theme.ts";

/**
 * The web composer's pending-input panel: header with progress, the question,
 * and its options with digit shortcuts. The composer below takes a typed answer.
 */
export function QuestionPanel(props: {
  readonly request: ThreadPendingUserInput;
  readonly index: number;
  readonly draft: PendingUserInputDraftAnswer | undefined;
}) {
  const { request, index, draft } = props;
  const question = request.questions[index];
  if (!question) return null;
  const total = request.questions.length;
  return (
    <box border borderStyle="rounded" borderColor={colors.input} flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row">
        <text fg={colors.input}>
          <strong>{question.header}</strong>
        </text>
        <box flexGrow={1} />
        <text fg={colors.faint}>{total > 1 ? `${index + 1}/${total}` : ""}</text>
      </box>
      <text fg={colors.text}>{question.question}</text>
      {question.options.slice(0, 9).map((option, optionIndex) => {
        const selected = isPendingUserInputOptionSelected(question, draft, option.value ?? option.label);
        const mark = question.multiSelect ? (selected ? "☑" : "☐") : selected ? "●" : "○";
        return (
          <box key={option.label} flexDirection="row">
            <text fg={selected ? colors.input : colors.faint}>{`${optionIndex + 1} ${mark} `}</text>
            <text fg={selected ? colors.text : colors.muted}>{option.label}</text>
            <text fg={colors.faint}>{option.description ? `  ${option.description}` : ""}</text>
          </box>
        );
      })}
    </box>
  );
}
