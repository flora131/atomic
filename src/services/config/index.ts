/**
 * Configuration Module Exports
 *
 * Centralized access to the CLI's agent, SCM, and provider-specific
 * configuration helpers.
 */

export * from "@/services/config/definitions.ts";
export { type CopilotAgent, loadCopilotAgents } from "@/services/config/copilot-manual.ts";
