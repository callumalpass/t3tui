import { afterEach, describe, expect, test } from "bun:test";

import { fakeSession, renderApp, v2ThreadId } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const uploads = (...names: string[]) => {
  let count = 0;
  const session = fakeSession({ serverConfig: { providers: [], settings: {}, environment: { capabilities: { fileAttachments: { maxUploadBytes: 1 << 20 } } } } });
  // Each upload is a new attachment, as the server makes them.
  const uploadAttachment = async (upload: { name: string; mimeType: string; sizeBytes: number }) => {
    session.calls.push({ method: "uploadAttachment", args: [upload] });
    const name = names[count] ?? upload.name;
    return { type: "image", id: `att-${++count}`, name, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes };
  };
  return { ...session, session: new Proxy(session.session, { get: (target, key) => (key === "uploadAttachment" ? uploadAttachment : Reflect.get(target, key)) }) };
};
/** The composer's text line: the row under the attachments line. */
const composerLine = (frame: string) => frame.split("\n").find((line) => line.includes("┃  ") && /\[image|@src|look|draft/.test(line)) ?? "";
const spanAt = (app: Awaited<ReturnType<typeof renderApp>>, text: string) => {
  const at = app.find(text);
  const line = app.renderer.currentRenderBuffer.getSpanLines()[at.y] as unknown as { spans: { text: string; fg: { toString(): string }; bg: { toString(): string } }[] };
  return line.spans.find((span) => span.text.includes(text));
};

describe("composer chips", () => {
  test("a pasted image becomes an [image 1] chip, left out of the text that's sent", async () => {
    const fake = uploads();
    const app = await open({ session: fake, clipboard: { image: { bytes: PNG, mimeType: "image/png" } } });
    await app.press("i");
    await app.type("look at ");
    await app.press("v", { ctrl: true });
    await app.type("this");
    expect(composerLine(app.frame())).toContain("look at [image 1] this");
    await app.press("return");
    const [call] = app.calls("sendMessage");
    expect([call?.args[0], call?.args[1]]).toEqual([v2ThreadId, "look at this"]);
    expect(call?.args[5]).toMatchObject([{ id: "att-1" }]);
  });

  test("the chip is drawn in the accent colour on the raised background", async () => {
    const app = await open({ session: uploads(), clipboard: { image: { bytes: PNG, mimeType: "image/png" } } });
    await app.press("i");
    await app.press("v", { ctrl: true });
    const { colors } = await import("../../src/ui/theme.ts");
    const span = spanAt(app, "[image 1]");
    const hex = (color: { toString(): string } | undefined) => color?.toString();
    const { RGBA } = await import("@opentui/core");
    expect(hex(span?.fg)).toBe(RGBA.fromHex(colors.accent).toString());
    expect(hex(span?.bg)).toBe(RGBA.fromHex(colors.element).toString());
  });

  test("backspace deletes a chip whole, and its attachment with it", async () => {
    const app = await open({ session: uploads(), clipboard: { image: { bytes: PNG, mimeType: "image/png" } } });
    await app.press("i");
    await app.press("v", { ctrl: true });
    expect(app.frame()).toContain("pasted-image.png ✕");
    await app.press("backspace");
    await app.press("backspace");
    expect(app.frame()).not.toContain("[image");
    expect(app.frame()).not.toContain("pasted-image.png ✕");
    expect(app.calls("deleteAttachment").map((call) => call.args[0])).toEqual(["att-1"]);
  });

  test("removing an attachment takes its chip out, and the others keep theirs", async () => {
    const app = await open({ session: uploads("one.png", "two.png"), clipboard: { image: { bytes: PNG, mimeType: "image/png" } } });
    await app.press("i");
    await app.press("v", { ctrl: true });
    await app.press("v", { ctrl: true });
    expect(composerLine(app.frame())).toContain("[image 1] [image 2]");
    const remove = app.find("one.png ✕");
    await app.click(remove.x + "one.png ".length, remove.y);
    expect(app.frame()).not.toContain("[image 1]");
    expect(composerLine(app.frame())).toContain("[image 2]");
  });

  test("a message that fails to send comes back with its chip, and isn't sent with the chip's text", async () => {
    const fake = uploads();
    const failing = fakeSession({ failures: { sendMessage: "socket closed" } });
    const session = new Proxy(failing.session, { get: (target, key) => (key === "uploadAttachment" || key === "watchServerConfig" ? Reflect.get(fake.session, key) : Reflect.get(target, key)) });
    const app = await open({ session: { ...failing, session }, clipboard: { image: { bytes: PNG, mimeType: "image/png" } } });
    await app.press("i");
    await app.type("look");
    await app.press("v", { ctrl: true });
    await app.press("return");
    await app.settle(50);
    expect(app.calls("sendMessage")[0]?.args[1]).toBe("look");
    expect(composerLine(app.frame())).toContain("look [image 1]");
    expect(app.frame()).toContain("pasted-image.png ✕");
  });

  test("an @ file is a chip showing its path, and is sent as the link the web sends", async () => {
    const app = await open({ session: fakeSession({ results: { searchEntries: [{ kind: "file", path: "src/ui/App.tsx" }] } }) });
    await app.press("i");
    await app.type("see @App");
    await app.settle(200);
    expect(app.frame()).toContain("App.tsx");
    await app.press("tab");
    expect(composerLine(app.frame())).toContain("see @src/ui/App.tsx");
    await app.type("now");
    await app.press("return");
    expect(app.calls("sendMessage")[0]?.args[1]).toBe("see [App.tsx](src/ui/App.tsx) now");
  });

  test("backspace over an @ chip deletes it whole", async () => {
    const app = await open({ session: fakeSession({ results: { searchEntries: [{ kind: "file", path: "src/ui/App.tsx" }] } }) });
    await app.press("i");
    await app.type("see @App");
    await app.settle(200);
    await app.press("tab");
    await app.press("backspace");
    await app.press("backspace");
    expect(composerLine(app.frame())).not.toContain("@src");
    await app.type("draft");
    expect(composerLine(app.frame())).toContain("see draft");
  });
});
