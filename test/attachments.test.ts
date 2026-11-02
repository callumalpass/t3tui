import { describe, expect, test } from "bun:test";
import { AttachmentCreateUploadUrlInput, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { homedir } from "node:os";
import { join } from "node:path";

import { attachmentLine, checkAttachment, clipboardImageCommands, expandAttachmentPath } from "../src/model/attachments.ts";

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
  test("each platform's grabber comes first", () => {
    expect(clipboardImageCommands("darwin")).toEqual([["pngpaste", "-"]]);
    expect(clipboardImageCommands("linux")[0]).toEqual(["wl-paste", "--type", "image/png"]);
    expect(attachmentLine([{ type: "file", id: "a", name: "a.txt", mimeType: "text/plain", sizeBytes: 1 }])).toBe("Attached: a.txt");
  });
});
