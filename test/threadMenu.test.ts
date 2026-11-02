import { describe, expect, test } from "bun:test";
import { OrchestrationV2Command, ThreadId, type OrchestrationV2ShellSnapshot, type OrchestrationV2ThreadShell, type ServerConfig } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { T3Session } from "../src/client/session.ts";
import { generateSpreadPinOrderKeys } from "@t3tools/client-runtime/state/thread-sort";
import { parseSnooze, threadMenu, topPinOrderKey } from "../src/model/threadMenu.ts";

const config = { environment: { environmentId: "env-1", capabilities: { threadAutoSettleOptOut: true } }, settings: {} } as unknown as ServerConfig;
const at = (ms: number) => DateTime.makeUnsafe(ms);
const thread = {
  id: "t1",
  title: "Release supervisor",
  projectId: "p1",
  branch: "main",
  worktreePath: null,
  status: "completed",
  activeRunId: null,
  latestRunId: "run-1",
  latestRunRequestedAt: at(100),
  latestRunStartedAt: at(110),
  latestRunCompletedAt: at(200),
  pendingRuntimeRequest: null,
  latestUserMessageAt: null,
  lineage: { relationshipToParent: null, parentThreadId: null },
  modelSelection: { instanceId: "codex", model: "gpt" },
  archivedAt: null,
  deletedAt: null,
  settledOverride: null,
  settledAt: null,
  pinnedAt: null,
  autoSettleDisabledAt: null,
  snoozedUntil: null,
  titleRegeneration: null,
  lastVisitedAt: at(250),
  hasActionableProposedPlan: false,
  interactionMode: "default",
  createdAt: at(0),
  updatedAt: at(200),
} as unknown as OrchestrationV2ThreadShell;

const ids = (items: ReturnType<typeof threadMenu>["items"]): string[] => items.flatMap((item) => [item.id, ...(item.children ?? []).map((child) => child.id)]);

describe("thread menu", () => {
  test("has the web's actions, less the web-only ones", () => {
    const menu = ids(threadMenu({ thread, config, timestampFormat: "24-hour", now: new Date(2026, 10, 2, 10) }).items);
    expect(menu).toContain("new-thread-on-branch");
    expect(menu).toContain("pin");
    expect(menu).toContain("settle");
    expect(menu).toContain("snooze:custom");
    expect(menu).toContain("rename");
    expect(menu).toContain("auto-settle:disabled");
    expect(menu).toContain("copy-thread-id");
    expect(menu).toContain("delete");
    expect(menu).not.toContain("project-settings");
    expect(menu).not.toContain("find");
  });

  test("a settled, pinned thread offers to undo both", () => {
    const menu = ids(threadMenu({ thread: { ...thread, settledOverride: "settled", pinnedAt: at(300) } as OrchestrationV2ThreadShell, config, timestampFormat: "24-hour" }).items);
    expect(menu).toContain("unsettle");
    expect(menu).toContain("unpin");
  });

  test("custom snooze takes durations and times of day", () => {
    const now = new Date(2026, 10, 2, 10, 0);
    expect(parseSnooze("45m", now)?.getTime()).toBe(now.getTime() + 45 * 60_000);
    expect(parseSnooze("2d", now)?.getDate()).toBe(4);
    expect(parseSnooze("17:30", now)?.getHours()).toBe(17);
    expect(parseSnooze("09:00", now)?.getDate()).toBe(3);
    expect(parseSnooze("soon", now)).toBeNull();
  });

  test("a pin goes above the current first pin", () => {
    const first = generateSpreadPinOrderKeys(1)[0]!;
    const snapshot = { threads: [{ pinnedAt: "x", pinOrderKey: first }] } as unknown as OrchestrationV2ShellSnapshot;
    const key = topPinOrderKey(snapshot);
    expect(key !== undefined && key < first).toBe(true);
  });

  test("every action dispatches a valid command", async () => {
    const session = new T3Session();
    const sent: unknown[] = [];
    (session as unknown as { dispatch: (command: unknown) => Promise<void> }).dispatch = async (command) => void sent.push(command);
    const id = ThreadId.make("t1");
    await session.settleThread(id);
    await session.unsettleThread(id);
    await session.pinThread(id, "a0");
    await session.unpinThread(id);
    await session.snoozeThread(id, "2026-11-03T09:00:00.000Z");
    await session.unsnoozeThread(id);
    await session.setAutoSettle(id, false);
    await session.markUnread(id);
    await session.renameThread(id, "New name");
    await session.regenerateTitle(id);
    await session.archiveThread(id);
    await session.deleteThread(id, false);
    expect(sent.filter((command) => !Schema.is(OrchestrationV2Command)(command))).toEqual([]);
    expect(sent.map((command) => (command as { type: string }).type)).toEqual([
      "thread.settle",
      "thread.unsettle",
      "thread.pin",
      "thread.unpin",
      "thread.snooze",
      "thread.unsnooze",
      "thread.auto-settle.set",
      "thread.mark-unread",
      "thread.metadata.update",
      "thread.metadata.update",
      "thread.archive",
      "thread.delete",
    ]);
  });
});
