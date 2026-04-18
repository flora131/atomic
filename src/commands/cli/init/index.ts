/**
 * Automatic project setup — replaces the interactive `atomic init` command.
 *
 * Applies onboarding files (MCP configs, settings). Called transparently
 * during `atomic chat` preflight so users never need to think about
 * initialization.
 */

import type { AgentKey } from "../../../services/config/index.ts";
import { getConfigRoot } from "../../../services/config/config-path.ts";
import { applyManagedOnboardingFiles } from "./onboarding.ts";

/**
 * Ensure the project is configured for the given agent. Idempotent — safe
 * to call on every `atomic chat` invocation.
 */
export async function ensureProjectSetup(
  agentKey: AgentKey,
  projectRoot: string,
): Promise<void> {
  const configRoot = getConfigRoot();
  await applyManagedOnboardingFiles(agentKey, projectRoot, configRoot);
}
