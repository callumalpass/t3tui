import type { CliRenderer } from "@opentui/core";
import { threadChipCopyTarget } from "@t3tools/client-runtime/thread-reference";
import type { ContextMenuItem, OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell, ServerConfig, ThreadId } from "@t3tools/contracts";

import type { T3Session } from "../client/session.ts";
import type { T3tuiConfig } from "../config.ts";
import type { Binding } from "../model/keymap.ts";
import type { Picker, PickerItem } from "../model/palette.ts";
import { parseSnooze, pickSnooze, threadHasRuntime, threadMenu, topPinOrderKey, type ThreadActionMenuId } from "../model/threadMenu.ts";
import type { Confirmation } from "./ConfirmBar.tsx";
import { copyText } from "./terminalOut.ts";

type SnoozePresets = ReturnType<typeof threadMenu>["snoozePresets"];

/** The web sidebar's thread menu as a picker: separators become groups, submenus open their own picker. */
export function useThreadMenu(deps: {
  readonly session: T3Session;
  readonly renderer: CliRenderer;
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
  readonly config: ServerConfig | null;
  readonly timestampFormat: T3tuiConfig["timestampFormat"];
  /** The open thread: the menu's key and palette command act on it. */
  readonly thread: OrchestrationV2ThreadShell | undefined;
  readonly openPicker: (picker: Picker) => void;
  /** `prefill` puts text in the confirmation's message box. */
  readonly confirm: (confirmation: Confirmation, prefill?: string) => void;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  readonly say: (text: string, bad?: boolean) => void;
  readonly openThread: (id: ThreadId) => void;
  readonly openFind: () => void;
  /** The thread was archived or deleted: stop showing it. */
  readonly left: (id: ThreadId) => void;
  /** Marked unread: don't mark it read again until it's opened again. */
  readonly keepUnread: (id: ThreadId) => void;
  readonly startDraftOn: (target: OrchestrationV2ThreadShell) => void;
}) {
  const { session, renderer, config, run, say } = deps;

  const copy = (text: string, message: string) => {
    copyText(renderer, text);
    say(message);
  };

  const snooze = (target: OrchestrationV2ThreadShell, action: ThreadActionMenuId, presets: SnoozePresets) => {
    const id = target.id;
    if (action === "snooze:custom") {
      return deps.confirm({
        title: `Snooze "${target.title || "New thread"}"`,
        detail: "For a while (45m, 3h, 2d, 1w) or until a time (17:30).",
        message: { placeholder: "3h" },
        confirmLabel: "snooze",
        run: (text) => {
          const wake = parseSnooze(text);
          if (!wake) return say("Type a duration like 3h or 2d, or a time like 17:30.", true);
          run(`Snoozed until ${wake.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`, () => session.snoozeThread(id, wake.toISOString()));
        },
      });
    }
    const preset = pickSnooze(presets, action.slice("snooze:".length), config, deps.timestampFormat);
    if (!preset) return say("That snooze time has passed. Choose another time.", true);
    run(`Snoozed until ${preset.whenLabel}`, () => session.snoozeThread(id, preset.snoozedUntil));
  };

  const runAction = (target: OrchestrationV2ThreadShell, action: ThreadActionMenuId, presets: SnoozePresets) => {
    const id = target.id;
    const title = target.title || "New thread";
    const workspacePath = target.worktreePath ?? deps.snapshot?.projects.find((candidate) => candidate.id === target.projectId)?.workspaceRoot;
    if (action.startsWith("snooze:")) return snooze(target, action, presets);
    switch (action) {
      case "find":
        deps.openThread(id);
        return deps.openFind();
      case "settle":
        return run("Settled", () => session.settleThread(id));
      case "unsettle":
        return run("Un-settled", () => session.unsettleThread(id));
      case "unsnooze":
        return run("Woke the thread", () => session.unsnoozeThread(id));
      case "pin":
        return run("Pinned", () => session.pinThread(id, topPinOrderKey(deps.snapshot)));
      case "unpin":
        return run("Unpinned", () => session.unpinThread(id));
      case "auto-settle:enabled":
      case "auto-settle:disabled":
        return run(action === "auto-settle:enabled" ? "Auto-settle on" : "Auto-settle off", () => session.setAutoSettle(id, action === "auto-settle:enabled"));
      case "regenerate-title":
        return run("Regenerating the title", () => session.regenerateTitle(id));
      case "mark-unread":
        deps.keepUnread(id);
        return run("Marked unread", () => session.markUnread(id));
      case "rename":
        return deps.confirm(
          {
            title: "Rename thread",
            message: { placeholder: title },
            confirmLabel: "rename",
            run: (text) => {
              const next = text.trim();
              if (next && next !== target.title) run("Renamed", () => session.renameThread(id, next));
            },
          },
          target.title,
        );
      case "new-thread-on-branch":
        return deps.startDraftOn(target);
      case "copy-path":
        if (!workspacePath) return say("This thread does not have a workspace path to copy.", true);
        return copy(workspacePath, `Path copied: ${workspacePath}`);
      case "copy-branch":
        if (target.branch) copy(target.branch, `Branch copied: ${target.branch}`);
        return;
      case "copy-thread": {
        const environmentId = config?.environment.environmentId;
        if (!environmentId) return say("Server details are still loading.", true);
        return copy(threadChipCopyTarget({ environmentId, threadId: id }, title).value, `Thread copied: ${title}`);
      }
      case "copy-thread-id":
        return copy(id, `Thread ID copied: ${id}`);
      case "archive":
        return run("Archived", async () => {
          await session.archiveThread(id);
          deps.left(id);
        });
      case "delete":
        // The web confirms deletes by default (confirmThreadDelete).
        return deps.confirm({
          title: `Delete thread "${title}"?`,
          detail: `This permanently clears conversation history for this thread.${target.worktreePath ? " Its worktree stays on disk." : ""}`,
          confirmLabel: "delete",
          run: () =>
            run("Deleted", async () => {
              await session.deleteThread(id, threadHasRuntime(target, config));
              deps.left(id);
            }),
        });
      default:
        return;
    }
  };

  const open = (target: OrchestrationV2ThreadShell) => {
    const menu = threadMenu({ thread: target, config, timestampFormat: deps.timestampFormat });
    const toPicker = (title: string, items: readonly ContextMenuItem<ThreadActionMenuId>[]): Picker => {
      const groups: { label: string; items: PickerItem[] }[] = [{ label: title, items: [] }];
      for (const item of items) {
        if (item.separatorBefore && groups[groups.length - 1]!.items.length > 0) groups.push({ label: "", items: [] });
        const group = groups[groups.length - 1]!;
        const hint = item.disabled ? "unavailable" : item.checked ? "current" : item.children ? "›" : undefined;
        group.items.push({
          id: `thread-menu:${item.id}`,
          title: item.label,
          ...(hint ? { hint } : {}),
          run: () => {
            if (item.disabled) return say(`${item.label} is unavailable for this thread right now.`, true);
            if (item.children) return deps.openPicker(toPicker(`${target.title || "New thread"} › ${item.label}`, item.children));
            runAction(target, item.id, menu.snoozePresets);
          },
        });
        // A submenu's items are found by typing at the top too: "thread id" finds Copy › Thread ID.
        for (const child of item.disabled ? [] : (item.children ?? [])) {
          if (child.disabled) continue;
          group.items.push({ id: `thread-menu:${child.id}`, title: `${item.label} › ${child.label}`, ...(child.checked ? { hint: "current" } : {}), searchOnly: true, run: () => runAction(target, child.id, menu.snoozePresets) });
        }
      }
      return { placeholder: "Thread actions", groups };
    };
    deps.openPicker(toPicker(target.title || "New thread", menu.items));
  };

  const thread = deps.thread;
  const key: Binding | null = thread
    ? { keys: ["."], run: () => open(thread), hint: "actions", command: { id: "thread-menu", title: "Thread actions…", keywords: ["settle", "pin", "snooze", "rename", "archive", "delete", "copy", "unread", "menu"] } }
    : null;

  return { open, key };
}
