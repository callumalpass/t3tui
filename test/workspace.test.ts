import { describe, expect, test } from "bun:test";
import { OrchestrationV2Command, ThreadId, TerminalOpenInput, TerminalCloseInput, TerminalClearInput, VcsSwitchRefInput, VcsCreateRefInput, VcsPullInput, VcsCreateWorktreeInput, VcsRemoveWorktreeInput, LaunchEditorInput, WorktreeSetupCancelInput, type TerminalSummary, type WorktreeSetupSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { T3Session } from "../src/client/session.ts";
import { newTerminalInput, preferredEditor, resolveBranchSelectionTarget, worktreeSetupNote } from "../src/model/workspace.ts";

const threadId = ThreadId.make("thread-1");

function capturingSession(results: Record<string, unknown> = {}) {
  const sent: { method: string; input: unknown }[] = [];
  const session = new T3Session();
  const rpc = new Proxy({}, { get: (_, method: string) => (input: unknown) => {
    sent.push({ method, input });
    return Effect.succeed(results[method]);
  } });
  (session as unknown as { connection: unknown }).connection = { rpc };
  return { session, sent };
}

const terminal = (id: string): TerminalSummary => ({ threadId, terminalId: id, cwd: "/repo", worktreePath: null, status: "running", pid: 1, exitCode: null, exitSignal: null, hasRunningSubprocess: false, label: "", updatedAt: "2026-11-01T00:00:00.000Z" });

describe("workspace logic", () => {
  test("new terminals use the web's numbering, cwd and project environment", () => {
    const request = newTerminalInput(threadId, "/repo", "/worktree", [terminal("term-1"), terminal("term-3")], true);
    expect(Schema.is(TerminalOpenInput)(request)).toBe(true);
    expect(request).toEqual({ threadId, terminalId: "term-2", cwd: "/worktree", worktreePath: "/worktree", env: { T3CODE_PROJECT_ROOT: "/repo", T3CODE_WORKTREE_PATH: "/worktree" } });
    const local = newTerminalInput(threadId, "/repo", null, [], false);
    expect(local.terminalId).toMatch(/^term-1-[a-f0-9-]+$/);
    expect(local.cwd).toBe("/repo");
    expect(local.env).toEqual({ T3CODE_PROJECT_ROOT: "/repo" });
  });

  test("editor preference falls back in the web's order, not the server list's order", () => {
    expect(preferredEditor(["vscode", "cursor"])).toBe("cursor");
    expect(preferredEditor(["vscode"])).toBe("vscode");
    expect(preferredEditor([])).toBeNull();
  });

  test("branch selection reuses worktrees and returns the default branch to the project", () => {
    expect(resolveBranchSelectionTarget({ activeProjectCwd: "/repo", activeWorktreePath: "/old", refName: { isDefault: false, worktreePath: "/existing" } })).toEqual({ checkoutCwd: "/existing", nextWorktreePath: "/existing", reuseExistingWorktree: true });
    expect(resolveBranchSelectionTarget({ activeProjectCwd: "/repo", activeWorktreePath: "/old", refName: { isDefault: true, worktreePath: null } })).toEqual({ checkoutCwd: "/repo", nextWorktreePath: null, reuseExistingWorktree: false });
  });

  test("setup progress names the web's stage, percent, details and failures", () => {
    const snapshot: WorktreeSetupSnapshot = { threadId, phase: "running", startedAt: "2026-11-01T00:00:00.000Z", endedAt: null, branch: "feature", baseRef: "main", worktreePath: null, setupScript: null, sequence: 1, error: null, stages: [{ id: "fetch", status: "running", percent: 42, detail: "Fetching origin", startedAt: null, endedAt: null, tail: [] }] };
    expect(worktreeSetupNote(snapshot)).toBe("Worktree setup: running · Fetch base branch · 42% · Fetching origin");
    expect(worktreeSetupNote({ ...snapshot, phase: "failed", error: "Fetch failed" })).toContain("Fetch failed");
    expect(worktreeSetupNote({ ...snapshot, phase: "cancelled", stages: [] })).toBe("Worktree setup: cancelled");
    expect(worktreeSetupNote({ ...snapshot, phase: "done" })).toBeNull();
    expect(worktreeSetupNote(null)).toBeNull();
  });
});

describe("workspace RPC payloads (no live mutations)", () => {
  test("terminal open, close and clear validate against the server contracts", async () => {
    const { session, sent } = capturingSession();
    await session.openTerminal(newTerminalInput(threadId, "/repo", null, [], true));
    await session.closeTerminal(threadId, "term-1");
    await session.clearTerminal(threadId, "term-1");
    expect(sent.map((call) => call.method)).toEqual(["terminal.open", "terminal.close", "terminal.clear"]);
    expect(Schema.is(TerminalOpenInput)(sent[0]!.input)).toBe(true);
    expect(Schema.is(TerminalCloseInput)(sent[1]!.input)).toBe(true);
    expect(sent[1]!.input).toMatchObject({ threadId, terminalId: "term-1", deleteHistory: true });
    expect(Schema.is(TerminalClearInput)(sent[2]!.input)).toBe(true);
  });

  test("branch, worktree, editor and setup cancellation requests validate", async () => {
    const { session, sent } = capturingSession();
    await session.switchRef("/repo", "origin/feature");
    await session.createRef("/repo", "feature");
    await session.pull("/repo");
    await session.createWorktree("/repo", "main", "new-work");
    await session.removeWorktree("/repo", "/worktree");
    await session.openInEditor("/worktree/src/index.ts", "vscode");
    await session.cancelWorktreeSetup(threadId);
    expect(sent.map((call) => call.method)).toEqual(["vcs.switchRef", "vcs.createRef", "vcs.pull", "vcs.createWorktree", "vcs.removeWorktree", "shell.openInEditor", "worktreeSetup.cancel"]);
    const schemas = [VcsSwitchRefInput, VcsCreateRefInput, VcsPullInput, VcsCreateWorktreeInput, VcsRemoveWorktreeInput, LaunchEditorInput, WorktreeSetupCancelInput];
    schemas.forEach((schema, index) => {
      expect(Schema.is(schema)(sent[index]!.input)).toBe(true);
    });
    expect(sent[1]!.input).toMatchObject({ switchRef: true });
    expect(sent[3]!.input).toEqual({ cwd: "/repo", refName: "main", newRefName: "new-work", path: null });
    expect(sent[4]!.input).not.toHaveProperty("force");
  });

  test("moving folders detaches provider sessions before persisting thread metadata", async () => {
    const { session, sent } = capturingSession({ "orchestration.getThreadProjection": { providerSessions: [{ id: "session-1" }, { id: "session-2" }] } });
    await session.setThreadWorkspace(threadId, "feature", "/worktree", null);
    const commands = sent.filter((call) => call.method === "orchestration.dispatchCommand").map((call) => call.input);
    expect(commands).toHaveLength(3);
    expect(commands.every(Schema.is(OrchestrationV2Command))).toBe(true);
    expect(commands[0]).toMatchObject({ type: "provider-session.detach", providerSessionId: "session-1", reason: "client-requested" });
    expect(commands[2]).toMatchObject({ type: "thread.metadata.update", threadId, branch: "feature", worktreePath: "/worktree" });
  });

  test("switching branches within a workspace leaves provider sessions attached", async () => {
    const { session, sent } = capturingSession();
    await session.setThreadWorkspace(threadId, "feature", null, null);
    expect(sent).toHaveLength(1);
    expect(Schema.is(OrchestrationV2Command)(sent[0]!.input)).toBe(true);
  });

  test("worktree removal refuses shared folders before detaching or removing anything", async () => {
    const { session, sent } = capturingSession({ "orchestration.getWorktreeThreadIds": { threadIds: [threadId, ThreadId.make("idle-child")] } });
    await expect(session.removeThreadWorktree(threadId, "/repo", "/worktree")).rejects.toThrow("Other threads still use this worktree.");
    expect(sent.map((call) => call.method)).toEqual(["orchestration.getWorktreeThreadIds"]);
  });

  test("worktree removal checks occupants, detaches, removes and updates metadata in order", async () => {
    const { session, sent } = capturingSession({ "orchestration.getWorktreeThreadIds": { threadIds: [threadId] }, "orchestration.getThreadProjection": { providerSessions: [{ id: "session-1" }] } });
    await session.removeThreadWorktree(threadId, "/repo", "/worktree");
    expect(sent.map((call) => call.method)).toEqual(["orchestration.getWorktreeThreadIds", "orchestration.getThreadProjection", "orchestration.dispatchCommand", "vcs.removeWorktree", "orchestration.dispatchCommand"]);
    expect(sent[4]!.input).toMatchObject({ type: "thread.metadata.update", branch: null, worktreePath: null });
  });

  test("branch listing reads all pages", async () => {
    const { session, sent } = capturingSession();
    (session as unknown as { connection: unknown }).connection = { rpc: { "vcs.listRefs": (input: { cursor: number }) => {
      sent.push({ method: "vcs.listRefs", input });
      return Effect.succeed({ isRepo: true, refs: [{ name: input.cursor === 0 ? "main" : "feature" }], nextCursor: input.cursor === 0 ? 1 : null });
    } } };
    expect((await session.listRefs("/repo")).map((ref) => ref.name)).toEqual(["main", "feature"]);
    expect(sent.map((call) => call.input)).toEqual([{ cwd: "/repo", cursor: 0, refKind: "all", limit: 200 }, { cwd: "/repo", cursor: 1, refKind: "all", limit: 200 }]);
  });
});
