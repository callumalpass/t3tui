import type { ModelSelection, OrchestrationV2ThreadProjection, ProviderOptionDescriptor, OrchestrationV2ThreadShell, ServerConfig, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import type { T3Session } from "../client/session.ts";
import { RUNTIME_MODE_LABELS } from "../model/details.ts";
import type { Binding } from "../model/keymap.ts";
import { lockedProviderInstance, optionDescriptors, optionValue, optionValueLabel, providerName, RUNTIME_MODES, sameSelection, selectableProviders, withModel, withOption, type DraftThread } from "../model/models.ts";
import type { Picker, PickerItem } from "../model/palette.ts";

type RuntimeMode = (typeof RUNTIME_MODES)[number];

/**
 * Model, options and mode, for the draft or the open thread. As in the web composer, a thread's
 * model change waits for its next message; its mode changes straight away.
 */
export function useModelPicker(deps: {
  readonly session: T3Session;
  readonly config: ServerConfig | null;
  readonly draft: DraftThread | null;
  readonly updateDraft: (patch: Partial<DraftThread>) => void;
  readonly thread: OrchestrationV2ThreadShell | undefined;
  readonly projection: OrchestrationV2ThreadProjection | null | undefined;
  readonly openPicker: (picker: Picker) => void;
  readonly run: (label: string, action: () => Promise<unknown>) => void;
  readonly say: (text: string, bad?: boolean) => void;
}) {
  const { config, draft, thread } = deps;
  const [pending, setPending] = useState<ReadonlyMap<ThreadId, ModelSelection>>(new Map());
  const current: ModelSelection | null = draft ? draft.modelSelection : thread ? (pending.get(thread.id) ?? thread.modelSelection) : null;
  const runtimeMode = draft ? draft.runtimeMode : thread?.runtimeMode;

  const setPendingFor = (id: ThreadId, selection: ModelSelection | null) =>
    setPending((previous) => {
      const next = new Map(previous);
      if (selection) next.set(id, selection);
      else next.delete(id);
      return next;
    });

  const setModel = (selection: ModelSelection) => {
    if (draft) return deps.updateDraft({ modelSelection: selection });
    if (!thread) return;
    setPendingFor(thread.id, sameSelection(config, selection, thread.modelSelection) ? null : selection);
  };

  const setRuntime = (next: RuntimeMode) => {
    if (draft) return deps.updateDraft({ runtimeMode: next });
    if (thread) deps.run(`Mode: ${RUNTIME_MODE_LABELS[next] ?? next}`, () => deps.session.setRuntimeMode(thread.id, next));
  };

  /** A choice of option values, in a picker of its own. */
  const openChoices = (selection: ModelSelection, descriptor: Exclude<ProviderOptionDescriptor, { type: "boolean" }>) =>
    deps.openPicker({
      placeholder: descriptor.label,
      groups: [
        {
          label: descriptor.label,
          items: descriptor.options.map((choice) => ({
            id: `choice:${choice.id}`,
            title: choice.label,
            ...(choice.id === optionValue(selection, descriptor) ? { hint: "current" } : choice.description ? { hint: choice.description } : {}),
            run: () => setModel(withOption(selection, descriptor.id, choice.id)),
          })),
        },
      ],
    });

  /** Mode, then options, then each provider's models. */
  const open = () => {
    const selection = current;
    if (!selection) return;
    if (!config) return deps.say("Still loading the server's providers.", true);
    // A started thread stays on its provider unless the provider supports handing over.
    const locked = draft ? null : lockedProviderInstance(deps.projection);
    const groups: { label: string; items: PickerItem[] }[] = [];
    if (runtimeMode) {
      groups.push({
        label: "Mode",
        items: RUNTIME_MODES.map((candidate) => ({
          id: `mode:${candidate}`,
          title: RUNTIME_MODE_LABELS[candidate] ?? candidate,
          ...(candidate === runtimeMode ? { hint: "current" } : {}),
          run: () => setRuntime(candidate),
        })),
      });
    }
    const options: PickerItem[] = optionDescriptors(config, selection).map((descriptor) => ({
      id: `option:${descriptor.id}`,
      title: `${descriptor.label}: ${optionValueLabel(descriptor, optionValue(selection, descriptor))}`,
      run: () => (descriptor.type === "boolean" ? setModel(withOption(selection, descriptor.id, optionValue(selection, descriptor) !== true)) : openChoices(selection, descriptor)),
    }));
    if (options.length > 0) groups.push({ label: "Options", items: options });
    for (const provider of selectableProviders(config)) {
      if (locked && provider.instanceId !== locked) continue;
      groups.push({
        label: providerName(provider),
        items: provider.models
          .filter((model) => !model.isLegacy || model.slug === selection.model)
          .map((model) => ({
            id: `model:${provider.instanceId}:${model.slug}`,
            title: model.name,
            ...(provider.instanceId === selection.instanceId && model.slug === selection.model ? { hint: "current" } : {}),
            run: () => setModel(withModel(config, selection, provider.instanceId, model.slug)),
          })),
      });
    }
    deps.openPicker({ placeholder: locked ? "Model, options and mode (this thread stays on its provider)" : "Model, options and mode", groups });
  };

  /** The model change waiting for a thread's next message, taken as that message goes. */
  const take = (id: ThreadId): ModelSelection | undefined => {
    const selection = pending.get(id);
    if (selection) setPendingFor(id, null);
    return selection;
  };

  const key: Binding | null = current
    ? { keys: ["m"], run: open, hint: "model", command: { id: "model", title: "Change model, options or mode", keywords: ["provider", "thinking", "reasoning", "effort", "speed", "fast", "access", "approval"] } }
    : null;

  return { current, runtimeMode, pendingFor: (id: ThreadId | undefined) => (id ? pending.get(id) : undefined), take, open, key };
}
