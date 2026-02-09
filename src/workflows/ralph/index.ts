/**
 * Ralph Module
 *
 * This module provides the Ralph autonomous loop workflow for feature implementation.
 * It exports session management, workflow definition, and execution utilities.
 */

// Re-export TodoItem for use in tests and other modules
export { type TodoItem } from "../../sdk/tools/todo-write.ts";

// Session types and utilities
export {
  // Interfaces
  type RalphSession,

  // Factory functions
  generateSessionId,
  getSessionDir,
  createRalphSession,

  // Type guards
  isRalphSession,

  // File system operations
  SESSION_SUBDIRECTORIES,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
} from "./session.ts";

// Workflow definition
export {
  // Main factory function
  createRalphWorkflow,
  createTestRalphWorkflow,

  // Configuration
  RALPH_NODE_IDS,
  type CreateRalphWorkflowConfig,

  // State type
  type RalphWorkflowState,
} from "./workflow.ts";

// Executor
export {
  // Executor class
  RalphExecutor,
  createRalphExecutor,

  // Types
  type RalphExecutorRunOptions,
  type RalphExecutorResult,
} from "./executor.ts";
