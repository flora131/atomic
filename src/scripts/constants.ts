/**
 * Shared constants for build/release scripts.
 *
 * Centralises values that appear across multiple scripts so a single
 * change propagates everywhere.
 */

import { AGENTS } from "@bastani/atomic-workflows";
import type { AgentType } from "@bastani/atomic-workflows";

/** npm package name of the workflow SDK. */
export const SDK_PACKAGE_NAME = "@bastani/atomic-workflows";

/** Repo-relative path to the workflow SDK package directory. */
export const WORKFLOW_SDK_DIR = "packages/workflow-sdk";

/** package.json files whose `version` field is bumped together. */
export const VERSION_FILES = [
  "package.json",
  `${WORKFLOW_SDK_DIR}/package.json`,
];

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
