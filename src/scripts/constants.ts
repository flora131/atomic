/**
 * Shared constants for build/release scripts.
 *
 * Centralises values that appear across multiple scripts so a single
 * change propagates everywhere.
 */

import { AGENTS } from "../sdk/workflows/index.ts";
import type { AgentType } from "../sdk/workflows/index.ts";

export {
  SDK_PACKAGE_NAME,
  VERSION_FILES,
} from "./constants-base.ts";

/**
 * Maps each agent to its config directory (relative to the repo root).
 *
 * Used by the config archive script and validation steps.  The mapping
 * is: claude → .claude, opencode → .opencode, copilot → .github.
 */
const AGENT_CONFIG_ROOT: Record<AgentType, string> = {
  claude: ".claude",
  opencode: ".opencode",
  copilot: ".github",
};

/** Directories copied recursively into the config archive (agents). */
export const CONFIG_DIRS = AGENTS.map(
  (agent) => `${AGENT_CONFIG_ROOT[agent]}/agents`,
);

/** Individual files copied into the config archive. */
export const CONFIG_FILES = [".github/lsp.json"];
