/**
 * Workflow Commands for Chat UI
 *
 * Registers workflow commands as slash commands invocable from the TUI.
 * The /ralph command implements a 3-step looping workflow:
 *   Step 1: Task list decomposition from user prompt
 *   Step 2: Agent dispatches worker sub-agents in a loop until all tasks complete
 *   Step 3: Review & Fix - code review and optional re-invocation with fix-spec
 *
 * Session state is persisted to tasks.json in the workflow session directory.
 */

import type {
    CommandDefinition,
    CommandContext,
    CommandResult,
} from "@/commands/tui/registry.ts";
import { globalRegistry } from "@/commands/tui/registry.ts";

import { executeConductorWorkflow } from "@/services/workflows/runtime/executor/conductor-executor.ts";
import {
    completeSession,
    getActiveSession,
    registerActiveSession,
    saveTasksToActiveSession,
} from "./session.ts";
import {
    CUSTOM_WORKFLOW_SEARCH_PATHS,
    discoverWorkflowFiles,
    extractWorkflowDefinition,
    getAllWorkflows,
    getBuiltinWorkflowDefinitions,
    loadWorkflowsFromDisk,
} from "./workflow-files.ts";
import {
    parseWorkflowArgs,
    type WorkflowCommandArgs,
    type WorkflowDefinition,
    type WorkflowMetadata,
} from "./types.ts";
import { watchTasksJson } from "./tasks-watcher.ts";
export {
    completeSession,
    CUSTOM_WORKFLOW_SEARCH_PATHS,
    discoverWorkflowFiles,
    extractWorkflowDefinition,
    getActiveSession,
    getAllWorkflows,
    loadWorkflowsFromDisk,
    parseWorkflowArgs,
    registerActiveSession,
    saveTasksToActiveSession,
    watchTasksJson,
};
export type {
    WorkflowCommandArgs,
    WorkflowDefinition,
    WorkflowGraphConfig,
    WorkflowMetadata,
    WorkflowStateMigrator,
    WorkflowStateParams,
} from "./types.ts";

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a workflow.
 * Handles conductor-based workflows and chat-based workflows.
 *
 * @param metadata - Workflow metadata (may be a full WorkflowDefinition)
 * @returns Command definition for the workflow
 */
function createWorkflowCommand(metadata: WorkflowMetadata): CommandDefinition {
    const definition = metadata as WorkflowDefinition;
    const hasExecutionLogic = definition.createState || definition.graphConfig || definition.createGraph;
    const hasConductorStages = definition.conductorStages && definition.conductorStages.length > 0;

    if (hasConductorStages && (definition.createConductorGraph || definition.createGraph || definition.graphConfig)) {
        // Conductor-based workflow — uses WorkflowSessionConductor for per-stage sessions
        return {
            name: metadata.name,
            description: metadata.description,
            category: "workflow",
            aliases: metadata.aliases,
            argumentHint: metadata.argumentHint,
            execute: async (
                args: string,
                context: CommandContext,
            ): Promise<CommandResult> => {
                if (context.state.workflowActive) {
                    return {
                        success: false,
                        message: `A workflow is already active (${context.state.workflowType}).`,
                    };
                }

                let parsed: WorkflowCommandArgs;
                try {
                    parsed = parseWorkflowArgs(args, metadata.name);
                } catch (e) {
                    return {
                        success: false,
                        message: e instanceof Error ? e.message : String(e),
                    };
                }

                return executeConductorWorkflow(definition, parsed.prompt, context, {
                    saveTasksToSession: saveTasksToActiveSession,
                });
            },
        };
    }

    if (hasExecutionLogic) {
        // Legacy graph-based workflow path — executor has been removed.
        // Workflows must define conductorStages to use the conductor path.
        return {
            name: metadata.name,
            description: metadata.description,
            category: "workflow",
            aliases: metadata.aliases,
            argumentHint: metadata.argumentHint,
            execute: (): CommandResult => ({
                success: false,
                message: `Workflow "${metadata.name}" uses the removed legacy graph executor. Add conductorStages to use the conductor path.`,
            }),
        };
    }

    // Chat-based workflow — simple state update, no graph execution
    return {
        name: metadata.name,
        description: metadata.description,
        category: "workflow",
        aliases: metadata.aliases,
        argumentHint: metadata.argumentHint,
        execute: (args: string, context: CommandContext): CommandResult => {
            if (context.state.workflowActive) {
                return {
                    success: false,
                    message: `A workflow is already active (${context.state.workflowType}). Check research/progress.txt for progress.`,
                };
            }

            const initialPrompt = args.trim() || null;

            if (!initialPrompt) {
                return {
                    success: false,
                    message: `Please provide a prompt for the ${metadata.name} workflow.\nUsage: /${metadata.name} <your task description>`,
                };
            }

            context.addMessage(
                "system",
                `Starting **${metadata.name}** workflow...\n\nPrompt: "${initialPrompt}"`,
            );

            return {
                success: true,
                message: `Workflow **${metadata.name}** initialized. Researching codebase...`,
                stateUpdate: {
                    workflowActive: true,
                    workflowType: metadata.name,
                    initialPrompt,
                },
            };
        },
    };
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Get workflow commands from all definitions (built-in + loaded from disk).
 * This function returns a fresh array each time, reflecting any dynamically loaded workflows.
 */
export function getWorkflowCommands(): CommandDefinition[] {
    return getAllWorkflows().map(createWorkflowCommand);
}

/**
 * Workflow commands created from built-in definitions.
 * Lazy — avoids eagerly compiling the Ralph workflow at module load time.
 * For dynamically loaded workflows, use getWorkflowCommands().
 */
export function workflowCommands(): CommandDefinition[] {
    return getBuiltinWorkflowDefinitions().map(createWorkflowCommand);
}

/**
 * Register all workflow commands with the global registry.
 * Includes both built-in and dynamically loaded workflows.
 *
 * Call this function during application initialization.
 * For best results, call loadWorkflowsFromDisk() first to discover custom workflows.
 *
 * @example
 * ```typescript
 * import { loadWorkflowsFromDisk, registerWorkflowCommands } from "@/commands/tui/workflow-commands.ts";
 *
 * // In app initialization
 * await loadWorkflowsFromDisk();
 * registerWorkflowCommands();
 * ```
 */
export function registerWorkflowCommands(): void {
    const commands = getWorkflowCommands();
    for (const command of commands) {
        // Skip if already registered (idempotent)
        if (!globalRegistry.has(command.name)) {
            globalRegistry.register(command);
        }
    }
}

/**
 * Get a workflow by name.
 * Searches all workflows (built-in + loaded from disk).
 *
 * @param name - Workflow name
 * @returns WorkflowMetadata if found, undefined otherwise
 */
export function getWorkflowMetadata(
    name: string,
): WorkflowMetadata | undefined {
    const lowerName = name.toLowerCase();
    return getAllWorkflows().find(
        (w) =>
            w.name.toLowerCase() === lowerName ||
            w.aliases?.some((a) => a.toLowerCase() === lowerName),
    );
}
