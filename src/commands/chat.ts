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
import type { ChatUIConfig, Theme } from "../ui/index.ts";
import { getModelPreference, getReasoningEffortPreference } from "../utils/settings.ts";
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
async function getTheme(themeName: "dark" | "light"): Promise<Theme> {
  const { darkTheme, lightTheme, darkThemeAnsi, lightThemeAnsi } = await import("../ui/index.ts");
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

  // Read settings asynchronously in parallel
  const [resolvedModel, effectiveReasoningEffort] = await Promise.all([
    getModelPreference(agentType),
    getReasoningEffortPreference(agentType),
  ]);
  const effectiveModel = model ?? resolvedModel;

  const agentName = getAgentDisplayName(agentType);
  const projectRoot = process.cwd();

  // Parallelize independent config preparation steps
  const configPrepTasks: Promise<void>[] = [];

  if (detectInstallationType() !== "source") {
    configPrepTasks.push(ensureAtomicGlobalAgentConfigs(getConfigRoot()));
  }

  if (agentType === "opencode") {
    configPrepTasks.push(
      import("../utils/opencode-config.ts").then(async ({ prepareOpenCodeConfigDir }) => {
        const mergedConfigDir = await prepareOpenCodeConfigDir({ projectRoot });
        if (mergedConfigDir) {
          process.env.OPENCODE_CONFIG_DIR = mergedConfigDir;
        }
      })
    );
  }

  if (agentType === "claude") {
    configPrepTasks.push(
      import("../utils/claude-config.ts").then(async ({ prepareClaudeConfigDir }) => {
        const mergedClaudeConfigDir = await prepareClaudeConfigDir();
        if (mergedClaudeConfigDir) {
          process.env.CLAUDE_CONFIG_DIR = mergedClaudeConfigDir;
        }
      })
    );
  }

  await Promise.all(configPrepTasks);

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

  // Lazy-load SDK tools and create client
  const [{ createTodoWriteTool }, { registerCustomTools }] = await Promise.all([
    import("../sdk/tools/todo-write.ts"),
    import("../sdk/tools/index.ts"),
  ]);

  const client = await createClientForAgentType(agentType);

  // Register TodoWrite tool for agents that don't have it built-in
  if (agentType === "copilot") {
    client.registerTool(createTodoWriteTool());
  }

  // Discover and register custom tools before starting the client
  await registerCustomTools(client);

  try {
    // Start client and discover MCP configs in parallel
    const [{ discoverMcpConfigs }, { trackAtomicCommand }, { startChatUI }] = await Promise.all([
      import("../utils/mcp-config.ts"),
      import("../telemetry/index.ts"),
      import("../ui/index.ts"),
    ]);

    // Start client and run MCP discovery concurrently
    const clientStartPromise = client.start();
    const mcpDiscoveryPromise = Promise.resolve(discoverMcpConfigs());

    await clientStartPromise;

    const [modelDisplayInfo, mcpServers] = await Promise.all([
      client.getModelDisplayInfo(effectiveModel),
      mcpDiscoveryPromise,
    ]);

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

    // Build chat UI configuration
    const chatConfig: ChatUIConfig = {
      sessionConfig: {
        model: effectiveModel,
        reasoningEffort: resolvedReasoningEffort,
        mcpServers,
      },
      theme: await getTheme(theme),
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
    const { trackAtomicCommand } = await import("../telemetry/index.ts");
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
