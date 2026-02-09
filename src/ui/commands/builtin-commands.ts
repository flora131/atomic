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
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import { saveModelPreference } from "../../utils/settings.ts";
import { discoverMcpConfigs } from "../../utils/mcp-config.ts";

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
  execute: (_args: string, _context: CommandContext): CommandResult => {
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

    // Add Ralph workflow documentation if /ralph is registered
    if (grouped["workflow"]?.some((cmd) => cmd.name === "ralph")) {
      lines.push("**Ralph Workflow**");
      lines.push("  The autonomous implementation workflow.");
      lines.push("");
      lines.push("  Usage:");
      lines.push("    /ralph                        Start with feature-list.json");
      lines.push("    /ralph --yolo <prompt>        Freestyle mode (no feature list)");
      lines.push("    /ralph --resume <uuid>        Resume paused session");
      lines.push("");
      lines.push("  Options:");
      lines.push("    --feature-list <path>         Feature list path (default: research/feature-list.json)");
      lines.push("    --max-iterations <n>          Max iterations (default: 100, 0 = infinite)");
      lines.push("");
      lines.push("  Interrupt:");
      lines.push("    Press Ctrl+C or Esc to pause the workflow.");
      lines.push("    Resume later with: /ralph --resume <session-uuid>");
      lines.push("");
    }

    // Add Sub-Agents documentation if agent commands are registered
    const agentCommands = grouped["agent"];
    if (agentCommands && agentCommands.length > 0) {
      lines.push("**Sub-Agent Details**");
      lines.push("  Specialized agents for specific tasks. Invoke with /<agent-name> <query>");
      lines.push("");

      // List each agent with model info
      const agentDetails: Record<string, { desc: string; model: string }> = {
        "codebase-analyzer": {
          desc: "Deep code analysis and architecture review",
          model: "opus",
        },
        "codebase-locator": {
          desc: "Find files and components quickly",
          model: "opus",
        },
        "codebase-pattern-finder": {
          desc: "Find similar implementations and patterns",
          model: "opus",
        },
        "codebase-online-researcher": {
          desc: "Research using web sources",
          model: "opus",
        },
        "codebase-research-analyzer": {
          desc: "Analyze research/ directory documents",
          model: "opus",
        },
        "codebase-research-locator": {
          desc: "Find documents in research/ directory",
          model: "opus",
        },
        debugger: {
          desc: "Debug errors and test failures",
          model: "opus",
        },
      };

      for (const cmd of agentCommands) {
        const details = agentDetails[cmd.name];
        if (details) {
          lines.push(`  /${cmd.name} (${details.model})`);
          lines.push(`    ${details.desc}`);
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
      // Show loading spinner during compaction
      context.setStreaming(true);
      context.addMessage("assistant", "");

      // Call the session's summarize method to compact context
      await context.session.summarize();

      context.setStreaming(false);

      // Clear visible messages after context compaction
      return {
        success: true,
        message: "Conversation compacted (ctrl+o for history)",
        clearMessages: true,
        compactionSummary: "Conversation context was compacted to reduce token usage. Previous messages are summarized above.",
      };
    } catch (error) {
      context.setStreaming(false);
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
      const result = await modelOps?.setModel(resolvedModel);
      if (agentType) {
        saveModelPreference(agentType, resolvedModel);
      }
      if (result?.requiresNewSession) {
        return {
          success: true,
          message: `Model **${resolvedModel}** will be used for the next session. (${agentType} requires a new session for model changes)`,
          stateUpdate: { pendingModel: resolvedModel } as unknown as CommandResult["stateUpdate"],
        };
      }
      return {
        success: true,
        message: `Model switched to **${resolvedModel}**`,
        stateUpdate: { model: resolvedModel } as unknown as CommandResult["stateUpdate"],
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
  execute: (args: string, _context: CommandContext): CommandResult => {
    const servers = discoverMcpConfigs();
    const trimmed = args.trim().toLowerCase();

    // No args: list servers (rendered via McpServerListIndicator component)
    if (!trimmed) {
      return {
        success: true,
        mcpServers: servers,
      };
    }

    // enable/disable subcommands
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0];
    const serverName = parts.slice(1).join(" ");

    if ((subcommand === "enable" || subcommand === "disable") && serverName) {
      const found = servers.find(s => s.name.toLowerCase() === serverName.toLowerCase());
      if (!found) {
        return {
          success: false,
          message: `MCP server '${serverName}' not found. Run /mcp to see available servers.`,
        };
      }
      return {
        success: true,
        message: `MCP server '${found.name}' ${subcommand}d for this session.`,
        stateUpdate: {
          mcpToggle: { name: found.name, enabled: subcommand === "enable" },
        } as unknown as CommandResult["stateUpdate"],
      };
    }

    return {
      success: false,
      message: "Usage: /mcp, /mcp enable <server>, /mcp disable <server>",
    };
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
