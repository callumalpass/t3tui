import { describe, expect, test } from "bun:test";
import { AttachmentCreateUploadUrlInput, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  attachmentLine,
  checkAttachment,
  clipboardImageCommands,
  decodeAppleScriptData,
  expandAttachmentPath,
  isRemoteTerminal,
  pastedImageName,
  pastedImagePath,
  pickClipboardImageType,
} from "../src/model/attachments.ts";

const isUpload = Schema.is(AttachmentCreateUploadUrlInput);

describe("expandAttachmentPath", () => {
  test("expands ~ and resolves relative paths against the thread's folder", () => {
    expect(expandAttachmentPath("~/shot.png", "/repo/app")).toBe(join(homedir(), "shot.png"));
    expect(expandAttachmentPath("docs/report.pdf", "/repo/app")).toBe("/repo/app/docs/report.pdf");
    expect(expandAttachmentPath("/tmp/a.png", "/repo/app")).toBe("/tmp/a.png");
  });
});

describe("checkAttachment", () => {
  test("a supported image uploads as an image, whatever the OS reported", () => {
    const result = checkAttachment({ name: "/tmp/Screen.PNG", sizeBytes: 2048, mimeType: "application/octet-stream", pending: [], maxFileBytes: null });
    expect(result.ok && result.upload).toEqual({ type: "image", name: "Screen.PNG", mimeType: "image/png", sizeBytes: 2048 });
    expect(result.ok && isUpload(result.upload)).toBe(true);
  });

  test("an image over the cap is refused, as an empty file is", () => {
    const big = checkAttachment({ name: "big.jpg", sizeBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1, pending: [], maxFileBytes: 100 });
    expect(big.ok).toBe(false);
    expect(!big.ok && big.error).toContain("exceeds the 10 MB attachment limit");
    const empty = checkAttachment({ name: "a.txt", sizeBytes: 0, pending: [], maxFileBytes: 100 });
    expect(empty).toEqual({ ok: false, error: "'a.txt' is empty or could not be read." });
  });

  test("files need the server's file support and fit its advertised limit", () => {
    expect(checkAttachment({ name: "a.zip", sizeBytes: 10, pending: [], maxFileBytes: null })).toEqual({ ok: false, error: "This server does not support file attachments." });
    const over = checkAttachment({ name: "a.zip", sizeBytes: 2048, pending: [], maxFileBytes: 1024 });
    expect(over.ok).toBe(false);
    const ok = checkAttachment({ name: "a.zip", sizeBytes: 512, mimeType: "application/zip", pending: [], maxFileBytes: 1024 });
    expect(ok.ok && ok.upload).toEqual({ type: "file", name: "a.zip", mimeType: "application/zip", sizeBytes: 512 });
    expect(ok.ok && isUpload(ok.upload)).toBe(true);
  });

  test("pending images count against the per-message total", () => {
    const tenMb = PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;
    const pending = Array.from({ length: 8 }, (_, index) => ({ type: "image" as const, id: `a${index}`, name: `a${index}.png`, mimeType: "image/png", sizeBytes: tenMb }));
    const result = checkAttachment({ name: "one-more.png", sizeBytes: 1, pending, maxFileBytes: null });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("80 MiB");
  });
});

describe("clipboard", () => {
  test("each platform's grabber comes first, reading whichever image type is there", () => {
    const [pngpaste, osascript] = clipboardImageCommands("darwin");
    expect(pngpaste?.read("image/png")).toEqual(["pngpaste", "-"]);
    expect(osascript?.read("image/png")).toEqual(["osascript", "-e", "the clipboard as «class PNGf»"]);
    const [wayland] = clipboardImageCommands("linux");
    expect(wayland?.types).toEqual(["wl-paste", "--list-types"]);
    expect(wayland?.read("image/jpeg")).toEqual(["wl-paste", "--type", "image/jpeg"]);
    expect(attachmentLine([{ type: "file", id: "a", name: "a.txt", mimeType: "text/plain", sizeBytes: 1 }])).toBe("Attached: a.txt");
  });
});

describe("clipboard images", () => {
  test("a PNG is preferred, but any image type will do", () => {
    expect(pickClipboardImageType(["text/plain", "image/jpeg", "image/png"])).toBe("image/png");
    expect(pickClipboardImageType(["TARGETS", "image/webp\r"])).toBe("image/webp");
    expect(pickClipboardImageType(["image/bmp"])).toBe("image/bmp");
    expect(pickClipboardImageType(["text/plain", "UTF8_STRING"])).toBeNull();
  });

  test("osascript's «data PNGf…» output decodes to the bytes", () => {
    const out = new TextEncoder().encode("«data PNGf89504E470D0A1A0A»\n");
    expect([...(decodeAppleScriptData(out) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(decodeAppleScriptData(new TextEncoder().encode("execution error"))).toBeNull();
  });

  test("a pasted image is named for its type", () => {
    expect(pastedImageName("image/png")).toBe("pasted-image.png");
    expect(pastedImageName("image/jpeg")).toBe("pasted-image.jpg");
    expect(pastedImageName("image/webp")).toBe("pasted-image.webp");
  });

  test("SSH means the clipboard is out of reach", () => {
    expect(isRemoteTerminal({ SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" })).toBe(true);
    expect(isRemoteTerminal({ SSH_TTY: "/dev/pts/3" })).toBe(true);
    expect(isRemoteTerminal({})).toBe(false);
  });
});

describe("pasted paths", () => {
  test("a dropped image path is read whether quoted, a file:// URL, or with escaped spaces", () => {
    expect(pastedImagePath("/tmp/shot.png", null)).toBe("/tmp/shot.png");
    expect(pastedImagePath("'/tmp/my shot.png' ", null)).toBe("/tmp/my shot.png");
    expect(pastedImagePath('"/tmp/my shot.PNG"', null)).toBe("/tmp/my shot.PNG");
    expect(pastedImagePath("/tmp/my\\ shot.jpg", null)).toBe("/tmp/my shot.jpg");
    expect(pastedImagePath("file:///tmp/my%20shot.webp", null)).toBe("/tmp/my shot.webp");
    expect(pastedImagePath("file://localhost/tmp/a.gif", null)).toBe("/tmp/a.gif");
    expect(pastedImagePath("./shots/a.png", "/work")).toBe("/work/shots/a.png");
  });

  test("anything else is text", () => {
    expect(pastedImagePath("/tmp/notes.txt", null)).toBeNull();
    expect(pastedImagePath("look at shot.png please", null)).toBeNull();
    expect(pastedImagePath("/tmp/a.png\n/tmp/b.png", null)).toBeNull();
    expect(pastedImagePath("file://elsewhere/tmp/a.png", null)).toBeNull();
    expect(pastedImagePath("", null)).toBeNull();
  });
});

test("a dropped Windows file keeps its backslashes", () => {
  expect(pastedImagePath('"C:\\Users\\me\\shot.png"', null)).toBe("C:\\Users\\me\\shot.png");
  expect(pastedImagePath("file:///C:/Users/me/my%20shot.png", null)).toBe("C:/Users/me/my shot.png");
  expect(pastedImagePath("C:\\Users\\me\\notes.txt", null)).toBeNull();
});

test("on Windows, the clipboard's image comes through PowerShell as base64", () => {
  const [tool] = clipboardImageCommands("win32");
  expect(tool?.read("image/png")[0]).toBe("powershell.exe");
  expect(tool?.decode?.(new TextEncoder().encode("iVBORw==\r\n"))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});
