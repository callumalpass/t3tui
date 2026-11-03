import { pathToFiletype, type ImageRenderable, type ScrollBoxRenderable } from "@opentui/core";
import type { ThreadId } from "@t3tools/contracts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { T3Session } from "../client/session.ts";
import { previewKind, sizeLabel } from "../model/files.ts";
import { truncatePath } from "./text.ts";
import { colors, scrollbarOptions, useCodeStyle, useMarkdownStyle } from "./theme.ts";

type Loaded =
  | { readonly kind: "text"; readonly text: string; readonly truncated: boolean; readonly bytes: number }
  | { readonly kind: "image"; readonly bytes: Uint8Array }
  | { readonly kind: "binary"; readonly bytes: number | null }
  | { readonly kind: "error"; readonly message: string };

/** The fewest rows an image takes, and the most. */
const IMAGE_ROWS = 30;

/**
 * A workspace file read-only in a tab of the column: source highlighted by its extension,
 * markdown rendered, images drawn, and other binary files named with their size. Text comes
 * through the server's readFile; images from disk when they're on this machine, else the server.
 */
export function FilePreview(props: { readonly session: T3Session; readonly threadId: ThreadId | undefined; readonly cwd: string; readonly path: string; readonly width: number; readonly focused: boolean; readonly scrollRef: RefObject<ScrollBoxRenderable | null> }) {
  const { session, threadId, cwd, path } = props;
  const codeStyle = useCodeStyle();
  const markdownStyle = useMarkdownStyle();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const kind = previewKind(path);
  useEffect(() => {
    let cancelled = false;
    const done = (next: Loaded) => !cancelled && setLoaded(next);
    const failed = (error: unknown) => done({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    const local = join(cwd, path);
    const here = existsSync(local);
    if (kind === "image") {
      if (here) done({ kind: "image", bytes: readFileSync(local) });
      else if (threadId) session.fetchWorkspaceFile(threadId, local).then((response) => response.arrayBuffer()).then((buffer) => done({ kind: "image", bytes: new Uint8Array(buffer) }), failed);
      else failed(new Error("No thread to fetch the image through."));
    } else {
      session.readFile(cwd, path).then(
        (file) => done({ kind: "text", text: file.contents, truncated: file.truncated, bytes: file.byteLength }),
        (error: unknown) => {
          if ((error as { failure?: string }).failure !== "binary_file") return failed(error);
          if (here) return done({ kind: "binary", bytes: statSync(local).size });
          if (!threadId) return done({ kind: "binary", bytes: null });
          // Only the size, from the headers; the bytes aren't wanted.
          session.fetchWorkspaceFile(threadId, local).then((response) => {
            void response.body?.cancel();
            const length = Number(response.headers.get("content-length"));
            done({ kind: "binary", bytes: Number.isFinite(length) && length > 0 ? length : null });
          }, () => done({ kind: "binary", bytes: null }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [session, threadId, cwd, path, kind]);

  const inner = Math.max(10, props.width - 3);
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} backgroundColor={colors.panel}>
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={props.focused ? colors.text : colors.muted} wrapMode="none">{truncatePath(path, Math.max(8, inner - 10))}</text>
        <box flexGrow={1} />
        <text fg={colors.faint} wrapMode="none" flexShrink={0}>read-only</text>
      </box>
      <scrollbox ref={props.scrollRef} flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} scrollbarOptions={scrollbarOptions()}>
        {!loaded ? (
          <text fg={colors.faint}>Loading…</text>
        ) : loaded.kind === "error" ? (
          <text fg={colors.bad}>{`Could not read the file: ${loaded.message}`}</text>
        ) : loaded.kind === "binary" ? (
          <text fg={colors.muted}>{loaded.bytes === null ? "Binary file" : `Binary file, ${sizeLabel(loaded.bytes)}`}</text>
        ) : loaded.kind === "image" ? (
          <PreviewImage bytes={loaded.bytes} width={inner} />
        ) : (
          <box flexDirection="column" flexShrink={0}>
            {loaded.truncated ? <text fg={colors.warn}>{`Showing the start of a ${sizeLabel(loaded.bytes)} file.`}</text> : null}
            {kind === "markdown" ? (
              <markdown content={loaded.text} syntaxStyle={markdownStyle} conceal tableOptions={{ widthMode: "content", wrapMode: "word", cellPaddingX: 1, borderColor: colors.border }} />
            ) : (
              <code content={loaded.text} {...(pathToFiletype(path) ? { filetype: pathToFiletype(path)! } : {})} syntaxStyle={codeStyle} fg={colors.text} wrapMode="none" />
            )}
          </box>
        )}
      </scrollbox>
    </box>
  );
}

/** An image fitted to the column, in the terminal's best image protocol; a note if it can't be drawn. */
function PreviewImage(props: { readonly bytes: Uint8Array; readonly width: number }) {
  const image = useRef<ImageRenderable | null>(null);
  const [size, setSize] = useState({ width: props.width, height: IMAGE_ROWS });
  const [failed, setFailed] = useState(false);
  if (failed) return <text fg={colors.muted}>{`Image, ${sizeLabel(props.bytes.length)}; it can't be drawn here.`}</text>;
  return (
    <image
      ref={image}
      source={props.bytes}
      fit="fit"
      protocol="auto"
      width={size.width}
      height={size.height}
      onLoad={() => image.current && setSize(image.current.getFittedSize(props.width, IMAGE_ROWS))}
      onError={() => setFailed(true)}
    />
  );
}
