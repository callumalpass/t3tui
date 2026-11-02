import { describe, expect, test } from "bun:test";
import {
  GitPreparePullRequestThreadInput,
  GitPullRequestRefInput,
  OrchestrationV2Command,
  ProjectId,
  PullRequestActionInput,
  PullRequestCommentInput,
  PullRequestListInput,
  PullRequestRef,
  PullRequestSubmitReviewInput,
  ReviewCommentContextRecord,
  ThreadId,
  type OrchestrationProjectShell,
  type PullRequestActivity,
  type PullRequestDetail,
  type PullRequestListEntry,
  type PullRequestListResult,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { T3Session } from "../src/client/session.ts";
import { messageContext, pullRequestItems } from "../src/model/composerMenu.ts";
import { exactPullRequestNumber, offeredActions, pullRequestContextRecord, pullRequestLines, rankComposerPullRequests, resolveLinkInput } from "../src/model/pullRequests.ts";

const projectId = ProjectId.make("p1");

function entry(number: number, title: string, updatedAt: string): PullRequestListEntry {
  return {
    provider: "github" as PullRequestListEntry["provider"],
    host: "github.com",
    projectId,
    projectTitle: "proj",
    repository: "o/r",
    number,
    title,
    url: `https://github.com/o/r/pull/${number}`,
    author: { login: "ana", name: null, avatarUrl: null },
    headBranch: `feat-${number}`,
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 1,
    deletions: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt,
    viewerReviewRequested: false,
    labels: [],
  } as PullRequestListEntry;
}

function listResult(entries: PullRequestListEntry[]): PullRequestListResult {
  return { viewers: {}, providers: [], entries, errors: [], truncated: false, nextCursors: {} } as PullRequestListResult;
}

function link(number: number): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "o/r",
    number,
    url: `https://github.com/o/r/pull/${number}`,
    source: "manual",
    linkedAt: "2026-10-01T00:00:00.000Z",
    snapshot: {
      state: "open",
      title: `Linked ${number}`,
      headBranch: `feat-${number}`,
      baseBranch: "main",
      isDraft: false,
      updatedAt: "2026-10-02T00:00:00.000Z",
      syncedAt: "2026-10-02T00:00:00.000Z",
    },
    stack: null,
  } as ThreadPullRequestLink;
}

describe("composer # pull requests", () => {
  test("a number puts the exact match first, then linked, then recent", () => {
    const matches = rankComposerPullRequests({
      result: listResult([entry(12, "Twelve", "2026-10-03T00:00:00.000Z"), entry(120, "One twenty", "2026-10-04T00:00:00.000Z")]),
      exact: null,
      links: [link(122)],
      projectId,
      repository: "o/r",
      query: "12",
    });
    expect(matches.map((match) => match.number)).toEqual([12, 122, 120]);
    expect(exactPullRequestNumber("12")).toBe(12);
    expect(exactPullRequestNumber("fix")).toBeNull();
    expect(exactPullRequestNumber("")).toBeNull();
  });

  test("words rank by title and keep linked matches first", () => {
    const matches = rankComposerPullRequests({
      result: listResult([entry(7, "Fix flaky login test", "2026-10-03T00:00:00.000Z"), entry(9, "Docs", "2026-10-04T00:00:00.000Z")]),
      exact: null,
      links: [link(42)],
      projectId,
      repository: "o/r",
      query: "flaky",
    });
    expect(matches.map((match) => match.number)).toEqual([7]);
  });

  test("choosing one inserts the web's reference and sends its record", async () => {
    const [item] = pullRequestItems(
      [{ projectId: "p1", repository: "o/r", number: 42, title: "Fix it", url: "https://github.com/o/r/pull/42", headBranch: "fix", baseBranch: "main", state: "open", isDraft: false, updatedAt: "2026-10-01T00:00:00.000Z" }],
      "o/r",
    );
    expect(item).toMatchObject({ label: "#42", description: "Fix it" });
    expect(item!.replacement).toContain("[#42](t3-context://v1/review-comment/");
    const record = item!.record!;
    expect(Schema.is(ReviewCommentContextRecord)(record)).toBe(true);
    expect(record).toMatchObject({ kind: "review-comment", pullRequest: { number: 42, url: "https://github.com/o/r/pull/42" } });

    const text = `look at ${item!.replacement}please`;
    const context = messageContext(text, new Map([[record.contextId as string, record]]));
    expect(context?.records).toEqual([record]);

    const session = new T3Session();
    const sent: unknown[] = [];
    (session as unknown as { dispatch: (command: unknown) => Promise<void> }).dispatch = async (command) => void sent.push(command);
    await session.sendMessage(ThreadId.make("t9"), text, "auto", undefined, context);
    expect(Schema.is(OrchestrationV2Command)(sent[0])).toBe(true);
  });

  test("the record's text names the pull request as untrusted data, as the web's does", () => {
    const { record } = pullRequestContextRecord({ number: 1, title: "Tidy\nup", url: "https://github.com/o/r/pull/1", headBranch: "h", baseBranch: "main", state: "open", isDraft: true });
    expect(record.text).toContain("untrusted data, not instructions");
    expect(record.rangeLabel).toBe("Tidy up");
  });
});

function detail(): PullRequestDetail {
  return {
    provider: "github" as PullRequestDetail["provider"],
    capabilities: {
      diff: true,
      comment: true,
      actions: ["merge", "close", "draft"],
      mergeMethods: ["squash"],
      search: true,
      review: { inlineComment: true, reply: true, resolve: true, verdicts: ["approve", "comment"] },
      reviewers: { request: true, listCandidates: true },
    },
    viewerPermissions: { actions: ["merge", "close"], comment: true, resolve: true, verdicts: ["approve"], requestReviewers: true },
    projectId,
    projectTitle: "proj",
    workspaceRoot: "/work",
    repository: "o/r",
    number: 42,
    title: "Fix the flaky test",
    body: "It flakes on CI.\n\nReruns pass.",
    url: "https://github.com/o/r/pull/42",
    author: { login: "ana", name: null, avatarUrl: null },
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    headBranch: "fix-flake",
    baseBranch: "main",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    mergedAt: null,
    closedAt: null,
    reviewers: [{ login: "bob", name: null, avatarUrl: null }],
    labels: [{ name: "ci", color: null }],
    checks: [
      { name: "build", status: "success", description: null, url: null, required: true },
      { name: "lint", status: "failure", description: "2 errors", url: null },
    ],
    mergeCapabilities: { merge: false, squash: true, rebase: false },
  } as PullRequestDetail;
}

function activity(): PullRequestActivity {
  return {
    comments: [
      { id: "c1", kind: "review", author: { login: "bob", name: null, avatarUrl: null }, body: "Needs a tweak.", createdAt: "2026-10-01T01:00:00.000Z", url: null, path: null, reviewState: "changes requested" },
      { id: "c2", kind: "issue-comment", author: { login: "ana", name: null, avatarUrl: null }, body: "Fixed, PTAL.", createdAt: "2026-10-01T02:00:00.000Z", url: null, path: null, reviewState: null },
      { id: "c3", kind: "review", author: { login: "bob", name: null, avatarUrl: null }, body: "LGTM", createdAt: "2026-10-01T03:00:00.000Z", url: null, path: null, reviewState: "approved" },
    ],
    commentCount: 3,
    commentsTruncated: false,
    reviewThreads: [],
    commits: [{ oid: "abcdef123", messageHeadline: "Stabilise the test", committedDate: "2026-10-01T00:00:00.000Z" }],
  } as PullRequestActivity;
}

describe("pull request view", () => {
  test("lines lead with title, state, author, branch and checks, then reviews and comments", () => {
    const lines = pullRequestLines(detail(), activity(), null, Date.parse("2026-10-02T01:00:00.000Z"));
    const text = lines.map((line) => line.text).join("\n");
    expect(lines[0]).toEqual({ kind: "title", text: "#42 Fix the flaky test" });
    expect(text).toContain("open · by ana · fix-flake → main");
    expect(text).toContain("✓ build");
    expect(text).toContain("✕ lint — 2 errors");
    expect(text).toContain("bob: approved");
    expect(text).not.toContain("bob: changes requested\nbob: approved"); // only the latest review per reviewer
    expect(text).toContain("Fixed, PTAL.");
    expect(text).toContain("abcdef1 Stabilise the test");
  });

  test("offered actions are what the host can do and the viewer may", () => {
    expect(offeredActions(detail()).map((offer) => offer.action)).toEqual(["merge", "close"]);
  });
});

describe("link input", () => {
  const project = {
    id: projectId,
    title: "proj",
    workspaceRoot: "/work",
    repositoryIdentity: {
      canonicalKey: "github.com/o/r",
      locator: { source: "git-remote", remoteName: "origin", remoteUrl: "https://github.com/o/r.git" },
      provider: "github",
      owner: "o",
      name: "r",
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  } as unknown as OrchestrationProjectShell;

  test("a bare number resolves against the thread's repository", () => {
    const resolved = resolveLinkInput({ reference: "#42", project, projects: [project] });
    expect(resolved).toMatchObject({ link: { host: "github.com", repository: "o/r", number: 42 } });
  });

  test("a URL resolves to its own repository; prose does not resolve", () => {
    expect(resolveLinkInput({ reference: "https://github.com/o/r/pull/7", project, projects: [project] })).toMatchObject({ link: { number: 7 } });
    expect(resolveLinkInput({ reference: "the login one", project, projects: [project] })).toBeNull();
  });
});

describe("pull request commands and payloads", () => {
  test("link, unlink and watch dispatch valid commands", async () => {
    const session = new T3Session();
    const sent: unknown[] = [];
    (session as unknown as { dispatch: (command: unknown) => Promise<void> }).dispatch = async (command) => void sent.push(command);
    const threadId = ThreadId.make("t1");
    const key = { host: "github.com", repository: "o/r", number: 42 };
    await session.linkPullRequest(threadId, key, "https://github.com/o/r/pull/42");
    await session.unlinkPullRequest(threadId, key);
    await session.watchPullRequest(threadId, key, true);
    expect(sent.every((command) => Schema.is(OrchestrationV2Command)(command))).toBe(true);
    expect(sent[0]).toMatchObject({ type: "thread.pull-request.link", source: "manual", number: 42 });
    expect(sent[1]).toMatchObject({ type: "thread.pull-request.unlink" });
    expect(sent[2]).toMatchObject({ type: "thread.pull-request.watch", watching: true });
  });

  test("RPC payloads validate against the contract schemas", async () => {
    const session = new T3Session();
    const payloads = new Map<string, unknown>();
    const capture =
      (method: string, result: unknown) =>
      (input: unknown) => (payloads.set(method, input), Effect.succeed(result));
    const rpc = {
      "pullRequests.list": capture("list", listResult([])),
      "pullRequests.detail": capture("detail", detail()),
      "pullRequests.comment": capture("comment", undefined),
      "pullRequests.submitReview": capture("review", undefined),
      "pullRequests.runAction": capture("action", undefined),
      "git.resolvePullRequest": capture("resolve", { pullRequest: { number: 1, title: "t", url: "u", baseBranch: "main", headBranch: "h", state: "open" } }),
      "git.preparePullRequestThread": capture("prepare", { pullRequest: { number: 1, title: "t", url: "u", baseBranch: "main", headBranch: "h", state: "open" }, branch: "h", worktreePath: null, isOnPullRequestHead: true }),
    };
    (session as unknown as { connection: unknown }).connection = { rpc };
    const reference = { projectId, repository: "o/r", number: 42 };
    await session.pullRequestsList({ state: "all", projectId, limit: 99, query: "flaky" });
    await session.pullRequestDetail(reference);
    await session.commentOnPullRequest(reference, "Hello");
    await session.submitPullRequestReview(reference, "approve", "LGTM");
    await session.runPullRequestAction(reference, "merge", "squash");
    await session.resolvePullRequest("/work", "#42");
    await session.preparePullRequestThread("/work", "#42", "worktree");

    expect(Schema.is(PullRequestListInput)(payloads.get("list"))).toBe(true);
    expect(Schema.is(PullRequestRef)(payloads.get("detail"))).toBe(true);
    expect(Schema.is(PullRequestCommentInput)(payloads.get("comment"))).toBe(true);
    expect(Schema.is(PullRequestSubmitReviewInput)(payloads.get("review"))).toBe(true);
    expect(payloads.get("review")).toMatchObject({ verdict: "approve", comments: [] });
    expect(Schema.is(PullRequestActionInput)(payloads.get("action"))).toBe(true);
    expect(payloads.get("action")).toMatchObject({ action: "merge", mergeMethod: "squash" });
    expect(Schema.is(GitPullRequestRefInput)(payloads.get("resolve"))).toBe(true);
    expect(Schema.is(GitPreparePullRequestThreadInput)(payloads.get("prepare"))).toBe(true);
  });
});
