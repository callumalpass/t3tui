import type { OrchestrationV2ThreadProjection, OrchestrationV2TurnItem, RuntimeRequestId } from "@t3tools/contracts";

/** One rendered row of the transcript. Markdown blocks get the markdown renderer; the rest are plain lines. */
export type Block =
  | { readonly kind: "user"; readonly id: string; readonly text: string }
  | { readonly kind: "assistant"; readonly id: string; readonly markdown: string; readonly streaming: boolean }
  | { readonly kind: "reasoning"; readonly id: string; readonly text: string; readonly streaming: boolean }
  | { readonly kind: "tool"; readonly id: string; readonly icon: string; readonly label: string; readonly detail?: string; readonly tone: Tone }
  | { readonly kind: "approval"; readonly id: string; readonly requestId: RuntimeRequestId; readonly title: string; readonly detail?: string; readonly pending: boolean }
  | { readonly kind: "question"; readonly id: string; readonly requestId: RuntimeRequestId; readonly questions: readonly string[]; readonly pending: boolean }
  | { readonly kind: "notice"; readonly id: string; readonly text: string; readonly tone: Tone };

export type Tone = "normal" | "muted" | "good" | "bad" | "warn";

/** Tool calls, reasoning and minor notices: the agent's working, as opposed to what it says. */
export type Step = Extract<Block, { kind: "tool" | "reasoning" | "notice" }>;

/** What the conversation view renders: messages stand alone, runs of work fold into one segment. */
export type Segment =
  | Extract<Block, { kind: "user" | "assistant" | "approval" | "question" }>
  | { readonly kind: "work"; readonly id: string; readonly steps: readonly Step[]; readonly active: boolean }
  | { readonly kind: "alert"; readonly id: string; readonly text: string; readonly tone: Tone };

export interface Transcript {
  readonly segments: readonly Segment[];
  /** Turn items left out because only the tail is shown. */
  readonly hiddenCount: number;
}

const OUTPUT_TAIL_LINES = 3;

/** Blocks keyed by turn item object: the projection reducer keeps unchanged items identical. */
const blockCache = new WeakMap<object, Block | null>();

function cachedBlock(item: OrchestrationV2TurnItem, pending: ReadonlySet<string>): Block | null {
  // Approval and question blocks depend on request state, not just the item.
  if (item.type === "approval_request" || item.type === "user_input_request") return blockFor(item, pending);
  let block = blockCache.get(item);
  if (block === undefined) {
    block = blockFor(item, pending);
    blockCache.set(item, block);
  }
  return block;
}

export function buildTranscript(
  projection: OrchestrationV2ThreadProjection,
  options: { readonly tail?: number; readonly running?: boolean; readonly previous?: Transcript | null } = {},
): Transcript {
  const pending = new Set(projection.runtimeRequests.filter((request) => request.status === "pending").map((request) => request.id as string));
  const items = projection.visibleTurnItems;
  const tail = options.tail ?? 200;
  const start = Math.max(0, items.length - tail);
  const segments: Segment[] = [];
  let work: Step[] | null = null;
  const flushWork = () => {
    if (work && work.length > 0) segments.push({ kind: "work", id: `work-${work[0]!.id}`, steps: work, active: false });
    work = null;
  };
  for (let index = start; index < items.length; index++) {
    const block = cachedBlock(items[index]!.item, pending);
    if (!block) continue;
    if (block.kind === "tool" || block.kind === "reasoning" || (block.kind === "notice" && block.tone !== "bad" && block.tone !== "warn")) {
      (work ??= []).push(block);
      continue;
    }
    flushWork();
    segments.push(block.kind === "notice" ? { kind: "alert", id: block.id, text: block.text, tone: block.tone } : block);
  }
  flushWork();
  const last = segments.at(-1);
  if (options.running && last?.kind === "work") segments[segments.length - 1] = { ...last, active: true };
  return { segments: reuseUnchanged(segments, options.previous ?? null), hiddenCount: start };
}

/** Keeps the previous segment object when nothing in it changed, so memoized views skip it. */
function reuseUnchanged(segments: Segment[], previous: Transcript | null): Segment[] {
  if (!previous) return segments;
  const byId = new Map(previous.segments.map((segment) => [segment.id, segment]));
  return segments.map((segment) => {
    const old = byId.get(segment.id);
    return old && sameSegment(old, segment) ? old : segment;
  });
}

function sameSegment(a: Segment, b: Segment): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "work" && b.kind === "work") {
    return a.active === b.active && a.steps.length === b.steps.length && a.steps.every((step, index) => step === b.steps[index]);
  }
  return shallowEqual(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]) || (Array.isArray(a[key]) && Array.isArray(b[key]) && shallowEqualArray(a[key] as unknown[], b[key] as unknown[])));
}

function shallowEqualArray(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/** One line describing a folded run of work, e.g. "5 commands · 3 edits · 2 searches". */
export function summarizeWork(steps: readonly Step[]): string {
  const counts = new Map<string, number>();
  const bump = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const step of steps) {
    if (step.kind === "reasoning") continue;
    if (step.kind === "notice") bump("update");
    else bump(STEP_LABELS[step.icon] ?? "tool call");
  }
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([label, count]) => `${count} ${count === 1 ? label : `${label}s`}`);
  return parts.length > 0 ? parts.join(" · ") : "thinking";
}

const STEP_LABELS: Record<string, string> = { $: "command", "✎": "edit", "⌕": "search", "⚙": "tool call", "↳": "subagent", "☐": "plan update" };

export function blockFor(item: OrchestrationV2TurnItem, pending: ReadonlySet<string>): Block | null {
  const id = item.id;
  switch (item.type) {
    case "user_message":
      return item.text.trim() ? { kind: "user", id, text: item.text } : null;
    case "assistant_message":
      return item.text.trim() || item.streaming ? { kind: "assistant", id, markdown: item.text, streaming: item.streaming } : null;
    case "reasoning":
      return item.text.trim() ? { kind: "reasoning", id, text: item.text, streaming: item.streaming } : null;
    case "command_execution": {
      const failed = item.outputIndicatesFailure === true || (item.exitCode !== undefined && item.exitCode !== 0);
      const exit = item.exitCode === undefined ? "" : failed ? ` (exit ${item.exitCode})` : "";
      const output = item.output ? tailLines(item.output, OUTPUT_TAIL_LINES) : undefined;
      return { kind: "tool", id, icon: "$", label: firstLine(item.input) + exit, ...(output ? { detail: output } : {}), tone: failed ? "bad" : "normal" };
    }
    case "file_change": {
      const stats = item.additions !== undefined || item.deletions !== undefined ? ` +${item.additions ?? 0} −${item.deletions ?? 0}` : "";
      return { kind: "tool", id, icon: "✎", label: `${item.fileName}${stats}`, tone: "normal" };
    }
    case "file_search":
      return { kind: "tool", id, icon: "⌕", label: `search ${item.pattern ?? ""}`.trim() + countSuffix(item.results?.length), tone: "muted" };
    case "web_search":
      return { kind: "tool", id, icon: "⌕", label: `web ${(item.patterns ?? []).join(", ")}`.trim() + countSuffix(item.results?.length), tone: "muted" };
    case "dynamic_tool":
      return { kind: "tool", id, icon: "⚙", label: `${item.toolName ?? "tool"} ${summarizeInput(item.input)}`.trim(), tone: "muted" };
    case "subagent": {
      const state = item.result !== null ? "done" : item.progress ? item.progress : "running";
      return { kind: "tool", id, icon: "↳", label: `subagent: ${firstLine(item.prompt)}`, detail: firstLine(state), tone: "muted" };
    }
    case "todo_list":
      return {
        kind: "tool",
        id,
        icon: "☐",
        label: "plan",
        detail: item.steps.map((step) => `${step.status === "completed" ? "✓" : step.status === "running" ? "▸" : "·"} ${step.text}`).join("\n"),
        tone: "normal",
      };
    case "proposed_plan":
      return { kind: "assistant", id, markdown: item.markdown, streaming: item.streaming };
    case "approval_request":
      return {
        kind: "approval",
        id,
        requestId: item.requestId,
        title: `${item.appName ? `${item.appName}: ` : ""}${item.prompt ?? item.requestKind}`,
        ...(item.reason ? { detail: item.reason } : {}),
        pending: pending.has(item.requestId),
      };
    case "user_input_request":
      return { kind: "question", id, requestId: item.requestId, questions: item.questions.map((q) => q.question), pending: pending.has(item.requestId) };
    case "error":
      return { kind: "notice", id, text: `error: ${item.failure.message}`, tone: "bad" };
    case "system_notice":
      return { kind: "notice", id, text: item.message, tone: "muted" };
    case "run_interrupt_request":
    case "run_interrupt_result":
      return { kind: "notice", id, text: item.message, tone: "warn" };
    case "notification":
      return { kind: "notice", id, text: item.summary, tone: item.outcome === "failed" ? "bad" : item.outcome === "completed" ? "good" : "muted" };
    case "compaction":
      return { kind: "notice", id, text: "context compacted", tone: "muted" };
    case "handoff":
      return { kind: "notice", id, text: `handed off${item.toModel ? ` to ${item.toModel}` : ""}`, tone: "muted" };
    case "checkpoint":
    case "fork":
    case "thread_created":
      return null;
    default:
      return null;
  }
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function tailLines(text: string, count: number): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  const kept = lines.slice(-count).map((line) => (line.length > 200 ? `${line.slice(0, 197)}…` : line));
  return (lines.length > count ? ["…", ...kept] : kept).join("\n");
}

function countSuffix(count: number | undefined): string {
  return count === undefined ? "" : ` (${count})`;
}

function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return firstLine(input);
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["command", "file_path", "path", "pattern", "query", "url", "description", "prompt"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return firstLine(value);
    }
    return firstLine(JSON.stringify(input));
  }
  return String(input);
}
