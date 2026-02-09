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
import { BACKGROUND_COMPACTION_THRESHOLD } from "../../graph/types.ts";
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
  /** Enable checkpointing for workflow resumption (default: true) */
  checkpointing?: boolean;

  /** User prompt */
  userPrompt?: string;

  /** Session ID to resume */
  resumeSessionId?: string;

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
    userPrompt: config.userPrompt,
    resumeSessionId: config.resumeSessionId,
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
    message: "Starting new iteration. Context cleared; read tasks.json and progress.txt to resume.",
  });
}

/**
 * Create the implement feature node.
 */
function createImplementNode(_config: CreateRalphWorkflowConfig) {
  return implementFeatureNode<RalphWorkflowState>({
    id: RALPH_NODE_IDS.IMPLEMENT_FEATURE,
    name: "Implement Feature",
    description: "Implement the next available task from the task list",
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
 * // With user prompt
 * const workflow = createRalphWorkflow({
 *   userPrompt: "Implement the authentication system",
 *   checkpointing: true,
 * });
 *
 * // Resume a session
 * const resumed = createRalphWorkflow({
 *   resumeSessionId: "abc-123",
 * });
 * ```
 */
export function createRalphWorkflow(
  config: CreateRalphWorkflowConfig = {}
): CompiledGraph<RalphWorkflowState> {
  const {
    checkpointing = RALPH_CONFIG.checkpointing,
    userPrompt,
    resumeSessionId,
    graphConfig = {},
  } = config;

  const initNode = createInitNode({ userPrompt, resumeSessionId });
  const clearNode = createClearNode();
  const implementNode = createImplementNode(config);
  const checkNode = createCheckNode();

  const builder = graph<RalphWorkflowState>()
    .start(initNode)
    .loop(
      [clearNode, implementNode],
      {
        until: (state) => !state.shouldContinue,
        // No maxIterations — loop until shouldContinue returns false (deterministic termination)
      }
    )
    .then(checkNode)
    .end();

  const compiledConfig: GraphConfig<RalphWorkflowState> = {
    autoCheckpoint: checkpointing,
    checkpointer: checkpointing
      ? new SessionDirSaver<RalphWorkflowState>(
          (state) => state.ralphSessionDir
        )
      : undefined,
    contextWindowThreshold: BACKGROUND_COMPACTION_THRESHOLD * 100,
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
    checkpointing: false,
    ...options,
  });
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

// Re-export types for convenience
export type { RalphWorkflowState } from "../../graph/nodes/ralph-nodes.ts";
