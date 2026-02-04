/**
 * SDK Initialization Module
 *
 * This module provides initialization and configuration utilities for the
 * unified coding agent SDK. It handles setup of client instances, environment
 * configuration, and common initialization patterns across all supported
 * coding agent backends (Claude, OpenCode, Copilot).
 */

import type {
  CodingAgentClient,
  SessionConfig,
  PermissionMode,
  McpServerConfig,
} from "./types.ts";

import type { Options as ClaudeOptions } from "@anthropic-ai/claude-agent-sdk";

/**
 * Returns default Claude SDK options for initialization.
 *
 * The SDK handles local vs global settings priority automatically:
 * - Project settings (.claude/settings.json) take precedence over
 * - User settings (~/.claude/settings.json)
 *
 * @returns Partial Claude SDK options with recommended defaults
 */
export function initClaudeOptions(): Partial<ClaudeOptions> {
  return {
    // Auto-loads .claude/ with ~/.claude/ fallback
    settingSources: ["project"],
    // Bypass permission prompts for automated workflows
    permissionMode: "bypassPermissions",
    // Required safety flag when using bypassPermissions
    allowDangerouslySkipPermissions: true,
  };
}

/**
 * OpenCode permission rule for session creation.
 * Matches the SDK's PermissionRule type.
 */
export interface OpenCodePermissionRule {
  permission: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
}

/**
 * Returns default OpenCode SDK permission rules for session creation.
 *
 * The SDK handles local vs global settings priority automatically via Config.get():
 * - Project settings (.opencode/config.json) take precedence over
 * - User settings (~/.opencode/config.json)
 *
 * @returns OpenCode permission rules with recommended defaults for automated workflows
 */
export function initOpenCodeConfigOverrides(): OpenCodePermissionRule[] {
  return [
    // Allow all permissions for automated workflows
    { permission: "*", pattern: "*", action: "allow" },
  ];
}

/**
 * Returns default Copilot SDK session options for initialization.
 *
 * NOTE: Unlike Claude and OpenCode SDKs, the Copilot SDK does NOT auto-load
 * agent configurations from .github/agents/ or ~/.github/agents/.
 * Manual parsing is required via loadCopilotAgents() from src/config/copilot-manual.ts.
 *
 * @returns Copilot session options with recommended defaults
 */
export function initCopilotSessionOptions(): {
  OnPermissionRequest: () => Promise<{ kind: "approved" }>;
} {
  return {
    // Auto-approve all permission requests for automated workflows
    OnPermissionRequest: async () => ({ kind: "approved" as const }),
  };
}
