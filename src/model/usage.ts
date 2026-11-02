import type { ProviderConsumeResetCreditInput, ProviderInstanceId, ServerConfig, ServerProviderResetCredits, UsageSummary } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitNotices, collectProviderUsageLimits, formatDuration, limitsNotice, remainingPercent, type LimitPresentations } from "@t3tools/shared/usageLimits";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";

/** At or above this much of a window used, the status line calls the limit near. */
export const NEAR_LIMIT_USED_PERCENT = 90;

export interface UsageLimitInfo {
  /** One line per account and window, for the settings view. */
  readonly lines: readonly { label: string; value: string }[];
  /** The worst near-or-reached window, for the status line; null when every window has room. */
  readonly note: string | null;
  /** Accounts with a banked reset credit the palette can spend. */
  readonly credits: readonly { label: string; input: ProviderConsumeResetCreditInput; credits: ServerProviderResetCredits }[];
}

/** Provider limits from the server config, collected the way the web's usage page collects them. */
export function usageLimits(config: ServerConfig | null, now = Date.now()): UsageLimitInfo {
  if (!config) return { lines: [], note: null, credits: [] };
  const presentations: LimitPresentations = new Map([
    [config.environment.environmentId, { entry: { target: { label: config.environment.label } }, serverConfig: config }],
  ]);
  const lines: { label: string; value: string }[] = [];
  const credits: UsageLimitInfo["credits"][number][] = [];
  let note: { used: number; text: string } | null = null;
  for (const account of collectLimitAccounts(presentations)) {
    const label = account.displayName ?? account.email ?? account.driver;
    const heading = [label, account.plan, account.sourceLabel].filter(Boolean).join(" · ");
    for (const window of account.limits.windows) {
      const left = remainingPercent(window);
      const resets = window.resetsAt && Date.parse(window.resetsAt) > now ? ` · resets in ${formatDuration(Date.parse(window.resetsAt) - now)}` : "";
      lines.push({ label: `${heading} ${window.label}`, value: `${left}% left${resets}` });
      if (window.usedPercent >= NEAR_LIMIT_USED_PERCENT && (!note || window.usedPercent > note.used)) {
        note = { used: window.usedPercent, text: `${label} ${window.label}: ${left === 0 ? "limit reached" : `${left}% left`}${resets}` };
      }
    }
    const banked = account.limits.resetCredits;
    if (banked && banked.availableCount > 0) {
      lines.push({ label: `${heading} reset credits`, value: resetCreditsSummary(banked, now) });
      if (account.redeem) credits.push({ label: heading, input: account.redeem.input, credits: banked });
    }
  }
  for (const notice of collectLimitNotices(presentations)) lines.push({ label: "Limits", value: notice });
  return { lines, note: note?.text ?? null, credits };
}

export interface LimitWindowLine {
  readonly label: string;
  /** Percent of the window left. */
  readonly left: number;
  /** Near or at the limit, as the status line reads it. */
  readonly tone: "muted" | "warn" | "bad";
}

/**
 * One provider instance's limit windows, picked as the web's thread details pick them; null
 * when the provider reports none, or reports them unavailable.
 */
export function providerLimits(config: ServerConfig | null, instanceId: ProviderInstanceId, now = Date.now()): readonly LimitWindowLine[] | null {
  if (!config) return null;
  const report = collectProviderUsageLimits(instanceId, config.providers, config.usageLimitSources ?? [], now);
  const limits = report?.accounts.find((entry) => entry.instanceId === instanceId)?.limits ?? config.providers.find((provider) => provider.instanceId === instanceId)?.usageLimits;
  if (!limits || limitsNotice(limits) || limits.windows.length === 0) return null;
  return limits.windows.map((window) => {
    const left = remainingPercent(window);
    return { label: window.label, left, tone: left === 0 ? "bad" : window.usedPercent >= NEAR_LIMIT_USED_PERCENT ? "warn" : "muted" };
  });
}

/** The web's banked-credits wording: a count and when the next one expires. */
export function resetCreditsSummary(credits: ServerProviderResetCredits, now = Date.now()): string {
  if (credits.availableCount === 0) return "No reset credits banked";
  const expires = credits.nextExpiresAt ? ` · next expires in ${formatDuration(Date.parse(credits.nextExpiresAt) - now)}` : "";
  return `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked${expires}`;
}

const RESET_CREDIT_OUTCOMES: Record<string, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

/** What spending a reset credit says afterwards, as the web reports it. */
export function resetCreditOutcome(result: { readonly outcome: string; readonly warning?: string | undefined }): string {
  return result.warning ?? RESET_CREDIT_OUTCOMES[result.outcome] ?? result.outcome;
}

/** The usage summary's totals for the settings view: cost and tokens, then the priciest providers. */
export function usageSummaryLines(summary: UsageSummary | null): { label: string; value: string }[] {
  if (!summary) return [];
  const byProvider = new Map<string, { cost: number; tokens: number }>();
  let cost = 0;
  let tokens = 0;
  for (const bucket of summary.buckets) {
    const total = bucket.totals.uncachedInputTokens + bucket.totals.cachedInputTokens + bucket.totals.cacheCreationTokens + bucket.totals.outputTokens;
    cost += bucket.costUsd;
    tokens += total;
    const entry = byProvider.get(bucket.provider) ?? { cost: 0, tokens: 0 };
    entry.cost += bucket.costUsd;
    entry.tokens += total;
    byProvider.set(bucket.provider, entry);
  }
  const sessions = summary.sources.reduce((sum, source) => sum + source.distinctSessions, 0);
  const lines = [{ label: "Last 30 days", value: `${formatUsd(cost)} · ${formatTokens(tokens)} tokens · ${sessions} sessions` }];
  for (const [provider, entry] of [...byProvider].sort((a, b) => b[1].cost - a[1].cost)) {
    lines.push({ label: provider, value: `${formatUsd(entry.cost)} · ${formatTokens(entry.tokens)} tokens` });
  }
  return lines;
}
