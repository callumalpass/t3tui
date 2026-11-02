import type { ChatAttachment } from "@t3tools/contracts";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { useState } from "react";

import type { T3Session } from "../client/session.ts";
import { attachmentLine, checkAttachment, clipboardImageCommands, expandAttachmentPath } from "../model/attachments.ts";
import type { PaletteCommand } from "../model/palette.ts";
import type { Confirmation } from "./ConfirmBar.tsx";

export interface Attachments {
  /** Uploaded and waiting to ride on this composer's next message. */
  readonly pending: readonly ChatAttachment[];
  /** The one line shown above the composer, or "" when nothing is attached. */
  readonly line: string;
  readonly commands: readonly (PaletteCommand & { readonly run: () => void })[];
  /** Prompts for a path and uploads it; the `a` key and the palette both call this. */
  readonly attachFile: () => void;
  readonly remove: (attachment: ChatAttachment) => void;
  /** Hands the pending attachments to a send and clears them. */
  readonly take: () => readonly ChatAttachment[];
}

/**
 * Pending attachments per composer (a thread, or the new-thread draft), uploaded
 * as they're picked the way the web composer uploads them, ready to send.
 */
export function useAttachments(deps: {
  readonly session: T3Session;
  /** The composer they belong to; switching threads keeps each one's list. */
  readonly composerKey: string;
  /** Relative paths resolve here: the thread's worktree or project folder. */
  readonly cwd: string | null;
  /** The server's advertised file cap; null refuses files, undefined while it loads. */
  readonly maxFileBytes: number | null | undefined;
  readonly confirm: (confirmation: Confirmation) => void;
  readonly say: (text: string, bad?: boolean) => void;
}): Attachments {
  const { session, composerKey, cwd, maxFileBytes, confirm, say } = deps;
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

  const attachFile = () =>
    confirm({
      title: "Attach file",
      ...(cwd ? { detail: `Relative to ${cwd}` } : {}),
      message: { placeholder: "~/screenshot.png or ./report.pdf" },
      confirmLabel: "attach",
      run: (text) => {
        const path = text.trim();
        if (!path) return;
        const resolved = expandAttachmentPath(path, cwd);
        void (async () => {
          const info = await stat(resolved);
          if (!info.isFile()) throw new Error("not a file");
          return readFile(resolved);
        })().then(
          (bytes) => upload(resolved, bytes, Bun.file(resolved).type || undefined),
          () => say(`Could not read ${resolved}.`, true),
        );
      },
    });

  const pasteImage = () => {
    let missing = true;
    for (const [command, ...args] of clipboardImageCommands(process.platform)) {
      const result = spawnSync(command!, args, { maxBuffer: 64 * 1024 * 1024 });
      if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
      missing = false;
      if (result.status === 0 && result.stdout.length > 0) return upload("pasted-image.png", result.stdout, "image/png");
      break;
    }
    say(missing ? "No clipboard image tool found (wl-paste, xclip, or pngpaste)." : "No image on the clipboard.", true);
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
    { id: "attach-paste-image", title: "Paste image from clipboard", keywords: ["attachment", "image", "screenshot", "clipboard"], run: pasteImage },
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
    remove,
    take: () => {
      const taken = byComposer.get(composerKey) ?? [];
      if (taken.length > 0) setPending([]);
      return taken;
    },
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
