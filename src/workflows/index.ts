/**
 * Workflows Module
 *
 * This module exports graph-based workflow definitions for the Atomic CLI.
 * Workflows are compiled graphs that implement specific automation patterns.
 *
 * Available Workflows:
 * - Atomic (Ralph) workflow: Full feature implementation cycle
 *
 * Session Management:
 * - RalphSession: Session state for Ralph loop execution
 * - RalphFeature: Feature definition for implementation tracking
 */

// Ralph session types and utilities
export {
  // Interfaces
  type RalphSession,
  type RalphFeature,

  // Factory functions
  generateSessionId,
  getSessionDir,
  createRalphSession,
  createRalphFeature,

  // Type guards
  isRalphSession,
  isRalphFeature,

  // File system operations
  SESSION_SUBDIRECTORIES,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
} from "./ralph-session.ts";

// Atomic workflow exports
export {
  // Main factory function
  createAtomicWorkflow,
  createTestAtomicWorkflow,

  // Configuration
  DEFAULT_MAX_ITERATIONS,
  ATOMIC_NODE_IDS,
  type AtomicWorkflowConfig,

  // State utilities
  createAtomicState,
  type AtomicWorkflowState,
  type Feature,

  // Node definitions (for testing/customization)
  researchNode,
  createSpecNode,
  reviewSpecNode,
  waitForApprovalNode,
  createFeatureListNode,
  selectFeatureNode,
  implementFeatureNode,
  checkFeaturesNode,
  createPRNode,

  // Helper functions
  extractTextContent,
  parseFeatureList,
  getNextFeature,
  checkAllFeaturesPassing,
} from "./atomic.ts";

// Ralph workflow exports
export {
  // Main factory function
  createRalphWorkflow,
  createTestRalphWorkflow,

  // Configuration
  RALPH_NODE_IDS,
  type CreateRalphWorkflowConfig,

  // State type
  type RalphWorkflowState,
} from "./ralph.ts";
