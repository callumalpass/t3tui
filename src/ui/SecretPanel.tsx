import { SECRET_REQUEST_DEFAULT_PLACEHOLDER, secretRequestPrivacyNote, type SecretRequestItem } from "@t3tools/client-runtime/secret-request";

import { Button, Buttons } from "./Button.tsx";
import { colors } from "./theme.ts";

/**
 * The web's secret request card: the agent asks for a value it never sees. Typing is masked;
 * `value` is null until the field is focused (enter).
 */
export function SecretPanel(props: { readonly request: SecretRequestItem; readonly value: string | null; readonly error: string | null; readonly busy: boolean; readonly actions: { readonly focus: () => void; readonly cancel: () => void; readonly save: () => void; readonly decline: () => void } }) {
  const { actions } = props;
  const { request, value } = props;
  const focused = value !== null;
  return (
    <box border borderStyle="rounded" borderColor={focused ? colors.borderFocused : colors.warn} flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} paddingLeft={1} paddingRight={1}>
      <text fg={colors.warn}>
        <strong>{`🔒 ${request.label}`}</strong>
      </text>
      {request.reason.trim() ? <text fg={colors.muted}>{request.reason}</text> : null}
      {focused ? <text fg={value ? colors.text : colors.faint} selectable={false}>{value ? "•".repeat(Math.min(value.length, 64)) : (request.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER)}</text> : null}
      {props.error ? <text fg={colors.bad}>{props.error}</text> : null}
      <text fg={colors.faint}>{props.busy ? "Saving…" : secretRequestPrivacyNote(request)}</text>
      <Buttons>
        {focused ? <Button label="Save securely" shortcut="enter" color={colors.warn} onPress={actions.save} /> : <Button label="Answer" shortcut="enter" color={colors.warn} onPress={actions.focus} />}
        {focused ? <Button label="Cancel" shortcut="esc" onPress={actions.cancel} /> : <Button label="Decline" shortcut="x" onPress={actions.decline} />}
      </Buttons>
    </box>
  );
}
