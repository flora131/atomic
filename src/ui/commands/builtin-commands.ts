/**
 * Built-in Commands for Chat UI
 *
 * Provides core slash commands for the chat interface:
 * /help, /theme, /clear, /compact
 *
 * Note: /status removed - progress tracked via research/progress.txt instead
 *
 * Reference: Feature 2 - Implement built-in commands
 */

import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
  ContextDisplayInfo,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import { saveModelPreference, clearReasoningEffortPreference } from "../../utils/settings.ts";
import { discoverMcpConfigs } from "../../utils/mcp-config.ts";
import { BACKGROUND_COMPACTION_THRESHOLD } from "../../graph/types.ts";
import {
  buildMcpSnapshotView,
  getActiveMcpServers,
  type McpServerToggleMap,
} from "../utils/mcp-output.ts";


// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

/**
 * /help - Display all available commands with descriptions.
 *
 * Lists all registered commands grouped by category.
 */
export const helpCommand: CommandDefinition = {
  name: "help",
  description: "Show all available commands",
  category: "builtin",
  aliases: ["h", "?"],
  execute: async (_args: string, context: CommandContext): Promise<CommandResult> => {
    const commands = globalRegistry.all();

    if (commands.length === 0) {
      return {
        success: true,
        message: "No commands available.",
      };
    }

    // Group commands by category
    const grouped: Record<string, CommandDefinition[]> = {};
    for (const cmd of commands) {
      const category = cmd.category;
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(cmd);
    }

    // Format output
    const lines: string[] = ["**Available Commands**", ""];

    const categoryOrder = ["builtin", "workflow", "agent", "skill", "custom"] as const;
    const categoryLabels: Record<string, string> = {
      builtin: "Built-in",
      workflow: "Workflows",
      agent: "Sub-Agents",
      skill: "Skills",
      custom: "Custom",
    };

    for (const category of categoryOrder) {
      const cmds = grouped[category];
      if (cmds && cmds.length > 0) {
        lines.push(`**${categoryLabels[category]}**`);
        for (const cmd of cmds) {
          const aliases =
            cmd.aliases && cmd.aliases.length > 0
              ? ` (${cmd.aliases.join(", ")})`
              : "";
          lines.push(`  /${cmd.name}${aliases} - ${cmd.description}`);
        }
        lines.push("");
      }
    }

    // Add Ralph workflow usage if /ralph is registered
    if (grouped["workflow"]?.some((cmd) => cmd.name === "ralph")) {
      lines.push("**Workflow Usage**");
      lines.push("  /ralph <prompt>                 Start new session");
      lines.push("");
    }

    // Add Sub-Agents documentation if agent commands are registered
    const agentCommands = grouped["agent"];
    if (agentCommands && agentCommands.length > 0) {
      lines.push("**Sub-Agent Details**");
      lines.push("  Specialized agents for specific tasks. Invoke with /<agent-name> <query>");
      lines.push("");

      // List each agent with current model info
      let currentModelLabel = "current model";
      if (context.getModelDisplayInfo) {
        try {
          const info = await context.getModelDisplayInfo();
          if (info.model) {
            currentModelLabel = info.model;
          }
        } catch {
          // fall back to "current model"
        }
      }

      const agentDetails: Record<string, string> = {
        "codebase-analyzer": "Deep code analysis and architecture review",
        "codebase-locator": "Find files and components quickly",
        "codebase-pattern-finder": "Find similar implementations and patterns",
        "codebase-online-researcher": "Research using web sources",
        "codebase-research-analyzer": "Analyze research/ directory documents",
        "codebase-research-locator": "Find documents in research/ directory",
        debugger: "Debug errors and test failures",
      };

      for (const cmd of agentCommands) {
        const desc = agentDetails[cmd.name];
        if (desc) {
          lines.push(`  /${cmd.name} (${currentModelLabel})`);
          lines.push(`    ${desc}`);
        } else {
          // For custom agents without hardcoded details
          lines.push(`  /${cmd.name}`);
          lines.push(`    ${cmd.description}`);
        }
      }
      lines.push("");
    }

    return {
      success: true,
      message: lines.join("\n").trim(),
    };
  },
};

/**
 * /theme - Toggle between dark and light theme.
 *
 * Note: Actual theme toggle is handled by the UI via stateUpdate.
 * The command returns the toggle intention; the ChatApp component
 * should listen for this and call toggleTheme().
 */
export const themeCommand: CommandDefinition = {
  name: "theme",
  description: "Toggle between dark and light theme",
  category: "builtin",
  argumentHint: "[dark | light]",
  execute: (args: string, _context: CommandContext): CommandResult => {
    const targetTheme = args.trim().toLowerCase();

    if (targetTheme === "dark" || targetTheme === "light") {
      return {
        success: true,
        message: `Switched to ${targetTheme} theme.`,
        themeChange: targetTheme,
      };
    }

    if (targetTheme && targetTheme !== "dark" && targetTheme !== "light") {
      return {
        success: false,
        message: `Unknown theme '${args.trim()}'. Use 'dark' or 'light'.`,
      };
    }

    // Toggle without argument
    return {
      success: true,
      message: "Theme toggled.",
      themeChange: "toggle",
    };
  },
};

/**
 * /clear - Clear all messages and reset the session.
 *
 * Destroys the current session to clear the context window.
 * A new session will be created automatically on the next message.
 */
export const clearCommand: CommandDefinition = {
  name: "clear",
  description: "Clear all messages and reset the session",
  category: "builtin",
  aliases: ["cls", "c"],
  execute: (_args: string, _context: CommandContext): CommandResult => {
    return {
      success: true,
      clearMessages: true,
      destroySession: true,
    };
  },
};

/**
 * /compact - Compact the context to reduce token usage.
 *
 * Calls the session's summarize() method to compact the conversation
 * context, then clears the visible messages.
 */
export const compactCommand: CommandDefinition = {
  name: "compact",
  description: "Compact context to reduce token usage",
  category: "builtin",
  execute: async (_args: string, context: CommandContext): Promise<CommandResult> => {
    if (!context.session) {
      return {
        success: false,
        message: "No active session. Send a message first to start a session.",
      };
    }

    try {
      // Call the session's summarize method to compact context
      // Loading spinner is handled automatically by executeCommand's delayed spinner
      await context.session.summarize();

      // Clear visible messages after context compaction
      return {
        success: true,
        message: "Conversation compacted (ctrl+o for history)",
        clearMessages: true,
        compactionSummary: "Conversation context was compacted to reduce token usage. Previous messages are summarized above.",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to compact context: ${errorMessage}`,
      };
    }
  },
};

/**
 * /exit - Exit the TUI cleanly.
 *
 * This is the only way to exit the TUI besides Ctrl+C twice.
 * Double ESC no longer exits.
 */
export const exitCommand: CommandDefinition = {
  name: "exit",
  description: "Exit the chat application",
  category: "builtin",
  aliases: ["quit", "q"],
  execute: (_args: string, _context: CommandContext): CommandResult => {
    return {
      success: true,
      message: "Goodbye!",
      shouldExit: true,
    };
  },
};

/**
 * /model - Switch or view the current model.
 *
 * Subcommands:
 *   (no args) - Show interactive model selector
 *   select    - Show interactive model selector
 *   list      - List available models
 *   <model>   - Switch to specified model
 */
export const modelCommand: CommandDefinition = {
  name: "model",
  description: "Switch or view the current model",
  category: "builtin",
  aliases: ["m"],
  argumentHint: "[model | list [provider] | select]",
  execute: async (args: string, context: CommandContext): Promise<CommandResult> => {
    const { agentType, modelOps, state } = context;
    const trimmed = args.trim();

    // No args: show interactive model selector
    if (!trimmed) {
      return {
        success: true,
        showModelSelector: true,
      };
    }

    // "select" subcommand: show interactive model selector
    if (trimmed.toLowerCase() === "select") {
      return {
        success: true,
        showModelSelector: true,
      };
    }

    const lowerTrimmed = trimmed.toLowerCase();

    // List subcommand
    if (lowerTrimmed === "list" || lowerTrimmed.startsWith("list ")) {
      const providerFilter = lowerTrimmed.startsWith("list ")
        ? trimmed.substring(5).trim()
        : undefined;
      const models = await modelOps?.listAvailableModels();

      // Handle no models available
      if (!models || models.length === 0) {
        return {
          success: true,
          message: "No models available. SDK connection may have failed.",
        };
      }
      const filtered = providerFilter
        ? models.filter((m) => m.providerID === providerFilter)
        : models;
      if (filtered.length === 0) {
        return {
          success: true,
          message: `No models found for provider: ${providerFilter}`,
        };
      }
      const grouped = groupByProvider(filtered);
      const lines = formatGroupedModels(grouped);

      return {
        success: true,
        message: `**Available Models**\n\n${lines.join("\n")}`,
      };
    }

    // Model switching (default case)
    // Reject model switch during streaming to prevent mid-response changes
    if (state.isStreaming) {
      return {
        success: false,
        message: "Cannot switch models while a response is streaming. Please wait for the current response to complete.",
      };
    }

    try {
      const resolvedModel = modelOps?.resolveAlias(trimmed) ?? trimmed;
      if (modelOps && "setPendingReasoningEffort" in modelOps) {
        (modelOps as { setPendingReasoningEffort: (effort: string | undefined) => void })
          .setPendingReasoningEffort(undefined);
      }
      const result = await modelOps?.setModel(resolvedModel);
      const effectiveModel =
        modelOps?.getPendingModel?.()
        ?? await modelOps?.getCurrentModel?.()
        ?? resolvedModel;
      if (agentType) {
        saveModelPreference(agentType, effectiveModel);
        // Clear reasoning effort since the text command can't prompt for it;
        // user should use the interactive selector (/model select) to set effort
        clearReasoningEffortPreference(agentType);
      }
      if (result?.requiresNewSession) {
        return {
          success: true,
          message: `Model **${effectiveModel}** will be used for the next session. (${agentType} requires a new session for model changes)`,
          stateUpdate: { pendingModel: effectiveModel } as unknown as CommandResult["stateUpdate"],
        };
      }
      return {
        success: true,
        message: `Model switched to **${effectiveModel}**`,
        stateUpdate: { model: effectiveModel } as unknown as CommandResult["stateUpdate"],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to switch model: ${errorMessage}`,
      };
    }
  },
};

/**
 * Group models by provider ID
 */
export function groupByProvider(models: { providerID: string; modelID?: string; name: string }[]): Map<string, typeof models> {
  const grouped = new Map<string, typeof models>();
  for (const model of models) {
    const arr = grouped.get(model.providerID) ?? [];
    arr.push(model);
    grouped.set(model.providerID, arr);
  }
  return grouped;
}

/**
 * Format grouped models for display
 */
export function formatGroupedModels(grouped: Map<string, { providerID: string; modelID?: string; name: string; status?: string; limits?: { context?: number } }[]>): string[] {
  const lines: string[] = [];
  for (const [providerID, models] of grouped.entries()) {
    lines.push(`**${providerID}**`);
    for (const model of models) {
      let line = `  - ${model.modelID ?? model.name}`;
      const annotations: string[] = [];
      if (model.status && model.status !== 'active') {
        annotations.push(model.status);
      }
      if (model.limits?.context) {
        annotations.push(`${Math.round(model.limits.context / 1000)}k ctx`);
      }
      if (annotations.length > 0) {
        line += ` (${annotations.join(', ')})`;
      }
      lines.push(line);
    }
    lines.push("");
  }
  return lines;
}

/**
 * /mcp - Display and manage MCP servers.
 *
 * Subcommands:
 *   (no args)    - List all discovered MCP servers with status
 *   enable <n>   - Enable a server by name
 *   disable <n>  - Disable a server by name
 */
export const mcpCommand: CommandDefinition = {
  name: "mcp",
  description: "View and toggle MCP servers",
  category: "builtin",
  argumentHint: "[enable|disable <server>]",
  execute: async (args: string, context: CommandContext): Promise<CommandResult> => {
    const servers = discoverMcpConfigs(undefined, { includeDisabled: true });
    const toggles = context.getMcpServerToggles?.() ?? {};
    const trimmed = args.trim();
    const normalized = trimmed.toLowerCase();

    let runtimeSnapshot = null;
    if (context.session?.getMcpSnapshot) {
      try {
        runtimeSnapshot = await context.session.getMcpSnapshot();
      } catch {
        runtimeSnapshot = null;
      }
    }

    // No args: list servers (rendered via McpServerListIndicator component)
    if (!normalized) {
      return {
        success: true,
        mcpSnapshot: buildMcpSnapshotView({
          servers,
          toggles,
          runtimeSnapshot,
        }),
      };
    }

    // enable/disable subcommands
    const parts = normalized.split(/\s+/);
    const subcommand = parts[0];
    const serverName = trimmed.split(/\s+/).slice(1).join(" ");

    if ((subcommand === "enable" || subcommand === "disable") && serverName) {
      const found = servers.find((server) => server.name.toLowerCase() === serverName.toLowerCase());
      if (!found) {
        return {
          success: false,
          message: `MCP server '${serverName}' not found. Run /mcp to see available servers.`,
        };
      }

      const enabled = subcommand === "enable";
      const nextToggles: McpServerToggleMap = {
        ...toggles,
        [found.name]: enabled,
      };

      context.setMcpServerEnabled?.(found.name, enabled);
      context.setSessionMcpServers?.(getActiveMcpServers(servers, nextToggles));

      return {
        success: true,
        message: `MCP server '${found.name}' ${enabled ? "enabled" : "disabled"} for this session. Changes apply to the next session.`,
        mcpSnapshot: buildMcpSnapshotView({
          servers,
          toggles: nextToggles,
          runtimeSnapshot,
        }),
      };
    }

    return {
      success: false,
      message: "Usage: /mcp, /mcp enable <server>, /mcp disable <server>",
    };
  },
};

// ============================================================================
// CONTEXT COMMAND
// ============================================================================


/**
 * /context - Display context window usage.
 *
 * Shows model info, a visual usage bar, and a four-category token breakdown:
 * System/Tools, Messages, Free Space, and Buffer.
 */
export const contextCommand: CommandDefinition = {
  name: "context",
  description: "View context window usage",
  category: "builtin",
  execute: async (_args: string, context: CommandContext): Promise<CommandResult> => {
    let model = "Unknown";
    let tier = "Unknown";
    let modelContextWindow: number | undefined;
    if (context.getModelDisplayInfo) {
      try {
        const info = await context.getModelDisplayInfo();
        model = info.model;
        tier = info.tier;
        modelContextWindow = info.contextWindow;
      } catch {
        // Use defaults
      }
    }

    let maxTokens = 0;
    let systemTools = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    if (context.session) {
      try {
        const usage = await context.session.getContextUsage();
        maxTokens = usage.maxTokens;
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
      } catch {
        // No usage available yet (no messages sent)
      }
      try {
        systemTools = context.session.getSystemToolsTokens();
      } catch {
        // Session baseline not yet captured — fall back to client-level probe
      }
    }

    // Fall back to client-level system tools baseline (captured during start() probe)
    // when session doesn't have it yet (e.g., before first message completes)
    if (systemTools === 0 && context.getClientSystemToolsTokens) {
      systemTools = context.getClientSystemToolsTokens() ?? 0;
    }

    // Prefer model metadata context window (reflects current/pending model)
    // over session maxTokens which may be stale after a model change.
    if (modelContextWindow) {
      maxTokens = modelContextWindow;
    }

    const buffer = maxTokens > 0 ? Math.floor(maxTokens * (1 - BACKGROUND_COMPACTION_THRESHOLD)) : 0;
    const messages = Math.max(0, (inputTokens - systemTools) + outputTokens);
    const freeSpace = Math.max(0, maxTokens - systemTools - messages - buffer);

    const contextInfo: ContextDisplayInfo = {
      model,
      tier,
      maxTokens,
      systemTools,
      messages,
      freeSpace,
      buffer,
    };

    return { success: true, contextInfo };
  },
};

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * All built-in commands.
 */
export const builtinCommands: CommandDefinition[] = [
  helpCommand,
  themeCommand,
  clearCommand,
  compactCommand,
  exitCommand,
  modelCommand,
  mcpCommand,
  contextCommand,
];

/**
 * Register all built-in commands with the global registry.
 *
 * Call this function during application initialization.
 *
 * @example
 * ```typescript
 * import { registerBuiltinCommands } from "./builtin-commands";
 *
 * // In app initialization
 * registerBuiltinCommands();
 * ```
 */
export function registerBuiltinCommands(): void {
  for (const command of builtinCommands) {
    // Skip if already registered (idempotent)
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}
