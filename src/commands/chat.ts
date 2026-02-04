#!/usr/bin/env bun
/**
 * Chat CLI command for atomic
 *
 * Provides a simple chat interface with SDK clients.
 *
 * Usage:
 *   atomic chat                      Start chat with default agent (claude)
 *   atomic chat -a <agent>           Start chat with specified agent
 *   atomic chat --theme <name>       Use specified theme (dark/light)
 *
 * Reference: Feature 30 - Chat interface with SDK clients
 */

import type { AgentType } from "../utils/telemetry/types.ts";
import type { CodingAgentClient } from "../sdk/types.ts";

// SDK client imports
import { createClaudeAgentClient } from "../sdk/claude-client.ts";
import { createOpenCodeClient } from "../sdk/opencode-client.ts";
import { createCopilotClient } from "../sdk/copilot-client.ts";

// Chat UI imports
import {
  startChatUI,
  darkTheme,
  lightTheme,
  type ChatUIConfig,
  type Theme,
} from "../ui/index.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the chat command.
 */
export interface ChatCommandOptions {
  /** Agent type to use (claude, opencode, copilot) */
  agentType?: AgentType;
  /** Theme to use (dark/light) */
  theme?: "dark" | "light";
  /** Session configuration options */
  model?: string;
  /** Enable graph workflow mode */
  workflow?: boolean;
  /** Maximum iterations for workflow */
  maxIterations?: number;
}

// ============================================================================
// Client Factory
// ============================================================================

/**
 * Create an SDK client based on agent type.
 *
 * @param agentType - The type of agent to create a client for
 * @returns A CodingAgentClient instance
 */
function createClientForAgentType(agentType: AgentType): CodingAgentClient {
  switch (agentType) {
    case "claude":
      return createClaudeAgentClient();
    case "opencode":
      return createOpenCodeClient();
    case "copilot":
      return createCopilotClient();
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

/**
 * Get the display name for an agent type.
 */
function getAgentDisplayName(agentType: AgentType): string {
  const names: Record<AgentType, string> = {
    claude: "Claude",
    opencode: "OpenCode",
    copilot: "Copilot",
  };
  return names[agentType] ?? agentType;
}

/**
 * Get theme from name.
 */
function getTheme(themeName: "dark" | "light"): Theme {
  return themeName === "light" ? lightTheme : darkTheme;
}

// ============================================================================
// Slash Command Handling
// ============================================================================

/**
 * Check if a message is a slash command.
 */
function isSlashCommand(message: string): boolean {
  return message.startsWith("/");
}

/**
 * Parse a slash command.
 */
function parseSlashCommand(message: string): { command: string; args: string } {
  const trimmed = message.slice(1).trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.toLowerCase(), args: "" };
  }
  return {
    command: trimmed.slice(0, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

/**
 * Handle the /theme slash command.
 *
 * @returns Theme change message or null if invalid
 */
function handleThemeCommand(args: string): { newTheme: "dark" | "light"; message: string } | null {
  const themeName = args.toLowerCase();
  if (themeName === "dark" || themeName === "light") {
    return {
      newTheme: themeName,
      message: `Theme switched to ${themeName} mode.`,
    };
  }
  return null;
}

// ============================================================================
// Chat Command Implementation
// ============================================================================

/**
 * Start the chat interface with the specified options.
 *
 * @param options - Chat command configuration options
 * @returns Exit code (0 for success)
 */
export async function chatCommand(options: ChatCommandOptions = {}): Promise<number> {
  const {
    agentType = "claude",
    theme = "dark",
    model,
  } = options;

  const agentName = getAgentDisplayName(agentType);

  console.log(`Starting ${agentName} chat interface...`);
  console.log("");

  // Create the SDK client
  const client = createClientForAgentType(agentType);

  try {
    await client.start();

    // Get model info from the client (after start to ensure connection)
    // Pass the model from CLI options if provided for accurate display
    const modelDisplayInfo = await client.getModelDisplayInfo(model);

    // Build chat UI configuration
    const chatConfig: ChatUIConfig = {
      sessionConfig: {
        model,
      },
      theme: getTheme(theme),
      title: `Chat - ${agentName}`,
      placeholder: "Type a message...",
      version: "0.4.4",
      model: model ?? modelDisplayInfo.model,
      tier: modelDisplayInfo.tier,
      workingDir: process.cwd(),
      suggestion: 'Try "fix typecheck errors"',
      agentType,
    };

    // Start standard chat
    const result = await startChatUI(client, chatConfig);
    console.log(`\nChat ended. ${result.messageCount} messages exchanged.`);
    return 0;
  } catch (error) {
    console.error("Chat error:", error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await client.stop();
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  createClientForAgentType,
  getAgentDisplayName,
  getTheme,
  isSlashCommand,
  parseSlashCommand,
  handleThemeCommand,
};
