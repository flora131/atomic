/**
 * Workflows Module
 *
 * This module exports graph-based workflow definitions for the Atomic CLI.
 * Workflows are compiled graphs that implement specific automation patterns.
 *
 * Available Workflows:
 * - Ralph workflow: Autonomous feature implementation cycle
 *
 * Session Management:
 * - RalphSession: Session state for Ralph loop execution
 */

// Ralph module (session, workflow, executor)
export {
  // Session types
  type RalphSession,
  type TodoItem,

  // Session factory functions
  generateSessionId,
  getSessionDir,
  createRalphSession,

  // Session type guards
  isRalphSession,

  // Session file system operations
  SESSION_SUBDIRECTORIES,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,

  // Workflow factory functions
  createRalphWorkflow,
  createTestRalphWorkflow,

  // Workflow configuration
  RALPH_NODE_IDS,
  type CreateRalphWorkflowConfig,
  type RalphWorkflowState,

  // Executor
  RalphExecutor,
  createRalphExecutor,
  type RalphExecutorRunOptions,
  type RalphExecutorResult,
} from "./ralph/index.ts";
