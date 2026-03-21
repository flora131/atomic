/**
 * Workflows Module
 *
 * Unified barrel for the workflow engine. Re-exports:
 * - graph/: Core graph execution engine (builder, executor, nodes, streaming)
 * - session: Workflow session management
 * - ralph/: Ralph autonomous workflow definitions
 */

export {
  type WorkflowSession,
  WORKFLOW_SESSIONS_DIR,
  generateWorkflowSessionId,
  getWorkflowSessionDir,
  initWorkflowSession,
  saveWorkflowSession,
} from "@/services/workflows/session.ts";

export {
  buildTaskResultEnvelope,
  formatTaskResultEnvelopeText,
} from "@/services/workflows/task-result-envelope.ts";

// Graph execution engine
export * from "@/services/workflows/graph/index.ts";

// Ralph workflow
export * from "@/services/workflows/ralph/state.ts";
export * from "@/services/workflows/ralph/prompts.ts";
export * from "@/services/workflows/ralph/graph.ts";
