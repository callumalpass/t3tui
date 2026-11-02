import type { OrchestrationV2Subagent } from "@t3tools/contracts";

const LIVE = ["pending", "running", "waiting"];

/**
 * Whether a subagent can be stopped from its parent, as the web's lineage panel decides: app-owned
 * tasks always, Claude's native ones only with a strong task reference to aim the stop at.
 */
export function canStopSubagent(agent: OrchestrationV2Subagent): boolean {
  const reachable =
    agent.origin === "app_owned" ||
    (agent.origin === "provider_native" && agent.driver === "claudeAgent" && agent.runId != null && agent.nativeTaskRef?.strength === "strong" && agent.nativeTaskRef.nativeId !== null);
  return reachable && agent.startedAt != null && LIVE.includes(agent.status);
}
