/**
 * Workflows Module
 *
 * This module exports workflow session management for the Atomic CLI.
 * Sessions are stored at ~/.atomic/workflows/sessions/{sessionId}/
 */

export {
  type WorkflowSession,
  WORKFLOW_SESSIONS_DIR,
  generateWorkflowSessionId,
  getWorkflowSessionDir,
  initWorkflowSession,
  saveWorkflowSession,
  saveSubagentOutput,
} from "./session.ts";
