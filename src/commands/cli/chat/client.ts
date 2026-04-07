/**
 * Chat client utilities
 *
 * Provides agent display name resolution for the chat command.
 * SDK client creation has been removed — the chat command now spawns
 * native agent CLIs directly.
 */

import type { AgentKey } from "@/services/config/index.ts";

export function getAgentDisplayName(agentType: AgentKey): string {
  const names: Record<AgentKey, string> = {
    claude: "Claude",
    opencode: "OpenCode",
    copilot: "Copilot",
  };
  return names[agentType] ?? agentType;
}
