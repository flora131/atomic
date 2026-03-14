import { homedir } from "node:os";
import type {
  AgentDefinitionIntegrityResult,
  AgentInfo,
  AgentParseResult,
  AgentSource,
  DiscoveredAgentFile,
  AgentFileDiscoveryOptions,
} from "@/services/agent-discovery/types.ts";

export type {
  AgentDefinitionIntegrityResult,
  AgentInfo,
  AgentParseResult,
  AgentSource,
  DiscoveredAgentFile,
  AgentFileDiscoveryOptions,
};

export const AGENT_DISCOVERY_PATHS = [
  ".claude/agents",
  ".opencode/agents",
  ".github/agents",
] as const;

export const GLOBAL_AGENT_PATHS = ["~/.claude/agents"] as const;

export const HOME = homedir();
