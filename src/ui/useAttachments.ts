import type { ChatAttachment } from "@t3tools/contracts";
import { readFile, stat } from "node:fs/promises";
import { useState } from "react";

import type { T3Session } from "../client/session.ts";
import { attachmentLine, checkAttachment, expandAttachmentPath, isRemoteTerminal, pastedImageName } from "../model/attachments.ts";
import type { PaletteCommand } from "../model/palette.ts";
import type { Clipboard } from "./clipboard.ts";
import type { Confirmation } from "./ConfirmBar.tsx";

export interface Attachments {
  /** Uploaded and waiting to ride on this composer's next message. */
  readonly pending: readonly ChatAttachment[];
  /** The one line shown above the composer, or "" when nothing is attached. */
  readonly line: string;
  readonly commands: readonly (PaletteCommand & { readonly run: () => void })[];
  /** Prompts for a path and uploads it; the `a` key and the palette both call this. */
  readonly attachFile: () => void;
  /** Uploads the file at this path, as a pasted or dropped path does. */
  readonly attachPath: (path: string) => void;
  /** Attaches the clipboard's image; with `insert`, its text goes there when there is no image. */
  readonly paste: (insert?: (text: string) => void) => void;
  readonly remove: (attachment: ChatAttachment) => void;
  /** Hands the pending attachments to a send and clears them. */
  readonly take: () => readonly ChatAttachment[];
  /** A send failed: its attachments go back to their composer, unless it has new ones. */
  readonly restore: (composerKey: string, attachments: readonly ChatAttachment[]) => void;
}

/**
 * Pending attachments per composer (a thread, or the new-thread draft), uploaded
 * as they're picked the way the web composer uploads them, ready to send.
 */
export function useAttachments(deps: {
  readonly session: T3Session;
  readonly clipboard: Clipboard;
  /** The composer they belong to; switching threads keeps each one's list. */
  readonly composerKey: string;
  /** Relative paths resolve here: the thread's worktree or project folder. */
  readonly cwd: string | null;
  /** The server's advertised file cap; null refuses files, undefined while it loads. */
  readonly maxFileBytes: number | null | undefined;
  readonly confirm: (confirmation: Confirmation) => void;
  readonly say: (text: string, bad?: boolean) => void;
}): Attachments {
  const { session, clipboard, composerKey, cwd, maxFileBytes, confirm, say } = deps;
  const [byComposer, setByComposer] = useState<ReadonlyMap<string, readonly ChatAttachment[]>>(new Map());
  const pending = byComposer.get(composerKey) ?? [];

  // Lists are replaced whole, per composer, so switching threads never mixes them.
  const setPending = (attachments: readonly ChatAttachment[]) => {
    setByComposer((previous) => new Map(previous).set(composerKey, attachments));
  };

  const add = (attachment: ChatAttachment) => {
    setByComposer((previous) => {
      const current = previous.get(composerKey) ?? [];
      return new Map(previous).set(composerKey, [...current, attachment]);
    });
  };

  const upload = (name: string, bytes: Uint8Array, mimeType?: string) => {
    if (maxFileBytes === undefined) return say("Still loading the server's attachment limits.", true);
    const checked = checkAttachment({
      name,
      sizeBytes: bytes.length,
      ...(mimeType ? { mimeType } : {}),
      pending: byComposer.get(composerKey) ?? [],
      maxFileBytes,
    });
    if (!checked.ok) return say(checked.error, true);
    say(`Uploading ${checked.upload.name}…`);
    session.uploadAttachment(checked.upload, bytes).then(
      (attachment) => {
        add(attachment);
        say(`Attached ${attachment.name}`);
      },
      (error) => say(`Could not attach ${checked.upload.name}: ${messageOf(error)}`, true),
    );
  };

  const attachPath = (path: string) => {
    void (async () => {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("not a file");
      return readFile(path);
    })().then(
      (bytes) => upload(path, bytes, Bun.file(path).type || undefined),
      () => say(`Could not read ${path}.`, true),
    );
  };

  const attachFile = () =>
    confirm({
      title: "Attach file",
      ...(cwd ? { detail: `Relative to ${cwd}` } : {}),
      message: { placeholder: "~/screenshot.png or ./report.pdf" },
      confirmLabel: "attach",
      run: (text) => {
        if (text.trim()) attachPath(expandAttachmentPath(text, cwd));
      },
    });

  const paste = (insert?: (text: string) => void) => {
    if (isRemoteTerminal(process.env)) return say("Over SSH the clipboard is on the other machine; attach the file with a.", true);
    void clipboard.readImage().then(async (image) => {
      if (typeof image !== "string") return upload(pastedImageName(image.mimeType), image.bytes, image.mimeType);
      const text = insert ? await clipboard.readText() : null;
      if (text) return insert?.(text);
      say(image === "no-tool" ? "No clipboard image tool found (wl-paste, xclip, pngpaste or osascript)." : "No image on the clipboard.", true);
    });
  };

  const remove = (attachment: ChatAttachment) => {
    setByComposer((previous) => {
      const current = previous.get(composerKey) ?? [];
      const kept = current.filter((candidate) => candidate.id !== attachment.id);
      return new Map(previous).set(composerKey, kept);
    });
    session.deleteAttachment(attachment.id).then(
      () => say(`Removed ${attachment.name}`),
      (error) => say(`Removed ${attachment.name}; deleting the upload failed: ${messageOf(error)}`, true),
    );
  };

  const commands: Attachments["commands"][number][] = [
    { id: "attach-file", title: "Attach file…", shortcut: "a", keywords: ["attachment", "image", "upload", "file"], run: attachFile },
    { id: "attach-paste-image", title: "Paste image from clipboard", keywords: ["attachment", "image", "screenshot", "clipboard"], run: () => paste() },
    ...pending.map((attachment) => ({
      id: `attach-remove:${attachment.id}`,
      title: `Remove attachment: ${attachment.name}`,
      keywords: ["attachment", "delete", "detach"],
      run: () => remove(attachment),
    })),
  ];

  return {
    pending,
    line: attachmentLine(pending),
    commands,
    attachFile,
    attachPath,
    paste,
    remove,
    take: () => {
      const taken = byComposer.get(composerKey) ?? [];
      if (taken.length > 0) setPending([]);
      return taken;
    },
    restore: (key, attachments) => {
      if (attachments.length === 0) return;
      setByComposer((previous) => ((previous.get(key) ?? []).length > 0 ? previous : new Map(previous).set(key, attachments)));
    },
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
