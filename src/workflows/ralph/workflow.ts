/**
 * Ralph Workflow Definition
 *
 * This module defines the graph-based workflow for the Ralph autonomous loop.
 * The Ralph workflow focuses on feature implementation without research/spec phases.
 *
 * Workflow:
 * 1. Initialize Ralph session
 * 2. Loop:
 *    a. Clear context (at start of each iteration to prevent overflow)
 *    b. Implement feature
 * 3. Check completion after loop exits
 *
 * The clearContextNode is placed at the start of EACH loop iteration to:
 * - Prevent context window overflow
 * - Start each iteration with fresh context
 * - Reduce token costs
 * - Reset conversation history while preserving state
 *
 * Reference: Feature - Implement createRalphWorkflow() function
 */

import type { CompiledGraph, GraphConfig } from "../../graph/types.ts";
import { graph, clearContextNode } from "../../graph/index.ts";
import { SessionDirSaver } from "../../graph/checkpointer.ts";
import {
  initRalphSessionNode,
  implementFeatureNode,
  checkCompletionNode,
  type RalphWorkflowState,
} from "../../graph/nodes/ralph-nodes.ts";
import { RALPH_CONFIG } from "../../config/ralph.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Node IDs for the Ralph workflow */
export const RALPH_NODE_IDS = {
  INIT_SESSION: "init-session",
  CLEAR_CONTEXT: "clear-context",
  IMPLEMENT_FEATURE: "implement-feature",
  CHECK_COMPLETION: "check-completion",
} as const;

// ============================================================================
// WORKFLOW CONFIGURATION
// ============================================================================

/**
 * Configuration options for creating the Ralph workflow.
 *
 * Note: autoApproveSpec is intentionally not included.
 * Spec approval should always be manual (handled in Atomic workflow).
 *
 * Checkpointing:
 * When enabled, checkpoints are saved to the session's checkpoints directory:
 * `.ralph/sessions/{sessionId}/checkpoints/`
 *
 * Checkpoints use sequential naming (node-001.json, node-002.json, etc.)
 * and include the full workflow state, allowing resumption from any checkpoint.
 */
export interface CreateRalphWorkflowConfig {
  /** Maximum iterations for the feature loop (default: 100) */
  maxIterations?: number;

  /**
   * Enable checkpointing for workflow resumption (default: true)
   *
   * When enabled, checkpoints are saved to:
   * `.ralph/sessions/{sessionId}/checkpoints/node-NNN.json`
   *
   * Each checkpoint includes the full workflow state.
   */
  checkpointing?: boolean;

  /** Feature list path (default: research/feature-list.json) */
  featureListPath?: string;

  /** Whether to run in yolo mode (no feature list) */
  yolo?: boolean;

  /** User prompt for yolo mode */
  userPrompt?: string;

  /** Additional graph configuration */
  graphConfig?: Partial<GraphConfig<RalphWorkflowState>>;
}

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Create the init session node for the Ralph workflow.
 */
function createInitNode(config: CreateRalphWorkflowConfig) {
  return initRalphSessionNode<RalphWorkflowState>({
    id: RALPH_NODE_IDS.INIT_SESSION,
    name: "Initialize Ralph Session",
    description: "Initialize or resume a Ralph session",
    featureListPath: config.featureListPath,
    yolo: config.yolo,
    userPrompt: config.userPrompt,
  });
}

/**
 * Create the clear context node for the loop.
 * Placed at the start of each loop iteration to prevent context overflow.
 */
function createClearNode() {
  return clearContextNode<RalphWorkflowState>({
    id: RALPH_NODE_IDS.CLEAR_CONTEXT,
    name: "Clear Context",
    description: "Clear context window at start of loop iteration",
    message: "Starting new iteration. Clearing context window to prevent overflow.",
  });
}

/**
 * Create the implement feature node.
 */
function createImplementNode(config: CreateRalphWorkflowConfig) {
  return implementFeatureNode<RalphWorkflowState>({
    id: RALPH_NODE_IDS.IMPLEMENT_FEATURE,
    name: "Implement Feature",
    description: "Implement the current feature from the feature list",
    prompt: config.userPrompt,
  });
}

/**
 * Create the check completion node.
 */
function createCheckNode() {
  return checkCompletionNode<RalphWorkflowState>({
    id: RALPH_NODE_IDS.CHECK_COMPLETION,
    name: "Check Completion",
    description: "Check if workflow should continue or exit",
  });
}

// ============================================================================
// WORKFLOW FACTORY
// ============================================================================

/**
 * Create the Ralph workflow graph.
 *
 * The workflow implements the Ralph loop:
 * 1. Initialize session (load or resume)
 * 2. Loop: Clear context -> Implement feature (until shouldContinue is false)
 * 3. Check completion after loop exits
 *
 * The clearContextNode is placed at the START of each loop iteration to:
 * - Prevent context window overflow
 * - Start each iteration with a fresh context
 * - Reduce token costs
 * - Reset conversation history while preserving state
 *
 * @param config - Optional workflow configuration
 * @returns Compiled graph ready for execution
 *
 * @example
 * ```typescript
 * // Basic usage
 * const workflow = createRalphWorkflow();
 * const result = await executeGraph(workflow, initialState);
 *
 * // With custom configuration
 * const workflow = createRalphWorkflow({
 *   maxIterations: 50,
 *   checkpointing: true,
 *   featureListPath: "specs/features.json",
 * });
 *
 * // Yolo mode (no feature list)
 * const yoloWorkflow = createRalphWorkflow({
 *   yolo: true,
 *   userPrompt: "Implement the authentication system",
 * });
 * ```
 */
export function createRalphWorkflow(
  config: CreateRalphWorkflowConfig = {}
): CompiledGraph<RalphWorkflowState> {
  // Apply defaults from RALPH_CONFIG
  const {
    maxIterations = RALPH_CONFIG.maxIterations,
    checkpointing = RALPH_CONFIG.checkpointing,
    featureListPath = "research/feature-list.json",
    yolo = false,
    userPrompt,
    graphConfig = {},
  } = config;

  // Create node instances with configuration
  const initNode = createInitNode({
    featureListPath,
    yolo,
    userPrompt,
  });
  const clearNode = createClearNode();
  const implementNode = createImplementNode({ userPrompt });
  const checkNode = createCheckNode();

  // Build the workflow graph
  // Sequence: init -> loop(clear, implement) -> check
  // The loop contains clearContextNode FIRST to clear context at the start
  // of each iteration, followed by implementFeatureNode
  const builder = graph<RalphWorkflowState>()
    // Phase 1: Initialize session
    .start(initNode)
    // Phase 2: Feature implementation loop with context clearing
    // clearContextNode runs at the START of each iteration to:
    // - Prevent context window overflow
    // - Start each iteration with fresh context
    // - Reduce token costs
    .loop(
      [clearNode, implementNode],
      {
        until: (state) => !state.shouldContinue,
        maxIterations,
      }
    )
    // Phase 3: Check completion after loop exits
    .then(checkNode)
    .end();

  // Compile with configuration
  // Use SessionDirSaver with dynamic checkpointDir based on session state
  // This saves checkpoints to .ralph/sessions/{sessionId}/checkpoints/
  // with sequential naming (node-001.json, node-002.json, etc.)
  const compiledConfig: GraphConfig<RalphWorkflowState> = {
    autoCheckpoint: checkpointing,
    checkpointer: checkpointing
      ? new SessionDirSaver<RalphWorkflowState>(
          (state) => state.ralphSessionDir
        )
      : undefined,
    contextWindowThreshold: 60,
    ...graphConfig,
  };

  return builder.compile(compiledConfig);
}

/**
 * Create a minimal Ralph workflow for testing.
 * Uses minimal iterations and disables checkpointing.
 *
 * @param options - Optional test configuration
 * @returns Compiled graph for testing
 */
export function createTestRalphWorkflow(
  options: Partial<CreateRalphWorkflowConfig> = {}
): CompiledGraph<RalphWorkflowState> {
  return createRalphWorkflow({
    maxIterations: 5,
    checkpointing: false,
    ...options,
  });
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

// Re-export types for convenience
export type { RalphWorkflowState } from "../../graph/nodes/ralph-nodes.ts";
