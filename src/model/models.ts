import { deriveThreadStructureRuntime } from "@t3tools/client-runtime/state/thread-execution";
import { threadSupportsProviderHandoff } from "@t3tools/client-runtime/state/thread-workflows";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  isProviderAvailable,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadProjection,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelectionValue,
  type RuntimeMode,
  type ServerConfig,
  type ServerProvider,
  type ServerProviderModel,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@t3tools/shared/projectSettings";

/** Providers you can pick, as the web's picker: enabled and not unavailable. */
export function selectableProviders(config: ServerConfig | null): ServerProvider[] {
  return (config?.providers ?? []).filter((provider) => provider.enabled && isProviderAvailable(provider));
}

export function providerName(provider: Pick<ServerProvider, "instanceId" | "driver" | "displayName">): string {
  return resolveProviderInstanceDisplayName(provider);
}

/** As the web's default model for an instance: its default, else the first built-in model. */
export function defaultModel(provider: ServerProvider): ServerProviderModel | undefined {
  return provider.models.find((model) => model.isDefault && !model.isCustom) ?? provider.models.find((model) => !model.isCustom) ?? provider.models[0];
}

export function findModel(config: ServerConfig | null, selection: ModelSelection): { provider: ServerProvider; model: ServerProviderModel | undefined } | null {
  const provider = config?.providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!provider) return null;
  return { provider, model: provider.models.find((model) => model.slug === selection.model || model.aliases?.includes(selection.model)) };
}

/** The model's adjustable options (thinking level, speed, …), as the server describes them. */
export function optionDescriptors(config: ServerConfig | null, selection: ModelSelection): readonly ProviderOptionDescriptor[] {
  return findModel(config, selection)?.model?.capabilities?.optionDescriptors ?? [];
}

/** The option's value in this selection, else the descriptor's current or default value. */
export function optionValue(selection: ModelSelection, descriptor: ProviderOptionDescriptor): ProviderOptionSelectionValue | undefined {
  const chosen = selection.options?.find((option) => option.id === descriptor.id)?.value;
  if (chosen !== undefined) return chosen;
  if (descriptor.type === "boolean") return descriptor.currentValue;
  return descriptor.currentValue ?? descriptor.options.find((choice) => choice.isDefault)?.id;
}

export function optionValueLabel(descriptor: ProviderOptionDescriptor, value: ProviderOptionSelectionValue | undefined): string {
  if (descriptor.type === "boolean") return value === true ? "on" : "off";
  return descriptor.options.find((choice) => choice.id === value)?.label ?? String(value ?? "default");
}

export function withOption(selection: ModelSelection, id: string, value: ProviderOptionSelectionValue): ModelSelection {
  return { ...selection, options: [...(selection.options ?? []).filter((option) => option.id !== id), { id, value }] };
}

/** A switch to another model keeps the options the new model also has. */
export function withModel(config: ServerConfig | null, current: ModelSelection, instanceId: ProviderInstanceId, model: string): ModelSelection {
  const next: ModelSelection = { instanceId, model };
  const descriptors = optionDescriptors(config, next);
  const kept = (current.options ?? []).filter((option) => descriptors.some((descriptor) => descriptor.id === option.id));
  return kept.length > 0 ? { ...next, options: kept } : next;
}

/** "Opus 4.7 · High · Fast": the model, then each option that differs from off. */
export function modelSummary(config: ServerConfig | null, selection: ModelSelection): string {
  const found = findModel(config, selection);
  const name = found?.model?.shortName ?? found?.model?.name ?? selection.model;
  const options = optionDescriptors(config, selection).flatMap((descriptor) => {
    const value = optionValue(selection, descriptor);
    if (descriptor.type === "boolean") return value === true ? [descriptor.label] : [];
    return value === undefined ? [] : [optionValueLabel(descriptor, value)];
  });
  return [name, ...options].join(" · ");
}

/**
 * Which providers a started thread may move to, as the web's
 * getStartedThreadModelChangeBlockReason: any, before a session starts or when the
 * provider supports handoff; otherwise only the one it runs on.
 */
export function lockedProviderInstance(projection: OrchestrationV2ThreadProjection | null | undefined): ProviderInstanceId | null {
  if (!projection) return null;
  const runtime = deriveThreadStructureRuntime(projection);
  if (runtime === null || threadSupportsProviderHandoff(projection)) return null;
  return runtime.providerInstanceId;
}

export const RUNTIME_MODES: readonly RuntimeMode[] = ["approval-required", "auto-accept-edits", "auto", "full-access"];

export interface DraftThread {
  readonly projectId: OrchestrationProjectShell["id"];
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly envMode: ThreadEnvMode;
  /** Runs in another thread's worktree, from "New thread on <branch>". */
  readonly existingWorktree?: { readonly path: string; readonly branch: string | null };
}

/**
 * A new thread's defaults, as the web's new-thread handler: the project's or machine's
 * default model, else the current thread's, else the first selectable provider's default;
 * the default mode; and local or worktree from the project settings.
 */
export function draftDefaults(input: {
  readonly config: ServerConfig | null;
  readonly project: OrchestrationProjectShell;
  readonly currentModel: ModelSelection | null;
  readonly projectHasThreads: boolean;
}): DraftThread {
  const settings = input.config ? resolveProjectSettings(input.config.settings, input.project.id, input.project, null) : null;
  const firstProvider = selectableProviders(input.config)[0];
  const firstModel = firstProvider ? defaultModel(firstProvider) : undefined;
  const modelSelection: ModelSelection = settings?.settings.defaultModelSelection ??
    input.currentModel ?? { instanceId: (firstProvider?.instanceId ?? "codex") as ProviderInstanceId, model: firstModel?.slug ?? "default" };
  const envMode = settings
    ? resolveNewThreadEnvMode({ projectSettings: settings, workspaceRoot: input.project.workspaceRoot, newProjectsRoot: null, projectHasThreads: input.projectHasThreads })
    : "local";
  return { projectId: input.project.id, modelSelection, runtimeMode: settings?.settings.defaultRuntimeMode ?? "full-access", envMode };
}

/** Same model with the same effective options, counting defaults as chosen. */
export function sameSelection(config: ServerConfig | null, a: ModelSelection, b: ModelSelection): boolean {
  if (a.instanceId !== b.instanceId || a.model !== b.model) return false;
  return optionDescriptors(config, a).every((descriptor) => optionValue(a, descriptor) === optionValue(b, descriptor));
}
