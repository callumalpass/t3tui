import {
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type RuntimeMode,
  type ScheduledTask,
  type ScheduledTaskUpsertInput,
  type ScheduledTaskUpsertSchedule,
} from "@t3tools/contracts";

const RUNTIME_MODES: readonly RuntimeMode[] = ["approval-required", "auto-accept-edits", "auto", "full-access"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_BY_NAME = new Map<string, number>(WEEKDAY_NAMES.map((name, index) => [name.toLowerCase(), index]));

export interface AutomationDefaults {
  readonly projectId: string;
  readonly threadId: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
}

/**
 * The $EDITOR template for a new automation: the web form's fields and defaults
 * (weekdays at 09:00, a new worktree off main from origin), one per line.
 */
export function newAutomationTemplate(projects: readonly OrchestrationProjectShell[], defaults: AutomationDefaults): string {
  const project = projects.find((candidate) => candidate.id === defaults.projectId) ?? projects[0];
  return template({
    title: "",
    enabled: true,
    schedule: "fixed 09:00 Mon,Tue,Wed,Thu,Fri",
    project: project?.title ?? "",
    thread: defaults.threadId,
    workspace: "worktree",
    baseRef: "main",
    startFromOrigin: true,
    checkoutPath: "",
    model: `${defaults.modelSelection.instanceId}:${defaults.modelSelection.model}`,
    mode: defaults.runtimeMode,
    prompt: "",
  });
}

/** The $EDITOR template for an existing automation, its fields filled in. */
export function automationTemplate(task: ScheduledTask, projects: readonly OrchestrationProjectShell[]): string {
  const project = projects.find((candidate) => candidate.id === task.projectId);
  return template({
    title: task.title,
    enabled: task.enabled,
    schedule: scheduleText(task),
    project: project?.title ?? task.projectId,
    thread: task.threadId ?? "",
    workspace: task.workspaceStrategy.type,
    baseRef: task.workspaceStrategy.type === "worktree" ? task.workspaceStrategy.baseRef : "main",
    startFromOrigin: task.workspaceStrategy.type === "worktree" ? (task.workspaceStrategy.startFromOrigin ?? false) : true,
    checkoutPath: task.workspaceStrategy.type === "existing_worktree" ? task.workspaceStrategy.worktreePath : "",
    model: `${task.modelSelection.instanceId}:${task.modelSelection.model}`,
    mode: task.runtimeMode,
    prompt: task.prompt,
  });
}

interface TemplateFields {
  readonly title: string;
  readonly enabled: boolean;
  readonly schedule: string;
  readonly project: string;
  readonly thread: string;
  readonly workspace: string;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly checkoutPath: string;
  readonly model: string;
  readonly mode: string;
  readonly prompt: string;
}

function template(fields: TemplateFields): string {
  return [
    "# Automation. Lines starting with # are ignored. Save and quit to save the automation.",
    "# Schedule: `fixed HH:MM Mon,Tue,...` (days optional), `interval 15m` / `interval 2h`, or `webhook`.",
    "# Webhook signatures and filters are kept as they are; change those in T3 Code.",
    "# Workspace: `worktree` (a new one off Base ref), `root` (the project folder), or `existing_worktree` (Checkout path).",
    "# Thread: the thread each run continues in; blank starts a fresh thread each run.",
    `Title: ${fields.title}`,
    `Enabled: ${fields.enabled ? "true" : "false"}`,
    `Schedule: ${fields.schedule}`,
    `Project: ${fields.project}`,
    `Thread: ${fields.thread}`,
    `Workspace: ${fields.workspace}`,
    `Base ref: ${fields.baseRef}`,
    `Start from origin: ${fields.startFromOrigin ? "true" : "false"}`,
    `Checkout path: ${fields.checkoutPath}`,
    `Model: ${fields.model}`,
    `Mode: ${fields.mode}`,
    "Prompt:",
    fields.prompt,
    "",
  ].join("\n");
}

function scheduleText(task: ScheduledTask): string {
  const schedule = task.schedule;
  switch (schedule.type) {
    case "interval": {
      const minutes = schedule.everyMs / 60_000;
      return Number.isInteger(minutes) && minutes % 60 === 0 ? `interval ${minutes / 60}h` : `interval ${Math.max(1, Math.round(minutes))}m`;
    }
    case "fixed_time": {
      const days = schedule.weekdays && schedule.weekdays.length > 0 && schedule.weekdays.length < 7 ? ` ${schedule.weekdays.map((day) => WEEKDAY_NAMES[day]).join(",")}` : "";
      return `fixed ${schedule.timeOfDay}${days}`;
    }
    case "webhook":
      return "webhook";
  }
}

export type AutomationParse = { readonly ok: true; readonly input: ScheduledTaskUpsertInput } | { readonly ok: false; readonly error: string };

/**
 * Parses an edited template back into an upsert, with the web form's checks:
 * a title, a prompt, a project and a model, an interval of at least a minute,
 * and a checkout path for an existing worktree. Editing a webhook task keeps
 * its signature, dedupe and filters, as the template says.
 */
export function parseAutomation(text: string, projects: readonly OrchestrationProjectShell[], existing?: ScheduledTask): AutomationParse {
  const fields = new Map<string, string>();
  const promptLines: string[] = [];
  let inPrompt = false;
  for (const line of text.split("\n")) {
    if (inPrompt) {
      promptLines.push(line);
      continue;
    }
    if (line.startsWith("#")) continue;
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.trim().toLowerCase();
    if (key === "prompt") {
      inPrompt = true;
      if (match[2]) promptLines.push(match[2]);
      continue;
    }
    fields.set(key, match[2]!.trim());
  }
  const get = (key: string) => fields.get(key) ?? "";
  const title = get("title");
  const prompt = promptLines.join("\n").trim();
  const projectText = get("project");
  const project = projects.find((candidate) => candidate.title === projectText) ?? projects.find((candidate) => candidate.id === projectText);
  const model = parseModel(get("model"), existing?.modelSelection);
  if (!title || !prompt || !project || !model) return { ok: false, error: "Scheduled task is incomplete: add a title, prompt, project, and model." };

  const schedule = parseSchedule(get("schedule"), existing);
  if (!schedule.ok) return schedule;

  const workspace = get("workspace") || "worktree";
  const checkoutPath = get("checkout path");
  if (workspace === "existing_worktree" && !checkoutPath) return { ok: false, error: "Checkout path is required: enter the path of the checkout to run in." };
  if (workspace !== "root" && workspace !== "worktree" && workspace !== "existing_worktree") return { ok: false, error: `Workspace must be worktree, root, or existing_worktree, not "${workspace}".` };

  const mode = get("mode");
  if (!(RUNTIME_MODES as readonly string[]).includes(mode)) return { ok: false, error: `Mode must be one of ${RUNTIME_MODES.join(", ")}, not "${mode}".` };

  const threadId = get("thread");
  return {
    ok: true,
    input: {
      ...(existing ? { id: existing.id, requireExisting: true } : {}),
      title,
      prompt,
      enabled: get("enabled").toLowerCase() !== "false",
      schedule: schedule.schedule,
      projectId: ProjectId.make(project.id),
      threadId: threadId ? ThreadId.make(threadId) : null,
      workspaceStrategy:
        workspace === "root"
          ? { type: "root" }
          : workspace === "existing_worktree"
            ? { type: "existing_worktree", worktreePath: checkoutPath }
            : { type: "worktree", baseRef: get("base ref") || "main", startFromOrigin: get("start from origin").toLowerCase() !== "false" },
      modelSelection: model,
      runtimeMode: mode as RuntimeMode,
      interactionMode: existing?.interactionMode ?? "default",
      creationSource: "web",
    },
  };
}

function parseModel(text: string, base?: ModelSelection): ModelSelection | null {
  const colon = text.indexOf(":");
  if (colon <= 0 || colon === text.length - 1) return null;
  const instanceId = text.slice(0, colon).trim();
  const model = text.slice(colon + 1).trim();
  if (!instanceId || !model) return null;
  // An unchanged model keeps its provider options, as the web form keeps them.
  if (base && base.instanceId === instanceId && base.model === model) return base;
  return { instanceId: ProviderInstanceId.make(instanceId), model };
}

type ScheduleParse = { readonly ok: true; readonly schedule: ScheduledTaskUpsertSchedule } | { readonly ok: false; readonly error: string };

function parseSchedule(text: string, existing?: ScheduledTask): ScheduleParse {
  const [kind = "", ...rest] = text.trim().split(/\s+/);
  if (kind === "interval") {
    const match = /^(\d+)\s*(m|h)?$/.exec(rest.join(" "));
    const everyMs = match ? Number(match[1]) * (match[2] === "h" ? 3_600_000 : 60_000) : Number.NaN;
    if (!Number.isSafeInteger(everyMs) || everyMs < MIN_SCHEDULED_TASK_INTERVAL_MS) return { ok: false, error: "Invalid interval: enter an interval of at least one minute." };
    return { ok: true, schedule: { type: "interval", everyMs } };
  }
  if (kind === "fixed") {
    const timeOfDay = rest[0] ?? "";
    if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(timeOfDay)) return { ok: false, error: `Invalid schedule: "${text}" — use fixed HH:MM, interval 15m, or webhook.` };
    const days = rest.slice(1).join(" ").split(/[,\s]+/).filter(Boolean);
    const weekdays: number[] = [];
    for (const day of days) {
      const index = WEEKDAY_BY_NAME.get(day.toLowerCase());
      if (index === undefined) return { ok: false, error: `Unknown weekday "${day}": use ${WEEKDAY_NAMES.join(", ")}.` };
      weekdays.push(index);
    }
    const everyDay = weekdays.length === 0 || new Set(weekdays).size === 7;
    return { ok: true, schedule: { type: "fixed_time", timeOfDay, ...(everyDay ? {} : { weekdays: [...new Set(weekdays)].sort((a, b) => a - b) }) } };
  }
  if (kind === "webhook") {
    const current = existing?.schedule.type === "webhook" ? existing.schedule : null;
    if (!current) return { ok: true, schedule: { type: "webhook", signature: null, dedupe: {} } };
    // Filters stay stored when left out; a signature without a secret keeps the stored one.
    return {
      ok: true,
      schedule: {
        type: "webhook",
        signature: current.signature ? { header: current.signature.header, encoding: current.signature.encoding, prefix: current.signature.prefix } : null,
        ...(current.maxDeliveryAgeMinutes !== undefined ? { maxDeliveryAgeMinutes: current.maxDeliveryAgeMinutes } : {}),
        dedupe: current.dedupe ?? {},
      },
    };
  }
  return { ok: false, error: `Invalid schedule: "${text}" — use fixed HH:MM, interval 15m, or webhook.` };
}
