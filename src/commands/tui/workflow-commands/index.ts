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

import { writeFile } from "fs/promises";
import type {
    CommandDefinition,
    CommandContext,
    CommandResult,
} from "@/commands/tui/registry.ts";
import { globalRegistry } from "@/commands/tui/registry.ts";
import type { TodoItem } from "@/services/agents/tools/todo-write.ts";
import type { WorkflowRuntimeFeatureFlagOverrides } from "@/services/workflows/runtime-contracts.ts";

import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import { initWorkflowSession } from "@/services/workflows/session.ts";
import type { WorkflowSession } from "@/services/agent-discovery/index.ts";
import { executeWorkflow } from "@/services/workflows/executor.ts";
import {
    completeSession,
    getActiveSession,
    registerActiveSession,
    saveTasksToActiveSession,
} from "./session.ts";
import {
    CUSTOM_WORKFLOW_SEARCH_PATHS,
    discoverWorkflowFiles,
    getAllWorkflows,
    getBuiltinWorkflowDefinitions,
    loadWorkflowsFromDisk,
} from "./workflow-files.ts";
import {
    parseWorkflowArgs,
    parseRalphArgs,
    type RalphCommandArgs,
    type WorkflowCommandArgs,
    type WorkflowDefinition,
    type WorkflowMetadata,
} from "./types.ts";
import { watchTasksJson } from "./tasks-watcher.ts";
export {
    completeSession,
    CUSTOM_WORKFLOW_SEARCH_PATHS,
    discoverWorkflowFiles,
    getActiveSession,
    getAllWorkflows,
    loadWorkflowsFromDisk,
    parseRalphArgs,
    parseWorkflowArgs,
    registerActiveSession,
    saveTasksToActiveSession,
    watchTasksJson,
};
export type {
    RalphCommandArgs,
    WorkflowCommandArgs,
    WorkflowDefinition,
    WorkflowGraphConfig,
    WorkflowMetadata,
    WorkflowStateMigrator,
    WorkflowStateParams,
    WorkflowTask,
} from "./types.ts";

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a workflow.
 * Handles both graph-based workflows (via executeWorkflow) and chat-based workflows.
 *
 * @param metadata - Workflow metadata (may be a full WorkflowDefinition)
 * @returns Command definition for the workflow
 */
function createWorkflowCommand(metadata: WorkflowMetadata): CommandDefinition {
    const definition = metadata as WorkflowDefinition;
    const hasExecutionLogic = definition.createState || definition.graphConfig || definition.createGraph;

    if (hasExecutionLogic) {
        // Graph-based workflow — use executeWorkflow() for full lifecycle
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

                return executeWorkflow(definition, parsed.prompt, context, {
                    saveTasksToSession: saveTasksToActiveSession,
                    eventBus: context.eventBus,
                });
            },
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
 * Get workflow commands from all definitions (built-in + loaded from disk).
 * This function returns a fresh array each time, reflecting any dynamically loaded workflows.
 */
export function getWorkflowCommands(): CommandDefinition[] {
    return getAllWorkflows().map(createWorkflowCommand);
}

/**
 * Workflow commands created from built-in definitions.
 * For dynamically loaded workflows, use getWorkflowCommands().
 */
export const workflowCommands: CommandDefinition[] =
    getBuiltinWorkflowDefinitions().map(createWorkflowCommand);

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
