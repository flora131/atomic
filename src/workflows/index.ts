/**
 * Workflows Module
 *
 * This module exports graph-based workflow definitions for the Atomic CLI.
 * Workflows are compiled graphs that implement specific automation patterns.
 *
 * Available Workflows:
 * - Atomic (Ralph) workflow: Full feature implementation cycle
 */

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
