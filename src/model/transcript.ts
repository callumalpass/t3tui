import type { OrchestrationV2TurnItem, RuntimeRequestId } from "@t3tools/contracts";

/** A turn item as one line or card: the fallback for timeline event rows the web app renders specially. */
export type Block =
  | { readonly kind: "user"; readonly id: string; readonly text: string }
  | { readonly kind: "assistant"; readonly id: string; readonly markdown: string; readonly streaming: boolean }
  | { readonly kind: "reasoning"; readonly id: string; readonly text: string; readonly streaming: boolean }
  | { readonly kind: "tool"; readonly id: string; readonly icon: string; readonly label: string; readonly detail?: string; readonly tone: Tone }
  | { readonly kind: "approval"; readonly id: string; readonly requestId: RuntimeRequestId; readonly title: string; readonly detail?: string; readonly pending: boolean }
  | { readonly kind: "question"; readonly id: string; readonly requestId: RuntimeRequestId; readonly questions: readonly string[]; readonly pending: boolean }
  | { readonly kind: "notice"; readonly id: string; readonly text: string; readonly tone: Tone };

export type Tone = "normal" | "muted" | "good" | "bad" | "warn";

const OUTPUT_TAIL_LINES = 3;

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
