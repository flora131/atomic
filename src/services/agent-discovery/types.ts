/**
 * Agent Discovery Types
 *
 * Shared types for agent discovery and workflow session management.
 * These types are owned by the service layer since they describe
 * domain concepts used across both commands and services.
 */

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

export interface AgentFileDiscoveryOptions {
  searchPaths?: readonly string[];
}

export interface AgentParseResult {
  info: AgentInfo | null;
  issues: readonly string[];
}

export interface AgentDefinitionIntegrityResult {
  valid: boolean;
  issues: readonly string[];
  discoveryMatches: readonly import("@/commands/tui/definition-integrity.ts").DefinitionDiscoveryMatch[];
}

export type { WorkflowSession } from "@/services/workflows/session.ts";
