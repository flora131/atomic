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
import { ModelsDev } from "../../models";

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
          model: "haiku",
        },
        "codebase-pattern-finder": {
          desc: "Find similar implementations and patterns",
          model: "sonnet",
        },
        "codebase-online-researcher": {
          desc: "Research using web sources",
          model: "sonnet",
        },
        "codebase-research-analyzer": {
          desc: "Analyze research/ directory documents",
          model: "sonnet",
        },
        "codebase-research-locator": {
          desc: "Find documents in research/ directory",
          model: "haiku",
        },
        debugger: {
          desc: "Debug errors and test failures",
          model: "sonnet",
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
  execute: (args: string, _context: CommandContext): CommandResult => {
    // Parse optional theme argument
    const targetTheme = args.trim().toLowerCase();

    if (targetTheme === "dark" || targetTheme === "light") {
      return {
        success: true,
        message: `Switched to ${targetTheme} theme.`,
        stateUpdate: {
          // Custom state update to indicate theme change
          // The ChatApp component should handle this
        },
      };
    }

    // Toggle without argument
    return {
      success: true,
      message: "Theme toggled.",
      stateUpdate: {
        // Custom state update to indicate theme toggle
      },
    };
  },
};

/**
 * /clear - Clear all messages from the chat.
 *
 * Resets the message array to empty.
 */
export const clearCommand: CommandDefinition = {
  name: "clear",
  description: "Clear all messages from the chat",
  category: "builtin",
  aliases: ["cls", "c"],
  execute: (_args: string, _context: CommandContext): CommandResult => {
    return {
      success: true,
      clearMessages: true,
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
      await context.session.summarize();

      // Clear visible messages after context compaction
      return {
        success: true,
        message: "Context compacted successfully.",
        clearMessages: true,
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
 *   (no args) - Show current model
 *   refresh   - Refresh models cache from models.dev
 *   list      - List available models
 *   <model>   - Switch to specified model
 */
export const modelCommand: CommandDefinition = {
  name: "model",
  description: "Switch or view the current model",
  category: "builtin",
  aliases: ["m"],
  execute: async (args: string, context: CommandContext): Promise<CommandResult> => {
    const { agentType, modelOps, state } = context;
    const trimmed = args.trim();

    // No args: show current model
    if (!trimmed) {
      const currentModel = await modelOps?.getCurrentModel();
      return {
        success: true,
        message: `Current model: **${currentModel ?? "No model set"}**`,
      };
    }

    const lowerTrimmed = trimmed.toLowerCase();

    // Refresh subcommand
    if (lowerTrimmed === "refresh") {
      await ModelsDev.refresh();
      return {
        success: true,
        message: "Models cache refreshed from models.dev",
      };
    }

    // List subcommand
    if (lowerTrimmed === "list" || lowerTrimmed.startsWith("list ")) {
      const providerFilter = lowerTrimmed.startsWith("list ")
        ? trimmed.substring(5).trim()
        : undefined;
      const models = await modelOps?.listAvailableModels();
      const dataSource = ModelsDev.getDataSource();
      
      // Handle offline mode with user-friendly message
      if (!models || models.length === 0) {
        if (dataSource === 'offline') {
          return {
            success: true,
            message: "⚠️ **No models available** - Running in offline mode.\n\nThe models.dev API is unavailable and no cached data exists.\nRun `/model refresh` when you have internet access to populate the models list.",
          };
        }
        return {
          success: true,
          message: "No models available.",
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
      
      // Add source indicator for non-API sources
      let sourceNote = "";
      if (dataSource === 'cache') {
        sourceNote = " *(from cache)*";
      } else if (dataSource === 'snapshot') {
        sourceNote = " *(from bundled snapshot - run `/model refresh` for latest)*";
      }
      
      return {
        success: true,
        message: `**Available Models** (via models.dev)${sourceNote}\n\n${lines.join("\n")}`,
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
