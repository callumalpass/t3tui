import { afterEach, describe, expect, test } from "bun:test";

import { withReply } from "./fixtures.ts";
import { fakeSession, renderApp } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

const table = "| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | a longer cell |\n";
const paragraphs = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => `Paragraph ${from + index} of the answer.\n\n`).join("");
/** The frame without its scrollbar column, which moves as the content grows. */
const content = (frame: string) => frame.split("\n").map((line) => line.slice(0, -3)).join("\n");

describe("streaming replies", () => {
  test("tables render as tables, while streaming and once settled", async () => {
    const fake = fakeSession({ projection: withReply(`Here:\n\n${table.slice(0, 40)}`, true) });
    const app = await open({ session: fake });
    expect(app.frame()).toContain("│ Name  │ Value │");
    fake.updateThread(withReply(`Here:\n\n${table}\nAfter.`, false));
    await app.settle(50);
    expect(app.frame()).toContain("│ beta  │ a longer cell │");
    expect(app.frame()).not.toContain("| --- |");
  });

  test("at the bottom, a long answer keeps its newest line in view", async () => {
    const fake = fakeSession({ projection: withReply("", true) });
    const app = await open({ session: fake, height: 30 });
    for (let count = 10; count <= 60; count += 10) {
      fake.updateThread(withReply(paragraphs(0, count), true));
      await app.settle();
      expect(app.frame()).toContain(`Paragraph ${count - 1} of the answer.`);
    }
  });

  test("scrolled up, the text in view stays put as the answer grows and settles", async () => {
    let text = paragraphs(0, 40);
    const fake = fakeSession({ projection: withReply(text, true) });
    const app = await open({ session: fake, height: 30 });
    await app.mockMouse.scroll(60, 10, "up");
    await app.mockMouse.scroll(60, 10, "up");
    await app.settle(30);
    const before = content(app.frame());
    for (let more = 40; more < 50; more++) {
      text += `Paragraph ${more} of the answer.\n\n`;
      fake.updateThread(withReply(text, true));
      await app.settle();
      expect(content(app.frame())).toBe(before);
    }
    fake.updateThread(withReply(`${text}${table}`, false));
    await app.settle(30);
    expect(content(app.frame())).toBe(before);
  });
});
