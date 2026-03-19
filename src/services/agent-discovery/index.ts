/**
 * Agent Discovery Service — Public API
 *
 * This module is the canonical import path for agent discovery and active
 * session management.  It was extracted from `commands/tui/` to break the
 * circular dependency between the command layer and the service layer
 * (`services/workflows/` → `commands/tui/` → `services/workflows/`).
 *
 * Consumers:
 *   - `services/workflows/runtime/executor/graph-helpers.ts`  (discoverAgentInfos)
 *   - `services/workflows/runtime/executor/session-runtime.ts` (registerActiveSession)
 *   - `services/workflows/graph/subagent-registry.ts`          (discoverAgentInfos, AgentInfo)
 *   - `commands/tui/workflow-commands/session.ts`              (re-exports)
 *   - `commands/tui/agent-commands.ts`                         (re-exports)
 */

// Agent discovery
export {
  discoverAgentInfos,
  getDiscoveredAgent,
  parseAgentInfoLight,
  shouldAgentOverride,
  validateAgentInfoIntegrity,
  warnSkippedAgentDefinition,
} from "./discovery.ts";

// Active session lifecycle
export {
  clearActiveSessions,
  completeSession,
  getActiveSession,
  getActiveSessions,
  registerActiveSession,
} from "./session.ts";

// Types
export type {
  AgentDefinitionIntegrityResult,
  AgentFileDiscoveryOptions,
  AgentInfo,
  AgentParseResult,
  AgentSource,
  DiscoveredAgentFile,
  WorkflowSession,
} from "./types.ts";
