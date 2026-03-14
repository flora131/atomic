/**
 * Agent Discovery — Command Layer Re-exports
 *
 * Re-exports agent discovery functions from their canonical location
 * in `@/services/agent-discovery/discovery.ts`. The implementation was
 * moved to the service layer to enforce unidirectional dependency flow
 * (commands → services, never services → commands).
 */

export {
  discoverAgentInfos,
  getDiscoveredAgent,
  parseAgentInfoLight,
  shouldAgentOverride,
  validateAgentInfoIntegrity,
  warnSkippedAgentDefinition,
} from "@/services/agent-discovery/discovery.ts";
