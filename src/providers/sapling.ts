/**
 * Sapling Provider Implementation
 *
 * Stack-based workflow with smartlog visualization.
 * Developed by Meta for modern version control workflows.
 */

import type {
  SourceControlProvider,
  PrerequisiteResult,
  SaplingOptions,
} from "./provider";
import { commandExists } from "./utils";

/**
 * Create a Sapling provider with the given options
 *
 * @param options - Sapling-specific configuration options
 * @returns Configured Sapling provider
 */

export function createSaplingProvider(
  options: SaplingOptions = { prWorkflow: "stack" },
  customCommandExists?: (cmd: string) => Promise<boolean>
): SourceControlProvider {
  // Determine push and createPR command based on workflow
  const pushCommand =
    options.prWorkflow === "stack" ? "sl pr submit --stack" : "sl push --to";
  const createPRCommand =
    options.prWorkflow === "stack" ? "sl pr submit --stack" : "sl pr submit";

  // Use injected commandExists for testability, fallback to real one
  const commandExistsFn = customCommandExists || commandExists;

  return {
    name: "sapling",
    displayName: "Sapling",
    cli: "sl",

    commands: {
      // Status & info
      status: "sl status",
      log: 'sl log --template "{node|short} {desc|firstline}\\n"',
      diff: "sl diff",
      branch: 'sl log -r . --template "{bookmarks}"',

      // Staging & committing
      add: "sl add",
      commit: "sl commit",
      amend: "sl amend",

      // Remote operations
      push: pushCommand,
      pull: "sl pull",

      // PR/code review
      createPR: createPRCommand,
      listPRs: "sl ssl", // Smartlog with PR status
      viewPR: "sl pr",
    },

    allowedTools: [
      "Bash(sl add:*)",
      "Bash(sl status:*)",
      "Bash(sl commit:*)",
      "Bash(sl diff:*)",
      "Bash(sl log:*)",
      "Bash(sl push:*)",
      "Bash(sl pull:*)",
      "Bash(sl pr:*)",
      "Bash(sl amend:*)",
      "Bash(sl goto:*)",
      "Bash(sl next:*)",
      "Bash(sl prev:*)",
      "Bash(sl ssl:*)",
      "Bash(sl web:*)",
      "Bash(gh:*)", // Sapling uses gh for GitHub auth
    ],

    async checkPrerequisites(): Promise<PrerequisiteResult> {
      const missing: string[] = [];

      if (!(await commandExistsFn("sl"))) {
        missing.push("sl");
      }
      // gh is required for GitHub PR integration
      if (!(await commandExistsFn("gh"))) {
        missing.push("gh");
      }

      return {
        satisfied: missing.length === 0,
        missing,
        installInstructions: {
          sl: "brew install sapling  # or: https://sapling-scm.com/docs/install",
          gh: "brew install gh  # Required for GitHub PR integration",
        },
      };
    },
  };
}

/**
 * Default Sapling provider with stack-based workflow
 */
export const SaplingProvider = createSaplingProvider({ prWorkflow: "stack" });
