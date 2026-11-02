import { describe, expect, test } from "bun:test";

import { bindingFor, commandsFor, fromCommand, hintsFor, keyMatches, type Binding, type KeyLike } from "../src/model/keymap.ts";

const key = (name: string, extra: Partial<KeyLike> = {}): KeyLike => ({ name, ctrl: false, meta: false, shift: false, sequence: name.length === 1 ? name : "", ...extra });

describe("keys as people write them", () => {
  test("letters, shifted letters and chords", () => {
    expect(keyMatches("y", key("y"))).toBe(true);
    expect(keyMatches("y", key("y", { shift: true }))).toBe(false);
    expect(keyMatches("Y", key("y", { shift: true }))).toBe(true);
    expect(keyMatches("Y", key("y"))).toBe(false);
    expect(keyMatches("ctrl+k", key("k", { ctrl: true }))).toBe(true);
    expect(keyMatches("k", key("k", { ctrl: true }))).toBe(false);
    expect(keyMatches("alt+enter", key("return", { meta: true }))).toBe(true);
    expect(keyMatches("alt+↑", key("up", { meta: true }))).toBe(true);
    expect(keyMatches("shift+enter", key("return", { shift: true }))).toBe(true);
    expect(keyMatches("enter", key("return", { shift: true }))).toBe(false);
  });

  test("named keys and punctuation", () => {
    expect(keyMatches("esc", key("escape"))).toBe(true);
    expect(keyMatches("enter", key("return"))).toBe(true);
    expect(keyMatches("[", key("["))).toBe(true);
    // ":" and "?" arrive shifted; that's how they're typed.
    expect(keyMatches(":", key(":", { shift: true }))).toBe(true);
    expect(keyMatches(".", key("."))).toBe(true);
    expect(keyMatches("pagedown", key("pagedown"))).toBe(true);
  });

  test("ctrl+j also comes as a line feed", () => {
    expect(keyMatches("ctrl+j", key("linefeed"))).toBe(true);
    expect(keyMatches("j", key("linefeed"))).toBe(false);
  });
});

describe("bindings", () => {
  const ran: string[] = [];
  const bindings: Binding[] = [
    { keys: ["y"], run: () => ran.push("approve"), hint: "approve", command: { id: "approve", title: "Approve request" } },
    { keys: ["j", "↓"], label: "j/k", run: () => ran.push("down"), hint: "threads" },
    { keys: ["k", "↑"], run: () => ran.push("up") },
    { keys: [], label: "1-9", hint: "pick" },
    { keys: ["enter"], run: () => ran.push("send"), hint: "send", passive: true },
    { keys: ["y"], run: () => ran.push("shadowed") },
  ];

  test("the first binding with the key runs; passive ones leave it to the input", () => {
    bindingFor(bindings, key("y"))?.run?.();
    bindingFor(bindings, key("down"))?.run?.();
    expect(ran).toEqual(["approve", "down"]);
    expect(bindingFor(bindings, key("return"))).toBeUndefined();
    expect(bindingFor(bindings, key("1"))).toBeUndefined();
  });

  test("hints in order, clickable when they run something", () => {
    const hints = hintsFor(bindings);
    expect(hints.map((hint) => `${hint.key} ${hint.label}`)).toEqual(["y approve", "j/k threads", "1-9 pick", "enter send"]);
    expect(hints.map((hint) => hint.run !== undefined)).toEqual([true, true, false, true]);
  });

  test("palette commands carry their key", () => {
    expect(commandsFor(bindings).map(({ id, title, shortcut }) => ({ id, title, shortcut }))).toEqual([{ id: "approve", title: "Approve request", shortcut: "y" }]);
  });

  test("a palette command's shortcut becomes its key", () => {
    const binding = fromCommand({ id: "archived", title: "Show archived threads", shortcut: "A", run: () => ran.push("archived") });
    bindingFor([binding], key("a", { shift: true }))?.run?.();
    expect(ran.at(-1)).toBe("archived");
    expect(commandsFor([binding])[0]?.shortcut).toBe("A");
  });
});
