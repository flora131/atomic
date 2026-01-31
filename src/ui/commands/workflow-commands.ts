/**
 * Workflow Commands for Chat UI
 *
 * Registers workflow commands that start graph-based workflow executions.
 * Each workflow command creates a new workflow instance and updates the UI state.
 *
 * Reference: Feature 3 - Implement workflow command registration
 */

import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import { createAtomicWorkflow, type AtomicWorkflowConfig } from "../../workflows/atomic.ts";
import type { CompiledGraph } from "../../graph/types.ts";
import type { AtomicWorkflowState } from "../../graph/annotation.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metadata for a workflow command definition.
 */
export interface WorkflowMetadata {
  /** Command name (without leading slash) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Alternative names for the command */
  aliases?: string[];
  /** Function to create the workflow graph */
  createWorkflow: (config?: Record<string, unknown>) => CompiledGraph<AtomicWorkflowState>;
  /** Optional default configuration */
  defaultConfig?: Record<string, unknown>;
}

// ============================================================================
// WORKFLOW DEFINITIONS
// ============================================================================

/**
 * Available workflow definitions.
 *
 * Each entry defines a workflow command that can be invoked via slash command.
 */
export const WORKFLOW_DEFINITIONS: WorkflowMetadata[] = [
  {
    name: "atomic",
    description: "Start the Atomic (Ralph) workflow for feature implementation",
    aliases: ["ralph", "loop"],
    createWorkflow: (config?: Record<string, unknown>) => {
      const atomicConfig: AtomicWorkflowConfig = {
        maxIterations: typeof config?.maxIterations === "number" ? config.maxIterations : undefined,
        checkpointing: typeof config?.checkpointing === "boolean" ? config.checkpointing : true,
        autoApproveSpec: typeof config?.autoApproveSpec === "boolean" ? config.autoApproveSpec : false,
      };
      return createAtomicWorkflow(atomicConfig);
    },
    defaultConfig: {
      checkpointing: true,
      autoApproveSpec: false,
    },
  },
];

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a workflow.
 *
 * @param metadata - Workflow metadata
 * @returns Command definition for the workflow
 */
function createWorkflowCommand(metadata: WorkflowMetadata): CommandDefinition {
  return {
    name: metadata.name,
    description: metadata.description,
    category: "workflow",
    aliases: metadata.aliases,
    execute: (args: string, context: CommandContext): CommandResult => {
      // Check if already in a workflow
      if (context.state.workflowActive) {
        return {
          success: false,
          message: `A workflow is already active (${context.state.workflowType}). Use /status to check progress.`,
        };
      }

      // Extract the prompt from args
      const initialPrompt = args.trim() || null;

      if (!initialPrompt) {
        return {
          success: false,
          message: `Please provide a prompt for the ${metadata.name} workflow.\nUsage: /${metadata.name} <your task description>`,
        };
      }

      // Add a system message indicating workflow start
      context.addMessage(
        "system",
        `Starting **${metadata.name}** workflow...\n\nPrompt: "${initialPrompt}"`
      );

      // Return success with state updates
      return {
        success: true,
        message: `Workflow **${metadata.name}** initialized. Researching codebase...`,
        stateUpdate: {
          workflowActive: true,
          workflowType: metadata.name,
          initialPrompt,
          pendingApproval: false,
          specApproved: undefined,
          feedback: null,
        },
      };
    },
  };
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Workflow commands created from definitions.
 */
export const workflowCommands: CommandDefinition[] = WORKFLOW_DEFINITIONS.map(
  createWorkflowCommand
);

/**
 * Register all workflow commands with the global registry.
 *
 * Call this function during application initialization.
 *
 * @example
 * ```typescript
 * import { registerWorkflowCommands } from "./workflow-commands";
 *
 * // In app initialization
 * registerWorkflowCommands();
 * ```
 */
export function registerWorkflowCommands(): void {
  for (const command of workflowCommands) {
    // Skip if already registered (idempotent)
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}

/**
 * Get a workflow by name.
 *
 * @param name - Workflow name
 * @returns WorkflowMetadata if found, undefined otherwise
 */
export function getWorkflowMetadata(name: string): WorkflowMetadata | undefined {
  const lowerName = name.toLowerCase();
  return WORKFLOW_DEFINITIONS.find(
    (w) =>
      w.name.toLowerCase() === lowerName ||
      w.aliases?.some((a) => a.toLowerCase() === lowerName)
  );
}

/**
 * Create a workflow instance by name.
 *
 * @param name - Workflow name (or alias)
 * @param config - Optional workflow configuration
 * @returns Compiled workflow graph, or undefined if not found
 */
export function createWorkflowByName(
  name: string,
  config?: Record<string, unknown>
): CompiledGraph<AtomicWorkflowState> | undefined {
  const metadata = getWorkflowMetadata(name);
  if (!metadata) {
    return undefined;
  }
  return metadata.createWorkflow({ ...metadata.defaultConfig, ...config });
}
