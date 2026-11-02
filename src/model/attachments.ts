import {
  getProviderAttachmentLimitError,
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type AttachmentCreateUploadUrlInput,
  type ChatAttachment,
} from "@t3tools/contracts";
import { clampFileAttachmentUploadBytes, fileAttachmentTooLargeMessage } from "@t3tools/client-runtime/state/attachments";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** The MIME type from the extension alone, for sources that report a generic one. */
export function imageMimeTypeForName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (IMAGE_MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

/** Expands `~` and resolves a relative path against `cwd`, as the attach prompt promises. */
export function expandAttachmentPath(input: string, cwd: string | null): string {
  const path = input.trim();
  const expanded = path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(cwd ?? process.cwd(), expanded);
}

/** The clipboard readers, in order: the platform's usual image grabber first. */
export function clipboardImageCommands(platform: string): readonly (readonly string[])[] {
  return platform === "darwin"
    ? [["pngpaste", "-"]]
    : [
        ["wl-paste", "--type", "image/png"],
        ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
      ];
}

export type AttachmentCheck =
  | { readonly ok: true; readonly upload: AttachmentCreateUploadUrlInput; readonly mimeType: string }
  | { readonly ok: false; readonly error: string };

/**
 * Checks one local file the way the web composer does: supported images go as images
 * (GIF, JPEG, PNG, WebP, up to the image cap), everything else as a file up to the
 * server's advertised limit, clamped to what a turn may reference.
 */
export function checkAttachment(input: {
  readonly name: string;
  readonly sizeBytes: number;
  /** The OS-reported type, when it isn't empty or generic. */
  readonly mimeType?: string;
  readonly pending: readonly ChatAttachment[];
  /** Null: the server advertises no file attachments. */
  readonly maxFileBytes: number | null;
}): AttachmentCheck {
  const name = basename(input.name) || "file";
  if (input.pending.length >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    return { ok: false, error: `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.` };
  }
  if (input.sizeBytes <= 0) return { ok: false, error: `'${name}' is empty or could not be read.` };
  const reported = input.mimeType?.toLowerCase();
  const imageMime = imageMimeTypeForName(name) ?? (reported && isProviderSendTurnSupportedImageMimeType(reported) ? reported : null);
  if (imageMime) {
    if (input.sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) return { ok: false, error: fileAttachmentTooLargeMessage(name, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) };
    const candidate: Pick<ChatAttachment, "type" | "mimeType" | "sizeBytes"> = { type: "image", mimeType: imageMime, sizeBytes: input.sizeBytes };
    const limit = getProviderAttachmentLimitError([...input.pending, candidate]);
    if (limit) return { ok: false, error: limit };
    const supported = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find((candidate) => candidate === imageMime)!;
    return { ok: true, upload: { type: "image", name, mimeType: supported, sizeBytes: input.sizeBytes }, mimeType: imageMime };
  }
  if (input.maxFileBytes === null) return { ok: false, error: "This server does not support file attachments." };
  const limit = clampFileAttachmentUploadBytes(input.maxFileBytes);
  if (input.sizeBytes > limit) return { ok: false, error: fileAttachmentTooLargeMessage(name, limit) };
  const mimeType = reported && reported !== "" ? reported : "application/octet-stream";
  return { ok: true, upload: { type: "file", name, mimeType, sizeBytes: input.sizeBytes }, mimeType };
}

/** The pending attachments as the one line shown above the composer. */
export function attachmentLine(pending: readonly ChatAttachment[]): string {
  return pending.length > 0 ? `Attached: ${pending.map((attachment) => attachment.name).join(", ")}` : "";
}
