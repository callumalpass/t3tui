import type { CliRenderer } from "@opentui/core";
import type {
  GitPreparePullRequestThreadResult,
  OrchestrationProjectShell,
  OrchestrationV2ThreadShell,
  ProjectId,
  PullRequestActivity,
  PullRequestMergeMethod,
  PullRequestDetail,
  PullRequestRef,
  PullRequestReviewGuideResult,
  PullRequestReviewVerdict,
  ServerConfig,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { resolvePullRequestDetailChecks } from "@t3tools/client-runtime/pull-request-checks";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { parsePullRequestReference } from "@t3tools/client-runtime/pull-request-link-input";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { planThreadPullRequestMutation, threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import { useEffect, useMemo, useRef, useState } from "react";

import type { T3Session } from "../client/session.ts";
import { pullRequestItems, type ComposerItem } from "../model/composerMenu.ts";
import { keys, type Binding } from "../model/keymap.ts";
import type { PaletteCommand, Picker } from "../model/palette.ts";
import {
  COMPOSER_PULL_REQUEST_LIST_LIMIT,
  MERGE_METHOD_LABELS,
  exactPullRequestNumber,
  linkKey,
  offeredActions,
  offeredMergeMethods,
  pullRequestLines,
  rankComposerPullRequests,
  referenceForLink,
  resolveLinkInput,
  visibleLinks,
} from "../model/pullRequests.ts";
import type { Confirmation } from "./ConfirmBar.tsx";
import { editInEditor } from "./editor.ts";
import type { Clipboard } from "./clipboard.ts";
import { openInBrowser } from "./links.ts";
import { firstLine } from "./text.ts";
import type { PullRequestViewState } from "./PullRequestView.tsx";

export interface PullRequestDeps {
  readonly session: T3Session;
  readonly renderer: CliRenderer;
  readonly clipboard: Clipboard;
  readonly threadShell: OrchestrationV2ThreadShell | undefined;
  readonly project: OrchestrationProjectShell | undefined;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly serverConfig: ServerConfig | null;
  readonly confirm: (next: Confirmation) => void;
  readonly openPicker: (next: Picker) => void;
  readonly say: (text: string, bad?: boolean) => void;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  /** Shows the PR view (App's mode and render slot). */
  readonly showView: () => void;
  readonly hideView: () => void;
  /** Opens a draft in the prepared checkout, as the web's draft thread does. */
  readonly startDraftFromPullRequest: (project: OrchestrationProjectShell, prepared: GitPreparePullRequestThreadResult) => void;
}

interface Loaded {
  readonly link: ThreadPullRequestLink;
  readonly reference: PullRequestRef;
  readonly status: "loading" | "ready" | "error";
  readonly detail: PullRequestDetail | null;
  readonly activity: PullRequestActivity | null;
  readonly guide: PullRequestReviewGuideResult | null;
  readonly error?: string;
}

const VERDICTS: readonly { value: PullRequestReviewVerdict; label: string; sent: string }[] = [
  { value: "comment", label: "Comment", sent: "Review submitted" },
  { value: "approve", label: "Approve", sent: "Approved" },
  { value: "request-changes", label: "Request changes", sent: "Changes requested" },
];

/**
 * The thread's linked pull requests: the `P` view with its comment, review and host actions,
 * link / unlink / watch, a new thread checked out from a pull request, and the composer's `#`.
 */
export function usePullRequests(deps: PullRequestDeps) {
  const { session, threadShell, project, serverConfig } = deps;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  loadedRef.current = loaded;
  const links = threadShell ? visibleLinks(threadShell) : [];
  const capabilities = serverConfig?.environment.capabilities;
  const linkMode = threadPullRequestLinkMode(capabilities);
  const supportsWatch = capabilities?.threadPullRequestWatch === true;
  const guidesEnabled = serverConfig?.settings.reviewGuidesEnabled === true;

  const load = async (link: ThreadPullRequestLink, reference: PullRequestRef) => {
    const token = { link, reference };
    try {
      const [detail, activity] = await Promise.all([
        session.pullRequestDetail(reference),
        session.pullRequestActivity(reference),
      ]);
      let merged = detail;
      if (capabilities?.pullRequestChecks === true) {
        const checks = await session.pullRequestChecks(reference).catch(() => null);
        merged = resolvePullRequestDetailChecks(detail, checks, true) ?? detail;
      }
      const guide = guidesEnabled ? await session.pullRequestReviewGuide(reference).catch(() => null) : null;
      if (loadedRef.current?.link !== token.link) return;
      setLoaded({ link, reference, status: "ready", detail: merged, activity, guide });
    } catch (error) {
      if (loadedRef.current?.link !== token.link) return;
      setLoaded({ link, reference, status: "error", detail: null, activity: null, guide: null, error: messageOf(error) });
    }
  };

  const openLink = (link: ThreadPullRequestLink) => {
    if (!threadShell) return;
    const reference = referenceForLink(link, threadShell.projectId);
    setLoaded({ link, reference, status: "loading", detail: null, activity: null, guide: null });
    deps.showView();
    void load(link, reference);
  };

  const open = () => {
    if (!threadShell) return deps.say("Open a thread first.", true);
    if (links.length === 0) return deps.say("This thread has no linked pull requests. Link one from the palette.", true);
    if (links.length === 1) return openLink(links[0]!);
    deps.openPicker({
      placeholder: "Linked pull requests",
      groups: [
        {
          label: "Pull requests",
          items: links.map((link) => ({
            id: `pr:${link.host}/${link.repository}#${link.number}`,
            title: `#${link.number} ${link.snapshot?.title ?? link.repository}`,
            ...(link.snapshot ? { hint: link.snapshot.state } : {}),
            run: () => openLink(link),
          })),
        },
      ],
    });
  };

  const close = () => {
    setLoaded(null);
    deps.hideView();
  };

  const refresh = () => {
    const current = loadedRef.current;
    if (!current) return;
    deps.say("Refreshing…");
    void (async () => {
      await session.invalidatePullRequest(current.reference).catch(() => {});
      await load(current.link, current.reference);
      deps.say("Refreshed");
    })();
  };

  const openPullRequest = () => {
    const url = loadedRef.current?.detail?.url ?? loadedRef.current?.link.url;
    if (!url) return;
    // Over SSH or without a desktop there may be no browser to open: copy the link instead.
    const fallBack = (reason: string) => {
      void deps.clipboard.copy(url);
      deps.say(`Could not open the browser (${reason}); link copied: ${url}`, true);
    };
    openInBrowser(url, fallBack);
  };

  const reloadQuietly = () => {
    const current = loadedRef.current;
    if (current) void load(current.link, current.reference);
  };

  const comment = async () => {
    const current = loadedRef.current;
    const canComment = current?.detail?.capabilities.comment && current.detail.viewerPermissions.comment;
    if (!current?.detail || !canComment) {
      return deps.say("Commenting is not available on this pull request.", true);
    }
    const edited = await editInEditor(deps.renderer, "");
    if (edited === null) return deps.say("The editor exited with an error; nothing was posted.", true);
    const body = edited.trim();
    if (!body) return deps.say("Nothing to post.", true);
    const number = current.detail.number;
    deps.confirm({
      title: `Comment on #${number}?`,
      detail: firstLine(body),
      confirmLabel: "comment",
      run: () =>
        deps.run("Comment posted", async () => {
          await session.commentOnPullRequest(current.reference, body);
          reloadQuietly();
        }),
    });
  };

  const review = () => {
    const current = loadedRef.current;
    const detail = current?.detail;
    if (!current || !detail) return;
    const offered = VERDICTS.filter((verdict) => {
      const hostOffers = detail.capabilities.review.verdicts.includes(verdict.value);
      const viewerMay = detail.viewerPermissions.verdicts.includes(verdict.value);
      return hostOffers && viewerMay;
    });
    if (offered.length === 0) return deps.say("Reviewing is not available on this pull request.", true);

    const writeReview = async (verdict: (typeof VERDICTS)[number]) => {
      const edited = await editInEditor(deps.renderer, "");
      if (edited === null) return deps.say("The editor exited with an error; the review was not submitted.", true);
      const body = edited;
      const summaryRequired = sourceControlClients.get(detail.provider).reviewSummaryRequired("request-changes");
      // Requesting changes can demand a summary; approving never does.
      const needsSummary = verdict.value === "request-changes" && summaryRequired;
      const canSubmit = needsSummary ? body.trim().length > 0 : verdict.value === "approve" || body.trim().length > 0;
      if (!canSubmit) {
        const message = needsSummary
          ? "Summarize your review (required to request changes)."
          : "Summarize your review or approve without one.";
        return deps.say(message, true);
      }
      deps.confirm({
        title: `${verdict.label} #${detail.number}?`,
        ...(body.trim() ? { detail: firstLine(body) } : {}),
        confirmLabel: "submit review",
        run: () =>
          deps.run(verdict.sent, async () => {
            await session.submitPullRequestReview(current.reference, verdict.value, body);
            reloadQuietly();
          }),
      });
    };

    deps.openPicker({
      placeholder: "Review verdict",
      groups: [
        {
          label: "Verdict",
          items: offered.map((verdict) => ({
            id: `verdict:${verdict.value}`,
            title: verdict.label,
            run: () => writeReview(verdict),
          })),
        },
      ],
    });
  };

  const actions = () => {
    const current = loadedRef.current;
    const detail = current?.detail;
    if (!current || !detail) return;
    const host = offeredActions(detail).map(({ action, label }) => ({
      id: `pr-action:${action}`,
      title: label,
      run: () => {
        const finish = (mergeMethod?: PullRequestMergeMethod) =>
          deps.confirm({
            title: `${label} #${detail.number}?`,
            detail: detail.title,
            confirmLabel: label.toLowerCase(),
            run: () =>
              deps.run(label === "Merge" ? "Merge requested" : label, async () => {
                await session.runPullRequestAction(current.reference, action, mergeMethod);
                await session.invalidatePullRequest(current.reference).catch(() => {});
                reloadQuietly();
              }),
          });
        if (action !== "merge") return finish();
        const methods = offeredMergeMethods(detail);
        if (methods.length <= 1) return finish(methods[0]);
        const preferred = serverConfig ? preferredMergeMethod(serverConfig, detail.projectId) : undefined;
        deps.openPicker({
          placeholder: "Merge method",
          groups: [
            {
              label: "Merge method",
              items: methods.map((method) => ({
                id: `merge:${method}`,
                title: MERGE_METHOD_LABELS[method],
                ...(method === preferred ? { hint: "default" } : {}),
                run: () => finish(method),
              })),
            },
          ],
        });
      },
    }));
    const guideItems =
      guidesEnabled && current.guide?.run?._tag !== "Running"
        ? [
            {
              id: "pr-guide",
              title: current.guide?.guide ? "Rewrite review guide" : "Write review guide",
              run: () =>
                deps.run("Review guide started", async () => {
                  const guide = await session.generatePullRequestReviewGuide(current.reference);
                  setLoaded((value) => (value?.link === current.link ? { ...value, guide } : value));
                }),
            },
          ]
        : [];
    if (host.length === 0 && guideItems.length === 0) return deps.say("No actions are available on this pull request.", true);
    deps.openPicker({
      placeholder: `#${detail.number} actions`,
      groups: [
        ...(host.length > 0 ? [{ label: "Pull request", items: host }] : []),
        ...(guideItems.length > 0 ? [{ label: "Review guide", items: guideItems }] : []),
      ],
    });
  };

  const unlink = (link: ThreadPullRequestLink) => {
    if (!threadShell) return;
    const id = threadShell.id;
    deps.confirm({
      title: `${link.source === "stack" ? "Dismiss" : "Unlink"} #${link.number} from this thread?`,
      ...(link.snapshot?.title ? { detail: link.snapshot.title } : {}),
      confirmLabel: link.source === "stack" ? "dismiss" : "unlink",
      run: () =>
        deps.run("Unlinked", async () => {
          await session.unlinkPullRequest(id, linkKey(link));
          if (loadedRef.current?.link === link) close();
        }),
    });
  };

  const setWatching = (link: ThreadPullRequestLink, watching: boolean) => {
    if (!threadShell) return;
    const label = watching ? "Watching for changes" : "Stopped watching";
    deps.run(label, () => session.watchPullRequest(threadShell.id, linkKey(link), watching));
  };

  const linkDialog = () => {
    if (!threadShell) return deps.say("Open a thread first.", true);
    if (linkMode === "unsupported") return deps.say("Server details are still loading.", true);
    const id = threadShell.id;
    deps.confirm({
      title: "Link pull request",
      detail: "Attach a pull request to this thread by its URL, or by its number for this thread's repository.",
      message: { placeholder: "Pull request URL or #42" },
      confirmLabel: "link",
      run: (text) => {
        if (!text.trim()) return deps.say("Paste a pull request URL or enter 123 / #123.", true);
        const resolved = resolveLinkInput({ reference: text, project, projects: deps.projects });
        if (resolved === null) return deps.say("Use a pull request URL, 123, or #123.", true);
        if ("error" in resolved) return deps.say(resolved.error, true);
        const mutation = planThreadPullRequestMutation({
          capabilities,
          threadId: id,
          reference: resolved.link,
          linked: true,
        });
        if (mutation === null || mutation.type !== "thread.pull-request.link") {
          return deps.say("This environment does not support linking this pull request.", true);
        }
        const { threadId: _threadId, source: _source, url, ...key } = mutation.input;
        deps.run(`Linked #${key.number}`, () => session.linkPullRequest(id, key, url));
      },
    });
  };

  const newThreadFromPullRequest = () => {
    const target = project ?? deps.projects[0];
    if (!target) return deps.say("No projects on this server yet; add one in T3 Code.", true);
    const cwd = target.workspaceRoot;
    deps.confirm({
      title: "New thread from pull request",
      detail: `Resolve a pull request, then create the draft thread in ${target.title} or in a dedicated worktree.`,
      message: { placeholder: "Pull request URL, checkout command, or #42" },
      confirmLabel: "resolve",
      run: (text) => {
        if (!text.trim()) return deps.say("Paste a pull request URL, checkout command, or enter 123 / #123.", true);
        const parsed = parsePullRequestReference(text);
        if (parsed === null) return deps.say("Use a pull request URL, checkout command, 123, or #123.", true);
        deps.say("Resolving…");
        session.resolvePullRequest(cwd, parsed).then(
          ({ pullRequest }) => {
            const prepare = (mode: "local" | "worktree") => {
              deps.say(mode === "worktree" ? "Preparing worktree…" : "Preparing local…");
              session.preparePullRequestThread(cwd, parsed, mode).then(
                (prepared) => {
                  deps.startDraftFromPullRequest(target, prepared);
                  deps.say(prepared.isOnPullRequestHead ? `Draft on ${prepared.branch}` : `Draft on ${prepared.branch} (not on the pull request head)`);
                },
                (error) => deps.say(`Could not prepare the pull request thread: ${messageOf(error)}`, true),
              );
            };
            deps.openPicker({
              placeholder: `#${pullRequest.number} ${pullRequest.title} · ${pullRequest.headBranch} to ${pullRequest.baseBranch} · ${pullRequest.state}`,
              groups: [
                {
                  label: "Runs in",
                  items: [
                    { id: "pr-thread:worktree", title: "Worktree", hint: "a dedicated worktree", run: () => prepare("worktree") },
                    { id: "pr-thread:local", title: "Local", hint: "the project folder", run: () => prepare("local") },
                  ],
                },
              ],
            });
          },
          (error) => deps.say(messageOf(error), true),
        );
      },
    });
  };

  const watchingCurrent = loaded
    ? links.some((link) => isSameLink(link, loaded.link) && link.watch !== undefined)
    : false;

  const view: PullRequestViewState | null = loaded
    ? {
        status: loaded.status,
        lines: loaded.detail ? pullRequestLines(loaded.detail, loaded.activity, loaded.guide) : [],
        watching: watchingCurrent,
        ...(loaded.error ? { error: loaded.error } : {}),
      }
    : null;

  /** Keys inside the PR view, for the PR it shows. */
  const current = loaded;
  const viewKeys: Binding[] = current
    ? keys(
        { keys: ["o"], run: openPullRequest, hint: "open" },
        { keys: ["r"], run: refresh, hint: "refresh" },
        current.detail && [
          { keys: ["c"], run: comment, hint: "comment" },
          { keys: ["R"], run: review, hint: "review" },
          { keys: ["a"], run: actions, hint: "actions" },
        ],
        supportsWatch && (current.link.snapshot === null || current.link.snapshot.state === "open") && { keys: ["w"], run: () => setWatching(current.link, !watchingCurrent), hint: watchingCurrent ? "unwatch" : "watch" },
        { keys: ["u"], run: () => unlink(current.link), hint: current.link.source === "stack" ? "dismiss" : "unlink" },
        { keys: ["esc", "q"], run: close, hint: "close" },
      )
    : [];

  const commands: (PaletteCommand & { run: () => void })[] = [];
  if (threadShell && links.length > 0) {
    commands.push({ id: "pull-requests", title: "Show linked pull requests", shortcut: "P", keywords: ["pull requests", "linked", "stack", "prs"], run: open });
  }
  if (threadShell && linkMode !== "unsupported") {
    commands.push({ id: "link-pull-request", title: "Link pull request to thread", keywords: ["link", "pull request", "pr", "attach", "stack"], run: linkDialog });
  }
  if (threadShell) {
    for (const link of links) {
      const verb = link.source === "stack" ? "Dismiss" : "Unlink";
      commands.push({
        id: `unlink-pull-request:${link.number}`,
        title: `${verb} pull request #${link.number} from thread`,
        keywords: ["unlink", "pull request", "pr"],
        run: () => unlink(link),
      });
      if (supportsWatch && (link.snapshot === null || link.snapshot.state === "open")) {
        const watching = link.watch !== undefined;
        commands.push({
          id: `watch-pull-request:${link.number}`,
          title: watching ? `Stop watching pull request #${link.number}` : `Watch pull request #${link.number} for changes`,
          keywords: ["watch", "pull request", "pr"],
          run: () => setWatching(link, !watching),
        });
      }
    }
  }
  commands.push({ id: "new-thread-from-pull-request", title: "New thread from pull request…", keywords: ["checkout", "pull request", "pr", "worktree"], run: newThreadFromPullRequest });
  if (loaded?.detail) {
    const number = loaded.detail.number;
    commands.push({ id: "pr-comment", title: `Comment on pull request #${number}`, shortcut: "c", keywords: ["comment", "pull request"], run: comment });
    commands.push({ id: "pr-review", title: `Review pull request #${number}…`, shortcut: "R", keywords: ["review", "approve", "request changes"], run: review });
    commands.push({ id: "pr-actions", title: `Pull request #${number} actions…`, shortcut: "a", keywords: ["merge", "close", "ready", "draft"], run: actions });
    commands.push({ id: "pr-open", title: `Open pull request #${number} in browser`, shortcut: "o", keywords: ["open", "browser"], run: openPullRequest });
    commands.push({ id: "pr-refresh", title: "Refresh pull request", shortcut: "r", keywords: ["refresh", "reload"], run: refresh });
  }

  return { view, isOpen: loaded !== null, open, close, commands, viewKeys };
}

/** Two links name the same pull request when host, repository and number all match. */
function isSameLink(left: ThreadPullRequestLink, right: ThreadPullRequestLink): boolean {
  return left.host === right.host && left.repository === right.repository && left.number === right.number;
}

/** The project's configured merge method, as the web pre-selects it. */
function preferredMergeMethod(config: ServerConfig, projectId: ProjectId) {
  return resolveProjectSettings(config.settings, projectId).settings.pullRequestMergeMethod ?? undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The composer's `#` search, debounced as the web's (180ms): the recent list (host-searched for
 * words), plus the exact pull request a typed number names when the list lacks it.
 */
export function useComposerPullRequests(input: {
  readonly session: T3Session;
  readonly query: string | null;
  readonly projectId: ProjectId | null;
  readonly repository: string | null;
  readonly links: readonly ThreadPullRequestLink[] | undefined;
}): { items: ComposerItem[]; empty: string; loading: boolean } {
  const { session, query, projectId, repository } = input;
  const [result, setResult] = useState<{ key: string; items: ComposerItem[]; failed: boolean } | null>(null);
  const textQuery = query !== null && query.length > 0 && !/^\d+$/u.test(query) ? query : null;
  const key = query !== null && projectId !== null && repository !== null ? `${projectId}\u0000${repository}\u0000${query}` : null;
  const linksRef = useRef(input.links);
  linksRef.current = input.links;

  useEffect(() => {
    if (key === null || projectId === null || repository === null || query === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const list = await session.pullRequestsList({
            state: "all",
            projectId,
            limit: COMPOSER_PULL_REQUEST_LIST_LIMIT,
            ...(textQuery === null ? {} : { query: textQuery }),
          });
          const number = exactPullRequestNumber(query);
          const hasExact =
            number !== null &&
            list.entries.some((entry) => {
              const sameRepository = entry.repository.trim().toLowerCase() === repository.trim().toLowerCase();
              return entry.projectId === projectId && sameRepository && entry.number === number;
            });
          // A typed number names one pull request exactly, so look it up when the list lacks it.
          const exact =
            number !== null && !hasExact
              ? await session.pullRequestDetail({ projectId, repository, number }).catch(() => null)
              : null;
          const exactDetail = exact?.number === number ? exact : null;
          if (cancelled) return;
          const matches = rankComposerPullRequests({
            result: list,
            exact: exactDetail,
            links: linksRef.current,
            projectId,
            repository,
            query,
          });
          const failed = list.errors.some((error) => error.projectId === projectId);
          setResult({ key, items: pullRequestItems(matches, repository), failed });
        } catch {
          if (!cancelled) setResult({ key, items: [], failed: true });
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, key, projectId, repository, query, textQuery]);

  return useMemo(() => {
    if (query === null) return { items: [], empty: "", loading: false };
    if (projectId === null || repository === null) return { items: [], empty: "Pull requests are not available for this project.", loading: false };
    const fresh = result?.key === key;
    if (fresh && result.failed && result.items.length === 0) return { items: [], empty: "Pull requests could not be read for this project.", loading: false };
    return {
      items: fresh ? result.items : [],
      empty: fresh ? (query ? `No pull request matches ${query}.` : "No pull requests found in this repository.") : "Searching…",
      loading: !fresh,
    };
  }, [query, projectId, repository, result, key]);
}

