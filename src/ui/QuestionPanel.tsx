import type { ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import { isPendingUserInputOptionSelected, type PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";

import type { MouseEvent } from "@opentui/core";

import { Button, Buttons, isLeftClick, useHover } from "./Button.tsx";
import { BAR } from "./edges.ts";
import { colors } from "./theme.ts";

/**
 * The web composer's pending-input panel: header with progress, the question,
 * and its options with digit shortcuts. The composer below takes a typed answer.
 */
export function QuestionPanel(props: {
  readonly request: ThreadPendingUserInput;
  readonly index: number;
  readonly draft: PendingUserInputDraftAnswer | undefined;
  readonly onPick: (optionIndex: number) => void;
  /** Multi-select questions move on with a click here, as enter does. */
  readonly onNext: () => void;
  readonly onDismiss?: (() => void) | undefined;
}) {
  const { request, index, draft } = props;
  const question = request.questions[index];
  if (!question) return null;
  const total = request.questions.length;
  return (
    <box border={["left"]} customBorderChars={BAR} borderColor={colors.accent} backgroundColor={colors.panel} flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} paddingLeft={2} paddingRight={1}>
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
        return <Option key={option.label} label={option.label} description={option.description} prefix={`${optionIndex + 1} ${mark} `} selected={selected} onPick={() => props.onPick(optionIndex)} />;
      })}
      {question.multiSelect || props.onDismiss ? (
        <Buttons>
          {question.multiSelect ? <Button label={index + 1 < total ? "Next" : "Submit"} shortcut="enter" color={colors.input} onPress={props.onNext} /> : null}
          {props.onDismiss ? <Button label="Dismiss" shortcut="x" onPress={props.onDismiss} /> : null}
        </Buttons>
      ) : null}
    </box>
  );
}

function Option(props: { readonly label: string; readonly description?: string | undefined; readonly prefix: string; readonly selected: boolean; readonly onPick: () => void }) {
  const [hover, hoverProps] = useHover();
  return (
    <box flexDirection="row" backgroundColor={props.selected ? colors.selectedBg : hover ? colors.hoverBg : "transparent"} {...hoverProps} onMouseDown={(event: MouseEvent) => isLeftClick(event) && props.onPick()}>
      <text fg={props.selected ? colors.input : colors.faint} selectable={false}>{props.prefix}</text>
      <text fg={props.selected ? colors.text : colors.muted} selectable={false}>{props.label}</text>
      <text fg={colors.faint} selectable={false}>{props.description ? `  ${props.description}` : ""}</text>
    </box>
  );
}
