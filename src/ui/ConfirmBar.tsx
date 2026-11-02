import { Button, Buttons } from "./Button.tsx";
import { colors } from "./theme.ts";

/** An action that waits for you to say yes: git actions, stopping a server, running an automation. */
export interface Confirmation {
  readonly title: string;
  readonly detail?: string;
  /** Commit actions take an optional message, typed here; blank lets the server write one. */
  readonly message?: { readonly placeholder: string };
  readonly confirmLabel: string;
  readonly run: (message: string) => void;
}

/** Shown above the composer while a confirmation is open. */
export function ConfirmBar(props: { readonly confirmation: Confirmation; readonly message: string; readonly onMessage: (value: string) => void; readonly onSubmit: () => void; readonly onCancel: () => void }) {
  const { confirmation } = props;
  return (
    <box border borderStyle="rounded" borderColor={colors.warn} flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} paddingLeft={1} paddingRight={1}>
      <text fg={colors.warn}>
        <strong>{confirmation.title}</strong>
      </text>
      {confirmation.detail ? <text fg={colors.muted}>{confirmation.detail}</text> : null}
      {confirmation.message ? (
        <box flexDirection="row" height={1}>
          <text fg={colors.faint}>{"Message: "}</text>
          <input focused flexGrow={1} placeholder={confirmation.message.placeholder} value={props.message} onInput={props.onMessage} onSubmit={props.onSubmit} />
        </box>
      ) : null}
      <Buttons>
        <Button label={confirmation.confirmLabel} shortcut="enter" color={colors.warn} onPress={props.onSubmit} />
        <Button label="cancel" shortcut="esc" onPress={props.onCancel} />
      </Buttons>
    </box>
  );
}
