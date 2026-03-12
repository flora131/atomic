import { homedir } from "node:os";
import type { DefinitionDiscoveryMatch } from "@/commands/tui/definition-integrity.ts";

export const AGENT_DISCOVERY_PATHS = [
  ".claude/agents",
  ".opencode/agents",
  ".github/agents",
] as const;

export const GLOBAL_AGENT_PATHS = ["~/.claude/agents"] as const;

export const HOME = homedir();

export type AgentSource = "project" | "user";

export interface DiscoveredAgentFile {
  path: string;
  source: AgentSource;
  filename: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  source: AgentSource;
  filePath: string;
}

export interface AgentParseResult {
  info: AgentInfo | null;
  issues: readonly string[];
}

export interface AgentDefinitionIntegrityResult {
  valid: boolean;
  issues: readonly string[];
  discoveryMatches: readonly DefinitionDiscoveryMatch[];
}

export interface AgentFileDiscoveryOptions {
  searchPaths?: readonly string[];
}
