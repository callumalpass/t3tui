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

import { isWindowsAbsolute } from "./paths.ts";

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
  const expanded = path === "~" ? homedir() : path.startsWith("~/") || path.startsWith("~\\") ? resolve(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(cwd ?? process.cwd(), expanded);
}

/** Image types asked of the clipboard, in order of preference; all of them can be sent. */
export const CLIPBOARD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** A platform tool that reads a clipboard image, for when OpenTUI's clipboard service can't. */
export interface ClipboardImageTool {
  /** Lists the clipboard's types, one per line; absent for a tool that reads one fixed type. */
  readonly types?: readonly string[];
  readonly read: (mimeType: string) => readonly string[];
  /** The type a fixed-type tool reads. */
  readonly mimeType?: string;
  /** Turns what the tool printed into the image's bytes, when it doesn't print them raw. */
  readonly decode?: (stdout: Uint8Array) => Uint8Array | null;
}

/** Prints the clipboard's image as base64 PNG, and nothing when it holds none. Reading the clipboard needs -STA. */
const WINDOWS_CLIPBOARD_IMAGE =
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $image = [Windows.Forms.Clipboard]::GetImage(); if ($image) { $stream = New-Object IO.MemoryStream; $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($stream.ToArray()) }";

/** The clipboard readers, in order: the platform's usual image grabber first. */
export function clipboardImageCommands(platform: string): readonly ClipboardImageTool[] {
  if (platform === "win32") return [{ read: () => ["powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_CLIPBOARD_IMAGE], mimeType: "image/png", decode: (stdout) => Buffer.from(new TextDecoder().decode(stdout).trim(), "base64") }];
  return platform === "darwin"
    ? [
        { read: () => ["pngpaste", "-"], mimeType: "image/png" },
        { read: () => ["osascript", "-e", "the clipboard as «class PNGf»"], mimeType: "image/png", decode: decodeAppleScriptData },
      ]
    : [
        { types: ["wl-paste", "--list-types"], read: (type) => ["wl-paste", "--type", type] },
        { types: ["xclip", "-selection", "clipboard", "-t", "TARGETS", "-o"], read: (type) => ["xclip", "-selection", "clipboard", "-t", type, "-o"] },
      ];
}

/** The image type to ask for among the clipboard's: a preferred one, else any image. */
export function pickClipboardImageType(types: readonly string[]): string | null {
  const offered = types.map((type) => type.trim().toLowerCase());
  return CLIPBOARD_IMAGE_TYPES.find((type) => offered.includes(type)) ?? offered.find((type) => type.startsWith("image/")) ?? null;
}

/** AppleScript prints clipboard data as `«data PNGf89504E47…»`; this is the bytes. */
export function decodeAppleScriptData(stdout: Uint8Array): Uint8Array | null {
  const hex = /«data \w{4}([0-9A-Fa-f]+)»/.exec(new TextDecoder().decode(stdout))?.[1];
  return hex ? Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)) : null;
}

/** The file name for a pasted image of this type. */
export function pastedImageName(mimeType: string): string {
  const extension = Object.entries(IMAGE_MIME_BY_EXTENSION).find(([, type]) => type === mimeType)?.[0] ?? "png";
  return `pasted-image.${extension === "jpeg" ? "jpg" : extension}`;
}

/**
 * The image file a paste names, as terminals paste a dropped file: quoted, as a file://
 * URL, or with its spaces escaped. Null unless it is one path with an image's extension;
 * whether the file exists is the caller's to check.
 */
export function pastedImagePath(text: string, cwd: string | null): string | null {
  const raw = text.trim().replace(/^(['"])(.*)\1$/s, "$2");
  if (!raw || raw.includes("\n")) return null;
  let path: string;
  if (raw.startsWith("file://")) {
    try {
      const url = new URL(raw);
      if (url.hostname && url.hostname !== "localhost") return null;
      // `file:///C:/a.png` is a Windows path, whole, after its first slash.
      path = decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:\/)/, "");
    } catch {
      return null;
    }
  } else {
    // A Windows path's backslashes are its folders, not escapes.
    path = isWindowsAbsolute(raw) ? raw : raw.replace(/\\(.)/g, "$1");
  }
  if (isWindowsAbsolute(path)) return imageMimeTypeForName(path) ? path : null;
  if (!path.startsWith("/") && !path.startsWith("~") && !path.startsWith(".")) return null;
  return imageMimeTypeForName(path) ? expandAttachmentPath(path, cwd) : null;
}

/** Over SSH the clipboard is on the other machine, out of reach of the tools here. */
export function isRemoteTerminal(env: Record<string, string | undefined>): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_TTY);
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
