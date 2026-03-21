/**
 * Workflow executor re-exports.
 *
 * The legacy executeWorkflow() function has been removed. All workflow execution
 * now flows through WorkflowSessionConductor (via conductor-executor.ts).
 */

/**
 * Result of a workflow execution.
 */
export interface WorkflowExecutionResult {
    success: boolean;
    message?: string;
    error?: Error;
}

export {
    compileGraphConfig,
    createSubagentRegistry,
    inferHasSubagentNodes,
    inferHasTaskList,
} from "./graph-helpers.ts";
