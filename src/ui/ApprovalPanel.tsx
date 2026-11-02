import type { ThreadPendingApproval } from "@t3tools/client-runtime/state/thread-requests";
import type { ProviderApprovalDecision } from "@t3tools/contracts";

import { Button, Buttons } from "./Button.tsx";
import { BAR, NO_BORDER } from "./edges.ts";
import { colors } from "./theme.ts";

/**
 * A pending approval in the composer's place, as the web swaps it into the
 * composer: the composer's own block and bar, the bar turned to the warning
 * colour, with the same keys the hint bar names.
 */
export function ApprovalPanel(props: { readonly approval: ThreadPendingApproval; readonly onRespond: (decision: ProviderApprovalDecision) => void }) {
  const { approval } = props;
  return (
    <>
      <box border={["left"]} customBorderChars={BAR} borderColor={colors.warn} backgroundColor={colors.element} flexShrink={0} flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <text fg={colors.warn}>
          <strong>{approvalTitle(approval.requestKind)}</strong>
        </text>
        {approval.detail ? <text fg={colors.text}>{approval.detail}</text> : null}
        {approval.appName ? <text fg={colors.muted}>{approval.appName}</text> : null}
        {approval.reason ? <text fg={colors.muted}>{approval.reason}</text> : null}
        <box marginTop={1}>
          <Buttons>
            <Button label="Approve" shortcut="y" color={colors.good} onPress={() => props.onRespond("accept")} />
            <Button label="Always allow this session" shortcut="Y" onPress={() => props.onRespond("acceptForSession")} />
            <Button label="Decline" shortcut="n" color={colors.bad} onPress={() => props.onRespond("decline")} />
          </Buttons>
        </box>
      </box>
      <box height={1} flexShrink={0} border={["left"]} borderColor={colors.warn} customBorderChars={{ ...NO_BORDER, vertical: "╹" }}>
        <box height={1} border={["bottom"]} borderColor={colors.element} customBorderChars={{ ...NO_BORDER, horizontal: "▀" }} />
      </box>
    </>
  );
}

function approvalTitle(kind: string): string {
  if (kind.includes("command")) return "Command approval";
  if (kind.includes("read")) return "File read approval";
  if (kind.includes("file")) return "File change approval";
  if (kind.includes("elicitation") || kind.includes("access")) return "App access approval";
  if (kind.includes("permission")) return "App permission approval";
  return "Approval";
}
