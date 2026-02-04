/**
 * Configuration Module Exports
 *
 * This module provides centralized access to all configuration interfaces
 * and loaders for the Atomic CLI.
 */

// Ralph configuration
export {
  type RalphConfig,
  type LoadRalphConfigOptions,
  type RalphWorkflowConfig,
  RALPH_ENV_VARS,
  RALPH_DEFAULTS,
  RALPH_CONFIG,
  loadRalphConfig,
  describeRalphConfig,
} from "./ralph.ts";

// Copilot agent configuration
export { type CopilotAgent, loadCopilotAgents } from "./copilot-manual.ts";
