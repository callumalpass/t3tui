import { describe, expect, test } from "bun:test";
import { EnvironmentId, OrchestrationV2Command, ThreadId, type OrchestrationV2ShellSnapshot, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { T3Session } from "../src/client/session.ts";
import { applyComposerItem, composerTrigger, cursorAtIndex, indexAtCursor, messageContext, pathItems, skillItems, slashItems, threadItems } from "../src/model/composerMenu.ts";

const provider = {
  instanceId: "claude",
  slashCommands: [{ name: "review", description: "Review the diff" }, { name: "compact", description: "Compact the conversation" }],
  skills: [
    { name: "deploy", description: "Ship it", path: "/s/deploy", enabled: true },
    { name: "hidden", path: "/s/hidden", enabled: true, userInvocable: false },
    { name: "off", path: "/s/off", enabled: false },
  ],
} as unknown as ServerProvider;

function slash(text: string, cursor = text.length) {
  const trigger = composerTrigger(text, cursor)!;
  return slashItems({ provider, cwd: null, text, trigger }).map((item) => item.label);
}

describe("composer menu", () => {
  test("finds the trigger under the cursor, as the web composer does", () => {
    expect(composerTrigger("/rev", 4)).toMatchObject({ kind: "slash-command", query: "rev", rangeStart: 0 });
    expect(composerTrigger("look at @src/ap", 15)).toMatchObject({ kind: "path", query: "src/ap", rangeStart: 8 });
    expect(composerTrigger("use $dep", 8)).toMatchObject({ kind: "skill", query: "dep" });
    expect(composerTrigger("costs $5", 8)).toBeNull();
    expect(composerTrigger("see /usr/lib", 12)).toBeNull();
    expect(composerTrigger("/model", 6)).toMatchObject({ kind: "slash-command", query: "model" });
  });

  test("offers provider commands only at the start, and /compact only alone", () => {
    expect(slash("/")).toEqual(["/model", "/review", "/compact", "/skill:deploy"]);
    expect(slash("/ then more", 1)).toEqual(["/model", "/review", "/skill:deploy"]);
    expect(slash("text /")).toEqual(["/model", "/skill:deploy"]);
    expect(slash("/rev")[0]).toBe("/review");
  });

  test("skills leave out disabled and agent-only ones and insert $name", () => {
    const items = skillItems(provider, null, "");
    expect(items.map((item) => item.replacement)).toEqual(["$deploy "]);
  });

  test("replacing swallows a following space and puts the cursor after it", () => {
    const text = "run $dep now";
    const trigger = composerTrigger(text, 8)!;
    expect(applyComposerItem(text, trigger, "$deploy ")).toEqual({ text: "run $deploy now", cursor: 12 });
  });

  test("paths insert the web's file link", () => {
    const [item] = pathItems([{ path: "src/ui/App (old).tsx", kind: "file" }]);
    expect(item).toMatchObject({ label: "App (old).tsx", description: "src/ui", replacement: "[App (old).tsx](src/ui/App%20%28old%29.tsx) " });
  });

  test("a thread mention sends its record while its link stays in the text", async () => {
    const snapshot = {
      projects: [{ id: "p", title: "proj" }],
      threads: [
        { id: "t1", projectId: "p", title: "Release supervisor", branch: null, archivedAt: null, deletedAt: null, lineage: { relationshipToParent: null }, updatedAt: "2026-11-01T00:00:00.000Z", latestUserMessageAt: null },
        { id: "t2", projectId: "p", title: "Release helper", branch: null, archivedAt: null, deletedAt: null, lineage: { relationshipToParent: "subagent" }, updatedAt: "2026-11-01T00:00:00.000Z", latestUserMessageAt: null },
      ],
    } as unknown as OrchestrationV2ShellSnapshot;
    const items = threadItems({ snapshot, environmentId: EnvironmentId.make("env-1"), excludeThreadId: null, query: "release" });
    expect(items.map((item) => item.label)).toEqual(["Release supervisor"]);
    const record = items[0]!.record!;
    const text = `compare with ${items[0]!.replacement}please`;
    const records = new Map([[record.contextId as string, record]]);
    const context = messageContext(text, records);
    expect(context).toEqual({ version: 1, records: [record] });
    expect(messageContext("link removed", records)).toBeUndefined();

    const session = new T3Session();
    const sent: unknown[] = [];
    (session as unknown as { dispatch: (command: unknown) => Promise<void> }).dispatch = async (command) => void sent.push(command);
    await session.sendMessage(ThreadId.make("t9"), text, "auto", undefined, context);
    expect(Schema.is(OrchestrationV2Command)(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({ context: { records: [{ kind: "thread", threadId: "t1" }] } });
  });

  test("cursor columns count wide characters twice", () => {
    const text = "é😀ab\nx你y";
    expect(indexAtCursor(text, 0, 3)).toBe(3); // after the emoji
    expect(indexAtCursor(text, 1, 3)).toBe(text.indexOf("y"));
    expect(cursorAtIndex(text, text.indexOf("y"))).toEqual({ row: 1, col: 3 });
  });
});
