/**
 * Automatic project setup.
 *
 * Applies onboarding files (MCP configs, settings). Called transparently
 * during `atomic chat` preflight so users never need to think about
 * initialization.
 */

import type { AgentKey } from "../../../services/config/index.ts";
import { getConfigRoot } from "../../../services/config/config-path.ts";
import { syncScmMcpServers } from "../../../services/config/scm-sync.ts";
import { applyManagedOnboardingFiles } from "./onboarding.ts";

/**
 * Ensure the project is configured for the given agent. Idempotent — safe
 * to call on every `atomic chat` invocation.
 *
 * Runs in two phases:
 *   1. Copy/merge bundled onboarding files into the project.
 *   2. Reconcile the SCM MCP-server enable/disable state in the agent
 *      configs to match the user's `scm` selection in `.atomic/settings.json`.
 *      Order matters: the onboarding step may have just written the
 *      baseline configs.
 */
export async function ensureProjectSetup(
  agentKey: AgentKey,
  projectRoot: string,
): Promise<void> {
  const configRoot = getConfigRoot();
  await applyManagedOnboardingFiles(agentKey, projectRoot, configRoot);
  await syncScmMcpServers(projectRoot);
}
