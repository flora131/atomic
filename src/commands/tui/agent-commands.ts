/**
 * Compatibility barrel for agent command discovery and registration.
 *
 * Agent discovery and session management symbols are re-exported from the
 * canonical `@/services/agent-discovery` module.  Remaining catalog
 * functionality (registration, validation, file-level discovery) is
 * re-exported directly from `@/commands/catalog/agents`.
 */

// Canonical agent discovery & session management
export {
  clearActiveSessions,
  completeSession,
  discoverAgentInfos,
  getActiveSession,
  getActiveSessions,
  getDiscoveredAgent,
  registerActiveSession,
} from "@/services/agent-discovery/index.ts";

export type {
  AgentFileDiscoveryOptions,
  AgentInfo,
  AgentSource,
  DiscoveredAgentFile,
  WorkflowSession,
} from "@/services/agent-discovery/index.ts";

// Remaining catalog functionality (registration, validation, paths)
export {
  createAgentCommand,
  registerAgentCommands,
} from "@/commands/catalog/agents/registration.ts";

export {
  parseAgentInfoLight,
  shouldAgentOverride,
  validateAgentInfoIntegrity,
  warnSkippedAgentDefinition,
} from "@/commands/catalog/agents/discovery.ts";

export {
  determineAgentSource,
  discoverAgentFiles,
  discoverAgentFilesInPath,
  discoverAgentFilesWithOptions,
  expandTildePath,
  getRuntimeCompatibleAgentDiscoveryPaths,
} from "@/commands/catalog/agents/discovery-paths.ts";

export type {
  AgentDefinitionIntegrityResult,
  AgentParseResult,
} from "@/commands/catalog/agents/types.ts";

export {
  AGENT_DISCOVERY_PATHS,
  GLOBAL_AGENT_PATHS,
  HOME,
} from "@/commands/catalog/agents/types.ts";
