/**
 * Configuration Module Exports
 *
 * Centralized access to the CLI's agent, SCM, and provider-specific
 * configuration helpers.
 */

export * from "@/services/config/definitions.ts";
export {
  loadClaudeAgents,
  resolveClaudeAgentDirectories,
  resolveClaudeSkillDirectories,
} from "@/services/config/claude-config.ts";
export {
  loadOpenCodeAgents,
  resolveOpenCodeAgentDirectories,
  resolveOpenCodeArtifactPlan,
  resolveOpenCodeSkillDirectories,
} from "@/services/config/opencode-config.ts";
export { type CopilotAgent, loadCopilotAgents } from "@/services/config/copilot-config.ts";
export {
  loadCopilotInstructions,
  resolveCopilotAgentDirectories,
  resolveCopilotDiscoveryPlan,
  resolveCopilotSkillDirectories,
} from "@/services/config/copilot-config.ts";
