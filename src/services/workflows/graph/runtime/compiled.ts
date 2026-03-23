/**
 * CompiledGraph execution state re-exports.
 *
 * The legacy GraphExecutor class and BFS execution engine have been removed.
 * All workflow execution now flows through WorkflowSessionConductor.
 *
 * State utilities (generateExecutionId, initializeExecutionState, isLoopNode,
 * mergeState) are preserved as they are used by the conductor and other
 * active code paths.
 */

export {
  generateExecutionId,
  initializeExecutionState,
  isLoopNode,
  mergeState,
} from "@/services/workflows/graph/runtime/execution-state.ts";
