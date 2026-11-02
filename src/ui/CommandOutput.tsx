import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { CommandOutputView } from "@t3tools/client-runtime/state/command-output";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { terminalOutputPlainText } from "@t3tools/shared/terminalOutput";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { T3Session } from "../client/session.ts";
import { colors } from "./theme.ts";

/** Only expanded command rows in the viewport subscribe; the server bounds the output tail. The row's element block gives the padding. */
export function CommandOutput(props: { readonly session: T3Session; readonly threadId: ThreadId; readonly itemId: TurnItemId; readonly scrollRef: RefObject<ScrollBoxRenderable | null> }) {
  const box = useRef<BoxRenderable | null>(null);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<CommandOutputView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const inspect = () => {
      const row = box.current;
      const viewport = props.scrollRef.current?.viewport;
      setVisible(Boolean(row && viewport && row.y + row.height > viewport.y && row.y < viewport.y + viewport.height));
    };
    inspect();
    const timer = setInterval(inspect, 250);
    return () => clearInterval(timer);
  }, [props.scrollRef]);
  useEffect(() => {
    if (!visible) return;
    setError(null);
    return props.session.watchCommandOutput(props.threadId, props.itemId, setView, setError);
  }, [props.session, props.threadId, props.itemId, visible]);
  const lines = view ? terminalOutputPlainText(view.output.text).trimEnd().split("\n") : [];
  return <box ref={box} flexDirection="column">
    {error ? <text fg={colors.bad}>{`Could not load output: ${error}`}</text> : null}
    {view?.output.truncated || lines.length > 12 ? <text fg={colors.faint}>Earlier output not shown</text> : null}
    <text fg={colors.muted}>{lines.slice(-12).join("\n") || (view ? view.running ? "Waiting for output…" : "No output." : "Loading output…")}</text>
  </box>;
}
