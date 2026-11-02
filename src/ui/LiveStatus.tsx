import { useEffect, useState } from "react";

import { SPINNER } from "./ThreadList.tsx";
import { colors } from "./theme.ts";

/** The one live status line pinned above the composer while a run is active. */
export function LiveStatus(props: { readonly label: string; readonly tool?: string | null }) {
  const [spin, setSpin] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSpin((frame) => frame + 1), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <box flexDirection="row" flexShrink={0} marginLeft={1} marginRight={1} paddingLeft={2}>
      <text fg={colors.info} selectable={false}>{SPINNER[spin % SPINNER.length]!}</text>
      <text fg={colors.muted} selectable={false}>{` ${props.label}`}</text>
      {props.tool ? <text fg={colors.faint} selectable={false} wrapMode="none">{` · ${props.tool}`}</text> : null}
    </box>
  );
}
