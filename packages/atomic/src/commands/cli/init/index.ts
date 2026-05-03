/**
 * Automatic project setup.
 *
 * Applies onboarding files (MCP configs, settings). Called transparently
 * during `atomic chat` preflight so users never need to think about
 * initialization.
 */

import type { AgentKey } from "../../../services/config/index.ts";
import { syncScmMcpServers } from "@bastani/atomic-sdk/services/config/scm-sync";
import { reconcileOpencodeInstructions } from "@bastani/atomic-sdk/services/config/additional-instructions";
import { applyManagedOnboardingFiles } from "./onboarding.ts";
import { getEmbeddedAsset } from "../../../lib/embedded-assets.ts";

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
  await applyManagedOnboardingFiles(agentKey, projectRoot, getEmbeddedAsset);
  await syncScmMcpServers(projectRoot);

  // OpenCode is the only provider whose CLI/SDK has no flag or env-var
  // path for additional instructions — it consumes them via its project
  // config. Reconcile only when targeting OpenCode so we don't touch
  // `.opencode/opencode.json` from unrelated chat sessions.
  if (agentKey === "opencode") {
    await reconcileOpencodeInstructions(projectRoot);
  }
}
