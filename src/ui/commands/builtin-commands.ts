/**
 * Built-in Commands for Chat UI
 *
 * Provides core slash commands for the chat interface:
 * /help, /status, /approve, /reject, /theme, /clear
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

    return {
      success: true,
      message: lines.join("\n").trim(),
    };
  },
};

/**
 * /status - Show current workflow progress and state.
 *
 * Displays:
 * - Workflow active state and type
 * - Current node being executed
 * - Iteration count and max
 * - Spec approval status
 * - Feature list progress
 * - Message count and streaming status
 */
export const statusCommand: CommandDefinition = {
  name: "status",
  description: "Show workflow progress and current state",
  category: "builtin",
  aliases: ["s"],
  execute: (_args: string, context: CommandContext): CommandResult => {
    const { state } = context;

    const lines: string[] = ["**Status**", ""];

    // Workflow state
    if (state.workflowActive) {
      lines.push(`Workflow: **${state.workflowType ?? "Unknown"}** (active)`);

      // Current node
      if (state.currentNode) {
        lines.push(`Phase: **${formatNodeName(state.currentNode)}**`);
      }

      // Iteration count
      if (state.iteration !== undefined && state.iteration > 0) {
        if (state.maxIterations !== undefined && state.maxIterations > 0) {
          lines.push(`Iteration: ${state.iteration}/${state.maxIterations}`);
        } else {
          lines.push(`Iteration: ${state.iteration}`);
        }
      }

      // Feature progress
      if (state.featureProgress) {
        const { completed, total, currentFeature } = state.featureProgress;
        const progressBar = createProgressBar(completed, total);
        lines.push(`Features: ${progressBar} (${completed}/${total})`);
        if (currentFeature) {
          // Truncate long feature names
          const maxLen = 40;
          const truncated = currentFeature.length > maxLen
            ? `${currentFeature.slice(0, maxLen - 3)}...`
            : currentFeature;
          lines.push(`  Current: ${truncated}`);
        }
      }
    } else {
      lines.push("Workflow: *inactive*");
    }

    // Spec approval status
    lines.push("");
    if (state.pendingApproval) {
      lines.push("Spec: **pending approval**");
      lines.push("  Use `/approve` or `/reject <feedback>` to continue");
    } else if (state.specApproved !== undefined) {
      lines.push(
        `Spec: ${state.specApproved ? "**approved**" : "**rejected**"}`
      );
      if (!state.specApproved && state.feedback) {
        lines.push(`  Feedback: ${state.feedback}`);
      }
    } else if (state.workflowActive) {
      lines.push("Spec: *not yet created*");
    }

    // Initial prompt
    if (state.initialPrompt) {
      lines.push("");
      lines.push(`Initial prompt: "${state.initialPrompt}"`);
    }

    // Message count and streaming
    lines.push("");
    lines.push(`Messages: ${state.messageCount}`);
    if (state.isStreaming) {
      lines.push("Status: *streaming response*");
    }

    return {
      success: true,
      message: lines.join("\n"),
    };
  },
};

/**
 * Format a node name for display (convert snake_case to Title Case).
 */
function formatNodeName(nodeName: string): string {
  return nodeName
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Create a simple ASCII progress bar.
 * @param completed - Number of completed items
 * @param total - Total number of items
 * @param width - Width of the progress bar (default 10)
 * @returns Progress bar string like "████░░░░░░"
 */
function createProgressBar(completed: number, total: number, width: number = 10): string {
  if (total <= 0) return "░".repeat(width);
  const filledCount = Math.round((completed / total) * width);
  const emptyCount = width - filledCount;
  return "█".repeat(filledCount) + "░".repeat(emptyCount);
}

/**
 * /approve - Approve the current spec.
 *
 * Sets specApproved to true and clears pending state.
 */
export const approveCommand: CommandDefinition = {
  name: "approve",
  description: "Approve the current spec to proceed with implementation",
  category: "builtin",
  aliases: ["ok", "yes"],
  execute: (_args: string, context: CommandContext): CommandResult => {
    if (!context.state.workflowActive) {
      return {
        success: false,
        message: "No active workflow. Start a workflow first.",
      };
    }

    if (!context.state.pendingApproval) {
      return {
        success: false,
        message: "No spec pending approval.",
      };
    }

    return {
      success: true,
      message: "Spec approved. Proceeding with implementation...",
      stateUpdate: {
        specApproved: true,
        pendingApproval: false,
        feedback: null,
      },
    };
  },
};

/**
 * /reject - Reject the current spec with optional feedback.
 *
 * Sets specApproved to false and stores feedback for revision.
 */
export const rejectCommand: CommandDefinition = {
  name: "reject",
  description: "Reject the current spec with feedback for revision",
  category: "builtin",
  aliases: ["no"],
  execute: (args: string, context: CommandContext): CommandResult => {
    if (!context.state.workflowActive) {
      return {
        success: false,
        message: "No active workflow. Start a workflow first.",
      };
    }

    if (!context.state.pendingApproval) {
      return {
        success: false,
        message: "No spec pending approval.",
      };
    }

    const feedback = args.trim() || null;

    return {
      success: true,
      message: feedback
        ? `Spec rejected with feedback: "${feedback}"\nRevising spec...`
        : "Spec rejected. Revising spec...",
      stateUpdate: {
        specApproved: false,
        pendingApproval: false,
        feedback,
      },
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

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * All built-in commands.
 */
export const builtinCommands: CommandDefinition[] = [
  helpCommand,
  statusCommand,
  approveCommand,
  rejectCommand,
  themeCommand,
  clearCommand,
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
