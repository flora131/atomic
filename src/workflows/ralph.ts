/**
 * Ralph Workflow Definition
 *
 * This module defines the graph-based workflow for the Ralph autonomous loop.
 * Unlike the full Atomic workflow, the Ralph workflow is a simplified version
 * that focuses on feature implementation without the research/spec phases.
 *
 * Workflow:
 * 1. Initialize Ralph session
 * 2. Clear context (for fresh start)
 * 3. Loop: Implement feature (which handles check completion internally)
 * 4. Create pull request
 *
 * Reference: Feature - Implement createRalphWorkflow() function
 */

import type { CompiledGraph, GraphConfig } from "../graph/types.ts";
import { graph, clearContextNode } from "../graph/index.ts";
import { ResearchDirSaver } from "../graph/checkpointer.ts";
import {
  initRalphSessionNode,
  implementFeatureNode,
  checkCompletionNode,
  createPRNode,
  type RalphWorkflowState,
} from "../graph/nodes/ralph-nodes.ts";
import { RALPH_CONFIG } from "../config/ralph.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Node IDs for the Ralph workflow */
export const RALPH_NODE_IDS = {
  INIT_SESSION: "init-session",
  CLEAR_CONTEXT: "clear-context",
  IMPLEMENT_FEATURE: "implement-feature",
  CHECK_COMPLETION: "check-completion",
  CREATE_PR: "create-pr",
} as const;

// ============================================================================
// WORKFLOW CONFIGURATION
// ============================================================================

/**
 * Configuration options for creating the Ralph workflow.
 *
 * Note: autoApproveSpec is intentionally not included.
 * Spec approval should always be manual (handled in Atomic workflow).
 */
export interface CreateRalphWorkflowConfig {
  /** Maximum iterations for the feature loop (default: 100) */
  maxIterations?: number;

  /** Enable checkpointing for workflow resumption (default: true) */
  checkpointing?: boolean;

  /** Checkpoint directory (default: research/checkpoints) */
  checkpointDir?: string;

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

/**
 * Create the create PR node.
 */
function createPRNodeInstance() {
  return createPRNode<RalphWorkflowState>({
    id: RALPH_NODE_IDS.CREATE_PR,
    name: "Create Pull Request",
    description: "Create a pull request with session metadata",
  });
}

// ============================================================================
// WORKFLOW FACTORY
// ============================================================================

/**
 * Create the Ralph workflow graph.
 *
 * The workflow implements a simplified Ralph loop:
 * 1. Initialize session (load or resume)
 * 2. Clear context for fresh start
 * 3. Loop: Implement feature until shouldContinue is false
 * 4. Create pull request when done
 *
 * Note: The clearContextNode is placed before the loop to ensure
 * the first iteration starts with a fresh context. Subsequent iterations
 * rely on the implementFeatureNode to manage context appropriately.
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
    checkpointDir = "research/checkpoints",
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
  const prNode = createPRNodeInstance();

  // Build the workflow graph
  // Sequence: init -> clear -> loop(implement) -> check -> createPR
  // The loop contains only the implement node; check completion is
  // handled inside the implement node by setting shouldContinue
  const builder = graph<RalphWorkflowState>()
    // Phase 1: Initialize session
    .start(initNode)
    // Phase 2: Clear context before starting loop
    .then(clearNode)
    // Phase 3: Feature implementation loop
    // Loop until shouldContinue is false (set by checkCompletionNode logic in implement)
    .loop(
      implementNode,
      {
        until: (state) => !state.shouldContinue,
        maxIterations,
      }
    )
    // Phase 4: Check completion after loop exits
    .then(checkNode)
    // Phase 5: Create pull request
    .then(prNode)
    .end();

  // Compile with configuration
  const compiledConfig: GraphConfig<RalphWorkflowState> = {
    autoCheckpoint: checkpointing,
    checkpointer: checkpointing ? new ResearchDirSaver(checkpointDir) : undefined,
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
export type { RalphWorkflowState } from "../graph/nodes/ralph-nodes.ts";
