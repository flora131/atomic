/**
 * Ralph Workflow Definition
 *
 * Consolidates Ralph's metadata, graph config, state factory, and node descriptions
 * into a single WorkflowDefinition object for the workflow registry.
 */

import type { WorkflowDefinition, WorkflowStateParams } from "../../ui/commands/workflow-commands.ts";
import { createRalphState } from "./state.ts";
import { VERSION } from "../../version.ts";

/**
 * Node descriptions for Ralph workflow progress UI.
 * Extracted from the hardcoded getNodePhaseDescription() function.
 * Maps node IDs to human-readable progress descriptions.
 */
export const ralphNodeDescriptions: Record<string, string> = {
    planner: "⌕ Planning: Analyzing requirements and decomposing into tasks...",
    "parse-tasks": "☰ Parsing: Extracting task structure from plan...",
    "select-ready-tasks": "◎ Selecting: Identifying ready tasks for execution...",
    worker: "⚙ Working: Implementing assigned task...",
    reviewer: "◉ Reviewing: Evaluating completed work...",
    fixer: "⚒ Fixing: Applying review feedback...",
};

/**
 * Factory function to create Ralph workflow state.
 * Wraps createRalphState() with the standard WorkflowStateParams interface.
 *
 * @param params - Standard workflow state parameters
 * @returns Initialized RalphWorkflowState
 */
function createRalphWorkflowState(params: WorkflowStateParams) {
    return createRalphState(params.sessionId, {
        yoloPrompt: params.prompt,
        ralphSessionId: params.sessionId,
        ralphSessionDir: params.sessionDir,
        maxIterations: params.maxIterations,
    });
}

/**
 * Complete workflow definition for Ralph.
 * Consolidates metadata, state factory, and node descriptions.
 *
 * Note: Ralph uses createRalphWorkflow() for its compiled graph (builder pattern),
 * so no graphConfig is provided. The graphConfig field is for user-defined workflows
 * that provide declarative config.
 */
export const ralphWorkflowDefinition: WorkflowDefinition = {
    name: "ralph",
    description: "Start autonomous implementation workflow",
    aliases: ["loop"],
    version: "1.0.0",
    minSDKVersion: VERSION,
    stateVersion: 1,
    argumentHint: '"<prompt-or-spec-path>"',
    source: "builtin",

    // Execution logic
    createState: createRalphWorkflowState,
    nodeDescriptions: ralphNodeDescriptions,
};
