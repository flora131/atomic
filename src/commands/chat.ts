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

import type { AgentType } from "../telemetry/types.ts";
import type { CodingAgentClient } from "../sdk/types.ts";
import { getModelPreference, getReasoningEffortPreference } from "../utils/settings.ts";
import { discoverMcpConfigs } from "../utils/mcp-config.ts";
import { trackAtomicCommand } from "../telemetry/index.ts";
import { pathExists } from "../utils/copy.ts";
import { AGENT_CONFIG } from "../config.ts";
// initCommand is lazy-loaded only when auto-init is needed
import { join } from "path";
import { readdir } from "fs/promises";
import {
  ensureAtomicGlobalAgentConfigs,
  isManagedScmSkillName,
} from "../utils/atomic-global-config.ts";
import { detectInstallationType, getConfigRoot } from "../utils/config-path.ts";
import { prepareOpenCodeConfigDir } from "../utils/opencode-config.ts";
import { prepareClaudeConfigDir } from "../utils/claude-config.ts";

// SDK client imports — lazy-loaded per agent to avoid loading all 3 SDKs
import { createTodoWriteTool } from "../sdk/tools/todo-write.ts";
import { registerCustomTools } from "../sdk/tools/index.ts";

// Chat UI imports
import {
  startChatUI,
  darkTheme,
  lightTheme,
  darkThemeAnsi,
  lightThemeAnsi,
  type ChatUIConfig,
  type Theme,
} from "../ui/index.ts";
import { supportsTrueColor } from "../utils/detect.ts";
import { VERSION } from "../version.ts";

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
  /** Initial prompt to send on session start */
  initialPrompt?: string;
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
async function createClientForAgentType(agentType: AgentType): Promise<CodingAgentClient> {
  switch (agentType) {
    case "claude": {
      const { createClaudeAgentClient } = await import("../sdk/clients/claude.ts");
      return createClaudeAgentClient();
    }
    case "opencode": {
      const { createOpenCodeClient } = await import("../sdk/clients/opencode.ts");
      return createOpenCodeClient({
        directory: process.cwd(),
        port: 0,
        reuseExistingServer: false,
      });
    }
    case "copilot": {
      const { createCopilotClient } = await import("../sdk/clients/copilot.ts");
      return createCopilotClient();
    }
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
  const truecolor = supportsTrueColor();
  if (themeName === "light") {
    return truecolor ? lightTheme : lightThemeAnsi;
  }
  return truecolor ? darkTheme : darkThemeAnsi;
}

/**
 * Determine whether the selected agent already has project-level SCM skills.
 */
export async function hasProjectScmSkills(
  agentType: AgentType,
  projectRoot: string
): Promise<boolean> {
  const skillsDir = join(projectRoot, AGENT_CONFIG[agentType].folder, "skills");
  if (!(await pathExists(skillsDir))) return false;

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries.some(
      (entry) => entry.isDirectory() && isManagedScmSkillName(entry.name)
    );
  } catch {
    return false;
  }
}

/**
 * Determine whether chat should auto-run init for the selected agent.
 */
export async function shouldAutoInitChat(
  agentType: AgentType,
  projectRoot: string = process.cwd()
): Promise<boolean> {
  return !(await hasProjectScmSkills(agentType, projectRoot));
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
    agentType,
    theme = "dark",
    model,
    workflow = false,
    initialPrompt,
  } = options;

  if (!agentType) {
    throw new Error("agentType is required — resolve via saved config or init before calling chatCommand");
  }

  // CLI flag takes precedence, then persisted preference
  const effectiveModel = model ?? getModelPreference(agentType);
  const effectiveReasoningEffort = getReasoningEffortPreference(agentType);

  const agentName = getAgentDisplayName(agentType);
  const projectRoot = process.cwd();

  if (detectInstallationType() !== "source") {
    await ensureAtomicGlobalAgentConfigs(getConfigRoot());
  }

  if (agentType === "opencode") {
    const mergedConfigDir = await prepareOpenCodeConfigDir({ projectRoot });
    if (mergedConfigDir) {
      process.env.OPENCODE_CONFIG_DIR = mergedConfigDir;
    }
  }

  if (agentType === "claude") {
    const mergedClaudeConfigDir = await prepareClaudeConfigDir();
    if (mergedClaudeConfigDir) {
      process.env.CLAUDE_CONFIG_DIR = mergedClaudeConfigDir;
    }
  }

  // Auto-init when project SCM skills are missing
  if (await shouldAutoInitChat(agentType, projectRoot)) {
    const configNotFoundMessage =
      `Source control skills are not configured for ${agentName}. Starting interactive setup...`;

    const { initCommand } = await import("./init.ts");
    await initCommand({
      showBanner: false,
      preSelectedAgent: agentType,
      configNotFoundMessage,
    });
  }

  console.log(`Starting ${agentName} chat interface...`);
  console.log("");

  // Create the SDK client
  const client = await createClientForAgentType(agentType);

  // Register TodoWrite tool for agents that don't have it built-in
  if (agentType === "copilot") {
    client.registerTool(createTodoWriteTool());
  }

  // Discover and register custom tools before starting the client
  await registerCustomTools(client);

  try {
    // Start the client immediately so default model discovery can query
    // SDK metadata (e.g., listModels/provider defaults) before rendering header.
    const clientStartPromise = client.start();

    // Wait for startup so "no model set" resolves to a real model name
    // instead of provider fallback labels like "OpenCode"/"Copilot".
    await clientStartPromise;

    const modelDisplayInfo = await client.getModelDisplayInfo(effectiveModel);

    // For Copilot, show explicit reasoning effort when available:
    // user preference first, otherwise SDK-reported model default.
    const resolvedReasoningEffort =
      agentType === "copilot" && modelDisplayInfo.supportsReasoning
        ? (effectiveReasoningEffort ?? modelDisplayInfo.defaultReasoningEffort)
        : effectiveReasoningEffort;

    // For copilot, append reasoning effort to model display if the model supports it
    let displayModelName = modelDisplayInfo.model;
    if (agentType === "copilot" && resolvedReasoningEffort && modelDisplayInfo.supportsReasoning) {
      displayModelName += ` (${resolvedReasoningEffort})`;
    }

    // Discover MCP server configs from all known config formats
    const mcpServers = discoverMcpConfigs();

    // Build chat UI configuration
    const chatConfig: ChatUIConfig = {
      sessionConfig: {
        model: effectiveModel,
        reasoningEffort: resolvedReasoningEffort,
        mcpServers,
      },
      theme: getTheme(theme),
      title: `Chat - ${agentName}`,
      placeholder: "Type a message...",
      version: VERSION,
      model: displayModelName,
      tier: modelDisplayInfo.tier,
      workingDir: projectRoot,
      suggestion: 'Try "fix typecheck errors"',
      agentType,
      initialPrompt,
      workflowEnabled: workflow,
      clientStartPromise,
    };

    // Start standard chat
    const result = await startChatUI(client, chatConfig);
    console.log(`\nChat ended. ${result.messageCount} messages exchanged.`);
    trackAtomicCommand("chat", agentType, true);
    return 0;
  } catch (error) {
    trackAtomicCommand("chat", agentType, false);
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
