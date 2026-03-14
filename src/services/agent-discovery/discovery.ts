/**
 * Agent Discovery Service
 *
 * Provides agent discovery functionality extracted from the command layer.
 * This breaks the circular dependency where `services/workflows/` imported
 * `discoverAgentInfos` from `commands/tui/agent-commands.ts`.
 *
 * Both `commands/tui/` and `services/workflows/` now import from this module.
 */

export { discoverAgentInfos, getDiscoveredAgent } from "@/commands/catalog/agents/discovery.ts";
