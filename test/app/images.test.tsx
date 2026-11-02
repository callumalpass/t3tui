import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withCompletedTurn } from "./fixtures.ts";
import { fakeSession, renderApp } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

/** A 1×1 PNG. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const uploaded = { type: "image", id: "att-1", name: "pasted-image.jpg", mimeType: "image/jpeg", sizeBytes: PNG.length };
const withUploads = () => fakeSession({ serverConfig: { providers: [], settings: {}, environment: { capabilities: { fileAttachments: { maxUploadBytes: 1 << 20 } } } }, results: { uploadAttachment: uploaded } });

describe("pasting images", () => {
  test("ctrl+v in the composer attaches the clipboard's image, whatever its type", async () => {
    const app = await open({ session: withUploads(), clipboard: { image: { bytes: PNG, mimeType: "image/jpeg" } } });
    await app.press("i");
    await app.press("v", { ctrl: true });
    const [call] = app.calls("uploadAttachment");
    expect(call?.args[0]).toMatchObject({ name: "pasted-image.jpg", mimeType: "image/jpeg" });
    expect(app.frame()).toContain("pasted-image.jpg ✕");
  });

  test("an empty bracketed paste is a copied image the terminal couldn't send", async () => {
    const app = await open({ session: withUploads(), clipboard: { image: { bytes: PNG, mimeType: "image/png" } } });
    await app.press("i");
    await app.paste("");
    expect(app.calls("uploadAttachment")[0]?.args[0]).toMatchObject({ name: "pasted-image.png", mimeType: "image/png" });
  });

  test("with no image, ctrl+v pastes the clipboard's text", async () => {
    const app = await open({ clipboard: { text: "copied words" } });
    await app.press("i");
    await app.press("v", { ctrl: true });
    expect(app.calls("uploadAttachment")).toHaveLength(0);
    expect(app.frame()).toContain("copied words");
  });

  test("an empty clipboard says so", async () => {
    const app = await open();
    await app.press("i");
    await app.press("v", { ctrl: true });
    expect(app.hints()).toBe("No image on the clipboard.");
  });

  test("over SSH the clipboard is out of reach, so it points at a", async () => {
    const previous = process.env.SSH_CONNECTION;
    process.env.SSH_CONNECTION = "10.0.0.2 50000 10.0.0.1 22";
    try {
      const app = await open({ clipboard: { image: { bytes: PNG, mimeType: "image/png" } } });
      await app.press("i");
      await app.press("v", { ctrl: true });
      expect(app.hints()).toBe("Over SSH the clipboard is on the other machine; attach the file with a.");
      expect(app.calls("uploadAttachment")).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.SSH_CONNECTION;
      else process.env.SSH_CONNECTION = previous;
    }
  });
});

describe("pasting paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3tui-images-"));
  const shot = join(dir, "my shot.png");
  writeFileSync(shot, PNG);

  test("a dropped image file is attached rather than typed", async () => {
    const app = await open({ session: withUploads() });
    await app.press("i");
    await app.paste(`'${shot}'`);
    await app.settle(50);
    expect(app.calls("uploadAttachment")[0]?.args[0]).toMatchObject({ name: "my shot.png", mimeType: "image/png" });
    expect(app.frame()).not.toContain("t3tui-images-");
  });

  test("escaped spaces and file:// URLs work too", async () => {
    const app = await open({ session: withUploads() });
    await app.press("i");
    await app.paste(shot.replaceAll(" ", "\\ "));
    await app.paste(`file://${shot.replaceAll(" ", "%20")}`);
    await app.settle(50);
    expect(app.calls("uploadAttachment")).toHaveLength(2);
  });

  test("a path to nothing, or to something that isn't an image, is text", async () => {
    const app = await open({ session: withUploads() });
    await app.press("i");
    await app.paste(join(dir, "missing.png"));
    expect(app.calls("uploadAttachment")).toHaveLength(0);
    expect(app.frame()).toContain("missing.png");
  });
});

describe("sent images", () => {
  const shot = { type: "image", id: "att-shot", name: "shot.png", mimeType: "image/png", sizeBytes: PNG.length };
  const withShot = () => {
    const turn = withCompletedTurn() as unknown as { messages: { role: string; attachments: unknown[] }[]; turnItems: { type: string; attachments?: unknown[] }[] };
    for (const message of turn.messages) if (message.role === "user") message.attachments = [shot];
    for (const item of turn.turnItems) if (item.type === "user_message") item.attachments = [shot];
    return turn as unknown as ReturnType<typeof withCompletedTurn>;
  };
  const rowsBetween = (frame: string, from: string, to: string) => {
    const lines = frame.split("\n");
    return lines.findIndex((line) => line.includes(to)) - lines.findIndex((line) => line.includes(from));
  };

  test("a user message's image shows inline, its name under it", async () => {
    const app = await open({ session: fakeSession({ projection: withShot(), results: { attachmentImage: PNG } }) });
    await app.settle(100);
    expect(app.calls("attachmentImage")[0]?.args[0]).toMatchObject({ id: "att-shot" });
    expect(app.frame()).toContain("▣ shot.png");
    const rows = rowsBetween(app.frame(), "Do the thing", "▣ shot.png");
    expect(rows).toBeGreaterThan(4);
    expect(rows).toBeLessThanOrEqual(14);
  });

  test("an image that can't load is just its name", async () => {
    const app = await open({ session: fakeSession({ projection: withShot(), failures: { attachmentImage: "gone" } }) });
    await app.settle(100);
    expect(rowsBetween(app.frame(), "Do the thing", "▣ shot.png")).toBe(2);
  });
});
