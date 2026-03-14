/**
 * Agent Discovery Types
 *
 * Shared types for agent discovery and workflow session management.
 * These types are used by both the command layer and the service layer,
 * so they live here to avoid circular dependencies.
 */

export type { AgentInfo, AgentSource, DiscoveredAgentFile, AgentFileDiscoveryOptions } from "@/commands/catalog/agents/types.ts";
export type { WorkflowSession } from "@/services/workflows/session.ts";
