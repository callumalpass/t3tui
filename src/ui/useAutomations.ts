import type { CliRenderer } from "@opentui/core";
import type { OrchestrationProjectShell, ScheduledTask } from "@t3tools/contracts";

import type { T3Session } from "../client/session.ts";
import { automationTemplate, newAutomationTemplate, parseAutomation, type AutomationDefaults } from "../model/automations.ts";
import type { Confirmation } from "./ConfirmBar.tsx";
import { editInEditor } from "./editor.ts";

export interface Automations {
  readonly newAutomation: () => void;
  readonly editAutomation: (task: ScheduledTask) => void;
  readonly deleteAutomation: (task: ScheduledTask) => void;
}

/** Creates, edits (in $EDITOR) and deletes automations, as the web's scheduled-task form does. */
export function useAutomations(deps: {
  readonly session: T3Session;
  readonly renderer: CliRenderer;
  readonly projects: readonly OrchestrationProjectShell[];
  /** Form defaults for a new task, from the open thread; null when there's nothing to base one on. */
  readonly defaults: AutomationDefaults | null;
  readonly confirm: (confirmation: Confirmation) => void;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  readonly say: (text: string, bad?: boolean) => void;
}): Automations {
  const { session, renderer, projects, defaults, confirm, run, say } = deps;

  const edit = (template: string, existing?: ScheduledTask) => {
    const edited = editInEditor(renderer, template);
    if (edited === null) return say("The editor exited with an error; the automation is unchanged.", true);
    const parsed = parseAutomation(edited, projects, existing);
    if (!parsed.ok) return say(parsed.error, true);
    run(existing ? "Automation saved" : "Automation created", () => session.upsertAutomation(parsed.input));
  };

  return {
    newAutomation: () => {
      if (!defaults) return say("Open a thread first, so the automation has a project and model.", true);
      edit(newAutomationTemplate(projects, defaults));
    },
    editAutomation: (task) => edit(automationTemplate(task, projects), task),
    deleteAutomation: (task) =>
      confirm({
        title: `Delete automation "${task.title}"?`,
        detail: "It stops running and is gone for good.",
        confirmLabel: "delete",
        run: () => run("Automation deleted", () => session.deleteAutomation(task.id)),
      }),
  };
}
