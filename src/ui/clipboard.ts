import { createClipboard, createHostClipboard, createRendererClipboardAdapter, type CliRenderer } from "@opentui/core";
import { spawnSync } from "node:child_process";

import { CLIPBOARD_IMAGE_TYPES, clipboardImageCommands, pickClipboardImageType } from "../model/attachments.ts";

export type ClipboardImage = { readonly bytes: Uint8Array; readonly mimeType: string } | "empty" | "no-tool";

/** The clipboard as the app uses it: images and text in, copied text out. */
export interface Clipboard {
  readonly readImage: () => Promise<ClipboardImage>;
  readonly readText: () => Promise<string | null>;
  /** OSC 52 first, which works over SSH, then the desktop's clipboard; false if neither took it. */
  readonly copy: (text: string) => Promise<boolean>;
}

/** OpenTUI's clipboard service, with the platform tools behind it for images it can't read. */
export function rendererClipboard(renderer: CliRenderer): Clipboard {
  const service = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) });
  return {
    readImage: async () => {
      const result = await service.read({ preferredTypes: CLIPBOARD_IMAGE_TYPES }).catch(() => null);
      if (result?.status === "read") return { bytes: result.representation.bytes, mimeType: result.representation.mimeType };
      if (result?.status === "empty") return "empty";
      return imageFromTools(process.platform);
    },
    readText: async () => {
      const result = await service.read({ preferredTypes: ["text/plain;charset=utf-8", "text/plain"] }).catch(() => null);
      return result?.status === "read" ? new TextDecoder().decode(result.representation.bytes) : null;
    },
    copy: async (text) => {
      const result = await service.writeText(text, { destination: "all-available" }).catch(() => null);
      return result !== null && (result.terminal.status === "attempted" || result.host.status === "written");
    },
  };
}

/** wl-paste, xclip, pngpaste or osascript: the first one installed answers. */
function imageFromTools(platform: string): ClipboardImage {
  for (const tool of clipboardImageCommands(platform)) {
    const run = (argv: readonly string[]) => spawnSync(argv[0]!, argv.slice(1), { maxBuffer: 64 * 1024 * 1024 });
    let mimeType = tool.mimeType ?? null;
    if (tool.types) {
      const listed = run(tool.types);
      if ((listed.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
      mimeType = listed.status === 0 ? pickClipboardImageType(listed.stdout.toString().split("\n")) : null;
      if (!mimeType) return "empty";
    }
    const result = run(tool.read(mimeType!));
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
    const bytes = result.status === 0 && result.stdout.length > 0 ? (tool.decode ? tool.decode(result.stdout) : result.stdout) : null;
    return bytes && bytes.length > 0 ? { bytes, mimeType: mimeType! } : "empty";
  }
  return "no-tool";
}
