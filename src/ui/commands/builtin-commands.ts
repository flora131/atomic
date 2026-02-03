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

    const categoryOrder = ["builtin", "workflow", "skill", "custom"] as const;
    const categoryLabels: Record<string, string> = {
      builtin: "Built-in",
      workflow: "Workflows",
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
