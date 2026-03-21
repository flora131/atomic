/**
 * Ralph Workflow Definition
 *
 * Consolidates Ralph's metadata, graph config, state factory, and node descriptions
 * into a single WorkflowDefinition object for the workflow registry.
 */

import type { WorkflowDefinition, WorkflowStateParams } from "@/services/workflows/types/index.ts";
import { createRalphState } from "@/services/workflows/ralph/state.ts";
import { createRalphConductorGraph } from "@/services/workflows/ralph/conductor-graph.ts";
import { VERSION } from "@/version.ts";
import { RALPH_STAGES } from "@/services/workflows/ralph/stages.ts";

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
    "prepare-fix-tasks": "☰ Planning Fixes: Converting review findings into fix tasks...",
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
 * Consolidates metadata, conductor graph, state factory, and node descriptions.
 *
 * Ralph uses the conductor-based executor with per-stage sessions defined
 * by RALPH_STAGES. The legacy createRalphWorkflow() graph builder has been
 * removed — see createConductorGraph below.
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

    // Conductor stages — enables the conductor-based executor
    conductorStages: RALPH_STAGES,
    createConductorGraph: createRalphConductorGraph,
};
