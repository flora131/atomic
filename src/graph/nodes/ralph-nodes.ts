/**
 * Ralph Node Factory Functions
 *
 * This module provides specialized graph nodes for the Ralph autonomous workflow.
 * Ralph sessions manage iterative feature implementation with checkpointing,
 * context window management, and progress tracking.
 *
 * Node types provided:
 * - initRalphSessionNode: Initialize or resume a Ralph session
 * - implementFeatureNode: Implement a feature from the feature list (or yolo mode)
 * - checkCompletionNode: Determine if the workflow should continue or exit
 * - createPRNode: Create a pull request with session metadata
 *
 * Reference: Feature 36 - Create src/graph/nodes/ralph-nodes.ts file
 */

import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
  RetryConfig,
  ContextWindowUsage,
} from "../types.ts";
import type {
  RalphSession,
  RalphFeature,
} from "../../workflows/ralph-session.ts";
import {
  generateSessionId,
  getSessionDir,
  createRalphSession,
  createRalphFeature,
  isRalphSession,
  isRalphFeature,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
} from "../../workflows/ralph-session.ts";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// CHECK COMPLETION NODE
// ============================================================================

/**
 * Configuration options for checkCompletionNode.
 */
export interface CheckCompletionNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;
}

/**
 * Create a node that checks if the Ralph workflow should continue or exit.
 *
 * This node handles:
 * - Checking if max iterations have been reached
 * - In yolo mode: checking if the agent signaled COMPLETE
 * - In feature-list mode: checking if all features are passing
 * - Updating session status to 'completed' when done
 * - Logging completion status
 *
 * The node should be placed at the end of each loop iteration to determine
 * if the workflow should continue or exit.
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for checking completion
 *
 * @example
 * ```typescript
 * // Create a completion check node
 * const checkNode = checkCompletionNode({
 *   id: "check-completion",
 *   name: "Check Completion",
 * });
 *
 * // Use in a workflow loop
 * graph<RalphWorkflowState>()
 *   .start(initNode)
 *   .loop({
 *     body: [implementNode, agentNode, processResultNode, checkNode],
 *     until: (state) => !state.shouldContinue,
 *   })
 *   .then(createPRNode)
 *   .compile();
 * ```
 */
export function checkCompletionNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: CheckCompletionNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "check-completion",
    description = "Check if the Ralph workflow should continue or exit",
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const state = ctx.state as RalphWorkflowState;
      const sessionDir = state.ralphSessionDir;
      const now = new Date().toISOString();

      // =========================================
      // CHECK MAX ITERATIONS
      // =========================================
      const maxIterationsReached =
        state.maxIterations > 0 && state.iteration >= state.maxIterations;

      // =========================================
      // YOLO MODE COMPLETION CHECK
      // =========================================
      if (state.yolo) {
        // In yolo mode, check if the agent signaled completion or session is already completed
        const isComplete = state.yoloComplete || state.sessionStatus === "completed";

        // Determine if we should continue
        const shouldContinue = !isComplete && !maxIterationsReached;

        // Log completion status
        await appendLog(sessionDir, "agent-calls", {
          action: "check-completion",
          sessionId: state.ralphSessionId,
          iteration: state.iteration,
          mode: "yolo",
          yoloComplete: state.yoloComplete,
          maxIterationsReached,
          shouldContinue,
        });

        // Log completion message if complete
        if (isComplete) {
          console.log("Task completed! Agent signaled COMPLETE.");
        } else if (maxIterationsReached) {
          console.log(`Max iterations (${state.maxIterations}) reached.`);
        }

        // Update session status if complete or max iterations reached
        let sessionStatus = state.sessionStatus;
        if (isComplete || maxIterationsReached) {
          sessionStatus = "completed";
        }

        // Build updated state
        const updatedState: Partial<RalphWorkflowState> = {
          yoloComplete: isComplete,
          maxIterationsReached,
          shouldContinue,
          sessionStatus,
          lastUpdated: now,
        };

        // Save session with updated state if completing
        if (!shouldContinue) {
          const session = workflowStateToSession({
            ...state,
            ...updatedState,
          } as RalphWorkflowState);
          await saveSession(sessionDir, session);
        }

        return {
          stateUpdate: updatedState as Partial<TState>,
        };
      }

      // =========================================
      // FEATURE-LIST MODE COMPLETION CHECK
      // =========================================

      // Check if all features are passing
      const allFeaturesPassing = state.features.every((f) => f.status === "passing");

      // Check if there are any pending features left
      const hasPendingFeatures = state.features.some((f) => f.status === "pending");

      // Check if there are any failing features
      const hasFailingFeatures = state.features.some((f) => f.status === "failing");

      // Determine if we should continue:
      // - Continue if there are pending features and we haven't hit max iterations
      // - Continue if there are failing features (they might need retry) and we haven't hit max iterations
      // - Stop if all features are passing
      // - Stop if max iterations reached
      const shouldContinue =
        !allFeaturesPassing && !maxIterationsReached && (hasPendingFeatures || hasFailingFeatures);

      // Log completion status
      await appendLog(sessionDir, "agent-calls", {
        action: "check-completion",
        sessionId: state.ralphSessionId,
        iteration: state.iteration,
        mode: "feature-list",
        totalFeatures: state.features.length,
        passingFeatures: state.features.filter((f) => f.status === "passing").length,
        pendingFeatures: state.features.filter((f) => f.status === "pending").length,
        failingFeatures: state.features.filter((f) => f.status === "failing").length,
        allFeaturesPassing,
        maxIterationsReached,
        shouldContinue,
      });

      // Log completion message
      if (allFeaturesPassing) {
        console.log("All features passing! Workflow complete.");
      } else if (maxIterationsReached) {
        console.log(`Max iterations (${state.maxIterations}) reached.`);
        const passing = state.features.filter((f) => f.status === "passing").length;
        const total = state.features.length;
        console.log(`Features completed: ${passing}/${total}`);
      }

      // Update session status if complete or max iterations reached
      let sessionStatus = state.sessionStatus;
      if (allFeaturesPassing || maxIterationsReached) {
        sessionStatus = "completed";
      }

      // Build updated state
      const updatedState: Partial<RalphWorkflowState> = {
        allFeaturesPassing,
        maxIterationsReached,
        shouldContinue,
        sessionStatus,
        lastUpdated: now,
      };

      // Save session with updated state if completing
      if (!shouldContinue) {
        const session = workflowStateToSession({
          ...state,
          ...updatedState,
        } as RalphWorkflowState);
        await saveSession(sessionDir, session);
      }

      return {
        stateUpdate: updatedState as Partial<TState>,
      };
    },
  };
}

// ============================================================================
// RALPH WORKFLOW STATE
// ============================================================================

/**
 * Extended workflow state for Ralph sessions.
 *
 * Combines the base graph state with Ralph-specific session fields.
 * This state is used by all Ralph nodes and persisted to session.json.
 *
 * @example
 * ```typescript
 * const state: RalphWorkflowState = {
 *   // BaseState fields
 *   executionId: "exec-123",
 *   lastUpdated: "2026-02-02T10:00:00.000Z",
 *   outputs: {},
 *
 *   // Ralph session fields
 *   ralphSessionId: "abc123-def456",
 *   ralphSessionDir: ".ralph/sessions/abc123-def456/",
 *   yolo: false,
 *   maxIterations: 50,
 *   features: [...],
 *   currentFeatureIndex: 2,
 *   completedFeatures: ["feat-001", "feat-002"],
 *   iteration: 15,
 *   sessionStatus: "running",
 *
 *   // Control flow flags
 *   shouldContinue: true,
 *   allFeaturesPassing: false,
 *   maxIterationsReached: false,
 *   yoloComplete: false
 * };
 * ```
 */
export interface RalphWorkflowState extends BaseState {
  // ========================================
  // Ralph Session Identity
  // ========================================

  /** Unique identifier for this Ralph session (UUID v4) */
  ralphSessionId: string;

  /** Path to the session directory (.ralph/sessions/{sessionId}/) */
  ralphSessionDir: string;

  // ========================================
  // Session Configuration
  // ========================================

  /**
   * YOLO mode flag
   * - true: Run without a feature list (autonomous exploration)
   * - false: Follow the provided feature list
   */
  yolo: boolean;

  /** Maximum number of iterations before stopping (0 = unlimited) */
  maxIterations: number;

  /** Path to the source feature-list.json file (if not in yolo mode) */
  sourceFeatureListPath?: string;

  /** User-provided prompt for yolo mode */
  userPrompt?: string;

  // ========================================
  // Feature Tracking
  // ========================================

  /** List of features to implement in this session */
  features: RalphFeature[];

  /** Index of the currently active feature in the features array */
  currentFeatureIndex: number;

  /** List of feature IDs that have been successfully completed */
  completedFeatures: string[];

  /** The feature currently being implemented (null if none) */
  currentFeature: RalphFeature | null;

  // ========================================
  // Execution Tracking
  // ========================================

  /** Current iteration number (increments each loop cycle) */
  iteration: number;

  /**
   * Current status of the Ralph session
   * - running: Actively processing features
   * - paused: Temporarily stopped, can be resumed
   * - completed: All features implemented or yolo complete
   * - failed: Session encountered an unrecoverable error
   */
  sessionStatus: "running" | "paused" | "completed" | "failed";

  // ========================================
  // Control Flow Flags
  // ========================================

  /** Whether the workflow loop should continue */
  shouldContinue: boolean;

  /** Whether all features in the list are passing */
  allFeaturesPassing: boolean;

  /** Whether maximum iterations have been reached */
  maxIterationsReached: boolean;

  /** Whether yolo mode has completed (agent output COMPLETE) */
  yoloComplete: boolean;

  // ========================================
  // PR Artifacts
  // ========================================

  /** URL of the pull request created by this session */
  prUrl?: string;

  /** Git branch name for this session's work */
  prBranch?: string;

  // ========================================
  // Context Tracking
  // ========================================

  /** Current context window usage from agent sessions */
  contextWindowUsage?: ContextWindowUsage;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a valid RalphWorkflowState.
 *
 * @param value - The value to check
 * @returns True if the value is a valid RalphWorkflowState
 */
export function isRalphWorkflowState(value: unknown): value is RalphWorkflowState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check BaseState fields
  if (
    typeof obj.executionId !== "string" ||
    typeof obj.lastUpdated !== "string" ||
    typeof obj.outputs !== "object" ||
    obj.outputs === null
  ) {
    return false;
  }

  // Check Ralph-specific fields
  return (
    typeof obj.ralphSessionId === "string" &&
    typeof obj.ralphSessionDir === "string" &&
    typeof obj.yolo === "boolean" &&
    typeof obj.maxIterations === "number" &&
    Array.isArray(obj.features) &&
    typeof obj.currentFeatureIndex === "number" &&
    Array.isArray(obj.completedFeatures) &&
    typeof obj.iteration === "number" &&
    ["running", "paused", "completed", "failed"].includes(obj.sessionStatus as string) &&
    typeof obj.shouldContinue === "boolean" &&
    typeof obj.allFeaturesPassing === "boolean" &&
    typeof obj.maxIterationsReached === "boolean" &&
    typeof obj.yoloComplete === "boolean"
  );
}

// ============================================================================
// STATE FACTORIES
// ============================================================================

/**
 * Options for creating a new RalphWorkflowState.
 */
export interface CreateRalphStateOptions {
  /** Execution ID for the graph execution (auto-generated if not provided) */
  executionId?: string;

  /** Session ID to resume from (auto-generated if not provided) */
  sessionId?: string;

  /** Whether to run in yolo mode (no feature list) */
  yolo?: boolean;

  /** Maximum iterations (default: 50, 0 = unlimited) */
  maxIterations?: number;

  /** Path to the source feature-list.json file */
  sourceFeatureListPath?: string;

  /** User prompt for yolo mode */
  userPrompt?: string;

  /** Initial features to load */
  features?: RalphFeature[];
}

/**
 * Create a new RalphWorkflowState with default values.
 *
 * @param options - Optional initial values
 * @returns A new RalphWorkflowState instance
 *
 * @example
 * ```typescript
 * // Create default state
 * const state = createRalphWorkflowState();
 *
 * // Create state for resuming a session
 * const resumeState = createRalphWorkflowState({
 *   sessionId: "existing-session-id"
 * });
 *
 * // Create state for yolo mode
 * const yoloState = createRalphWorkflowState({
 *   yolo: true,
 *   userPrompt: "Build a snake game in Rust"
 * });
 * ```
 */
export function createRalphWorkflowState(
  options: CreateRalphStateOptions = {}
): RalphWorkflowState {
  const sessionId = options.sessionId ?? generateSessionId();
  const now = new Date().toISOString();

  return {
    // BaseState fields
    executionId: options.executionId ?? crypto.randomUUID(),
    lastUpdated: now,
    outputs: {},

    // Ralph session identity
    ralphSessionId: sessionId,
    ralphSessionDir: getSessionDir(sessionId),

    // Session configuration
    yolo: options.yolo ?? false,
    maxIterations: options.maxIterations ?? 50,
    sourceFeatureListPath: options.sourceFeatureListPath,
    userPrompt: options.userPrompt,

    // Feature tracking
    features: options.features ?? [],
    currentFeatureIndex: 0,
    completedFeatures: [],
    currentFeature: null,

    // Execution tracking
    iteration: 1,
    sessionStatus: "running",

    // Control flow flags
    shouldContinue: true,
    allFeaturesPassing: false,
    maxIterationsReached: false,
    yoloComplete: false,

    // PR artifacts
    prUrl: undefined,
    prBranch: undefined,

    // Context tracking
    contextWindowUsage: undefined,
  };
}

/**
 * Convert a RalphSession to RalphWorkflowState.
 *
 * Used when resuming a session from disk.
 *
 * @param session - The session loaded from disk
 * @param executionId - New execution ID for this run
 * @returns A RalphWorkflowState populated from the session
 */
export function sessionToWorkflowState(
  session: RalphSession,
  executionId?: string
): RalphWorkflowState {
  const now = new Date().toISOString();

  return {
    // BaseState fields
    executionId: executionId ?? crypto.randomUUID(),
    lastUpdated: now,
    outputs: {},

    // Ralph session identity
    ralphSessionId: session.sessionId,
    ralphSessionDir: session.sessionDir,

    // Session configuration
    yolo: session.yolo,
    maxIterations: session.maxIterations,
    sourceFeatureListPath: session.sourceFeatureListPath,
    userPrompt: undefined,

    // Feature tracking
    features: session.features,
    currentFeatureIndex: session.currentFeatureIndex,
    completedFeatures: session.completedFeatures,
    currentFeature: session.features[session.currentFeatureIndex] ?? null,

    // Execution tracking
    iteration: session.iteration,
    sessionStatus: session.status,

    // Control flow flags
    shouldContinue: session.status === "running",
    allFeaturesPassing: session.features.every((f) => f.status === "passing"),
    maxIterationsReached: session.maxIterations > 0 && session.iteration >= session.maxIterations,
    yoloComplete: false,

    // PR artifacts
    prUrl: session.prUrl,
    prBranch: session.prBranch,

    // Context tracking
    contextWindowUsage: undefined,
  };
}

/**
 * Convert a RalphWorkflowState to a RalphSession for persistence.
 *
 * @param state - The workflow state
 * @returns A RalphSession for saving to disk
 */
export function workflowStateToSession(state: RalphWorkflowState): RalphSession {
  return {
    sessionId: state.ralphSessionId,
    sessionDir: state.ralphSessionDir,
    createdAt: state.lastUpdated, // Will be overwritten on load
    lastUpdated: new Date().toISOString(),
    yolo: state.yolo,
    maxIterations: state.maxIterations,
    sourceFeatureListPath: state.sourceFeatureListPath,
    features: state.features,
    currentFeatureIndex: state.currentFeatureIndex,
    completedFeatures: state.completedFeatures,
    iteration: state.iteration,
    status: state.sessionStatus,
    prUrl: state.prUrl,
    prBranch: state.prBranch,
  };
}

// ============================================================================
// EXPORT RE-EXPORTS FROM ralph-session.ts
// ============================================================================

// Re-export session management types and functions for convenience
export {
  // Types
  type RalphSession,
  type RalphFeature,

  // Functions
  generateSessionId,
  getSessionDir,
  createRalphSession,
  createRalphFeature,
  isRalphSession,
  isRalphFeature,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
};

// ============================================================================
// YOLO MODE CONSTANTS
// ============================================================================

/**
 * Completion instruction appended to yolo mode prompts.
 *
 * This instruction tells the agent to output "COMPLETE" when the task is finished.
 * The EXTREMELY_IMPORTANT tag ensures the agent pays attention to this instruction.
 */
export const YOLO_COMPLETION_INSTRUCTION = `

<EXTREMELY_IMPORTANT>
When you have COMPLETELY finished the task to the best of your ability, you MUST output the following on its own line:

COMPLETE

This signals that you are done with the task. Only output COMPLETE when you are truly finished.
If you encounter blockers, errors, or need more iterations, do NOT output COMPLETE.
Continue working until the task is genuinely complete, then output COMPLETE.
</EXTREMELY_IMPORTANT>
`;

/**
 * Check if agent output contains the completion signal.
 *
 * @param output - The agent's output text
 * @returns True if the output contains "COMPLETE" as a standalone word
 */
export function checkYoloCompletion(output: string): boolean {
  // Look for COMPLETE on its own line or as a standalone word
  return /\bCOMPLETE\b/.test(output);
}

// ============================================================================
// IMPLEMENT FEATURE NODE
// ============================================================================

/**
 * Configuration options for implementFeatureNode.
 */
export interface ImplementFeatureNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /** Optional: prompt template for implementing features */
  promptTemplate?: string;

  /** Optional: user prompt for yolo mode (can also come from state.userPrompt) */
  prompt?: string;
}

/**
 * Create a node that prepares state for implementing the next pending feature.
 *
 * This node handles:
 * - Finding the next feature with status 'pending'
 * - If no pending features, setting allFeaturesPassing: true
 * - Marking the feature as 'in_progress' and saving the session
 * - Logging the agent call to agent-calls.jsonl
 * - Preparing state for agent execution (actual agent call is handled by agentNode)
 *
 * The node should be followed by an agentNode that performs the actual implementation,
 * and then a node that processes the results using the outputMapper pattern.
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for implementing features
 *
 * @example
 * ```typescript
 * // Create a node for feature implementation
 * const implementNode = implementFeatureNode({
 *   id: "implement-feature",
 *   name: "Implement Next Feature",
 *   promptTemplate: "Implement the following feature: {{description}}",
 * });
 *
 * // Use in a workflow
 * graph<RalphWorkflowState>()
 *   .start(initNode)
 *   .then(implementNode)
 *   .then(agentNode)  // Actual agent execution
 *   .then(checkResultsNode)  // Process results
 *   .compile();
 * ```
 */
export function implementFeatureNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: ImplementFeatureNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "implement-feature",
    description = "Find and prepare the next pending feature for implementation",
    promptTemplate,
    prompt: configPrompt,
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const state = ctx.state as RalphWorkflowState;
      const sessionDir = state.ralphSessionDir;

      // =========================================
      // YOLO MODE EXECUTION
      // =========================================
      if (state.yolo) {
        // Get user prompt from config or state
        const userPrompt = configPrompt ?? state.userPrompt;

        if (!userPrompt) {
          throw new Error("Yolo mode requires a prompt");
        }

        // Append completion instruction to prompt
        const yoloPrompt = userPrompt + YOLO_COMPLETION_INSTRUCTION;

        // Log the yolo agent call
        await appendLog(sessionDir, "agent-calls", {
          action: "yolo",
          sessionId: state.ralphSessionId,
          iteration: state.iteration,
          yolo: true,
          promptLength: yoloPrompt.length,
        });

        // Return state with yolo prompt in outputs
        // The actual agent execution is handled by a separate agentNode
        return {
          stateUpdate: {
            shouldContinue: true,
            yoloComplete: false,
            lastUpdated: new Date().toISOString(),
            outputs: {
              ...state.outputs,
              [`${id}_prompt`]: yoloPrompt,
              [`${id}_yolo`]: true,
            },
          } as Partial<TState>,
        };
      }

      // =========================================
      // FEATURE-LIST MODE EXECUTION
      // =========================================

      // Find the next pending feature
      const pendingFeatureIndex = state.features.findIndex(
        (f) => f.status === "pending"
      );

      // If no pending features, all features are complete
      if (pendingFeatureIndex === -1) {
        // Check if all features are passing
        const allPassing = state.features.every((f) => f.status === "passing");

        // Log the completion check
        await appendLog(sessionDir, "agent-calls", {
          action: "implement-feature-check",
          sessionId: state.ralphSessionId,
          iteration: state.iteration,
          result: "no_pending_features",
          allFeaturesPassing: allPassing,
        });

        return {
          stateUpdate: {
            allFeaturesPassing: allPassing,
            shouldContinue: !allPassing, // Continue if there are failing features
            currentFeature: null,
            currentFeatureIndex: state.currentFeatureIndex,
            lastUpdated: new Date().toISOString(),
          } as Partial<TState>,
        };
      }

      // Get the pending feature (we know it exists since findIndex returned a valid index)
      const feature = state.features[pendingFeatureIndex]!;

      // Mark feature as in_progress
      const updatedFeatures = [...state.features];
      const inProgressFeature: RalphFeature = {
        id: feature.id,
        name: feature.name,
        description: feature.description,
        acceptanceCriteria: feature.acceptanceCriteria,
        status: "in_progress",
        implementedAt: feature.implementedAt,
        error: feature.error,
      };
      updatedFeatures[pendingFeatureIndex] = inProgressFeature;

      // Build the prompt for the agent if template is provided
      let agentPrompt: string | undefined;
      if (promptTemplate) {
        agentPrompt = promptTemplate
          .replace(/\{\{id\}\}/g, feature.id)
          .replace(/\{\{name\}\}/g, feature.name)
          .replace(/\{\{description\}\}/g, feature.description)
          .replace(
            /\{\{acceptanceCriteria\}\}/g,
            feature.acceptanceCriteria?.join("\n- ") ?? ""
          );
      }

      // Create updated state
      const updatedState: Partial<RalphWorkflowState> = {
        features: updatedFeatures,
        currentFeatureIndex: pendingFeatureIndex,
        currentFeature: inProgressFeature,
        shouldContinue: true,
        allFeaturesPassing: false,
        lastUpdated: new Date().toISOString(),
      };

      // Save the session with updated feature status
      const session = workflowStateToSession({
        ...state,
        ...updatedState,
      } as RalphWorkflowState);
      await saveSession(sessionDir, session);

      // Update the session's feature-list.json
      await saveSessionFeatureList(sessionDir, updatedFeatures);

      // Log the agent call
      await appendLog(sessionDir, "agent-calls", {
        action: "implement-feature-start",
        sessionId: state.ralphSessionId,
        iteration: state.iteration,
        featureId: feature.id,
        featureName: feature.name,
        featureIndex: pendingFeatureIndex,
        prompt: agentPrompt,
      });

      // Add the agent prompt to outputs if generated
      if (agentPrompt) {
        return {
          stateUpdate: {
            ...updatedState,
            outputs: {
              ...state.outputs,
              [`${id}_prompt`]: agentPrompt,
            },
          } as Partial<TState>,
        };
      }

      return {
        stateUpdate: updatedState as Partial<TState>,
      };
    },
  };
}

/**
 * Configuration for the output mapper after agent execution.
 * This is used by nodes that process the agent's implementation results.
 */
export interface ImplementFeatureOutputConfig {
  /** Function to check if the feature implementation passes (external check) */
  checkFeaturePassing?: (state: RalphWorkflowState) => Promise<boolean>;
}

/**
 * Process the results of a feature implementation agent call.
 *
 * This is a helper function that can be used in an outputMapper or as a
 * standalone processing step after agent execution.
 *
 * @param state - Current workflow state (after agent execution)
 * @param passed - Whether the feature implementation passes
 * @returns Updated state with feature results applied
 */
export async function processFeatureImplementationResult(
  state: RalphWorkflowState,
  passed: boolean
): Promise<Partial<RalphWorkflowState>> {
  const sessionDir = state.ralphSessionDir;
  const currentFeature = state.currentFeature;

  if (!currentFeature) {
    // No feature being implemented, return unchanged
    return {};
  }

  const featureIndex = state.currentFeatureIndex;
  const updatedFeatures = [...state.features];
  const now = new Date().toISOString();

  // Update feature status based on result
  if (passed) {
    updatedFeatures[featureIndex] = {
      ...currentFeature,
      status: "passing" as const,
      implementedAt: now,
    };
  } else {
    updatedFeatures[featureIndex] = {
      ...currentFeature,
      status: "failing" as const,
    };
  }

  // Build completed features list
  const completedFeatures = passed
    ? [...state.completedFeatures, currentFeature.id]
    : state.completedFeatures;

  // Increment iteration
  const nextIteration = state.iteration + 1;

  // Check if max iterations reached
  const maxIterationsReached =
    state.maxIterations > 0 && nextIteration >= state.maxIterations;

  // Build updated state
  const updatedState: Partial<RalphWorkflowState> = {
    features: updatedFeatures,
    completedFeatures,
    iteration: nextIteration,
    currentFeature: null,
    maxIterationsReached,
    shouldContinue: !maxIterationsReached,
    lastUpdated: now,
  };

  // Save session with updated state
  const session = workflowStateToSession({
    ...state,
    ...updatedState,
  } as RalphWorkflowState);
  await saveSession(sessionDir, session);

  // Update the session's feature-list.json
  await saveSessionFeatureList(sessionDir, updatedFeatures);

  // Append to progress.txt
  await appendProgress(sessionDir, currentFeature, passed);

  // Log the result
  await appendLog(sessionDir, "agent-calls", {
    action: "implement-feature-result",
    sessionId: state.ralphSessionId,
    iteration: state.iteration,
    featureId: currentFeature.id,
    featureName: currentFeature.name,
    passed,
    implementedAt: passed ? now : undefined,
    nextIteration,
    maxIterationsReached,
  });

  return updatedState;
}

/**
 * Process the results of a yolo mode agent call.
 *
 * This is a helper function that processes agent output in yolo mode,
 * checking for the COMPLETE signal and updating state accordingly.
 *
 * @param state - Current workflow state (after agent execution)
 * @param agentOutput - The agent's output text
 * @returns Updated state with yolo completion results applied
 */
export async function processYoloResult(
  state: RalphWorkflowState,
  agentOutput: string
): Promise<Partial<RalphWorkflowState>> {
  const sessionDir = state.ralphSessionDir;
  const now = new Date().toISOString();

  // Check if agent output contains COMPLETE
  const isComplete = checkYoloCompletion(agentOutput);

  // Increment iteration
  const nextIteration = state.iteration + 1;

  // Check if max iterations reached (0 means unlimited)
  const maxIterationsReached =
    state.maxIterations > 0 && nextIteration >= state.maxIterations;

  // Determine if we should continue
  // Stop if: complete OR max iterations reached
  const shouldContinue = !isComplete && !maxIterationsReached;

  // Build updated state
  const updatedState: Partial<RalphWorkflowState> = {
    iteration: nextIteration,
    yoloComplete: isComplete,
    maxIterationsReached,
    shouldContinue,
    sessionStatus: isComplete ? "completed" : state.sessionStatus,
    lastUpdated: now,
  };

  // Save session with updated state
  const session = workflowStateToSession({
    ...state,
    ...updatedState,
  } as RalphWorkflowState);
  await saveSession(sessionDir, session);

  // Create a pseudo-feature for progress tracking
  const yoloFeature: RalphFeature = {
    id: `yolo-iteration-${state.iteration}`,
    name: `Yolo Iteration ${state.iteration}`,
    description: "Yolo mode iteration",
    status: isComplete ? "passing" : "in_progress",
  };

  // Append to progress.txt
  await appendProgress(sessionDir, yoloFeature, isComplete);

  // Log the result
  await appendLog(sessionDir, "agent-calls", {
    action: "yolo-result",
    sessionId: state.ralphSessionId,
    iteration: state.iteration,
    yolo: true,
    isComplete,
    nextIteration,
    maxIterationsReached,
    shouldContinue,
    outputContainsComplete: isComplete,
  });

  // Log completion message if complete
  if (isComplete) {
    console.log("Task completed! Agent signaled COMPLETE.");
  } else if (maxIterationsReached) {
    console.log(`Max iterations (${state.maxIterations}) reached.`);
  }

  return updatedState;
}

// ============================================================================
// INIT RALPH SESSION NODE
// ============================================================================

/**
 * Feature list JSON structure from research/feature-list.json
 */
interface FeatureListJson {
  features: Array<{
    category: string;
    description: string;
    steps: string[];
    passes: boolean;
  }>;
}

/**
 * Configuration options for initRalphSessionNode.
 */
export interface InitRalphSessionNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /** Path to the feature list file (default: "research/feature-list.json") */
  featureListPath?: string;

  /** Whether to run in yolo mode (no feature list) */
  yolo?: boolean;

  /** Session ID to resume from (auto-generates new ID if not provided) */
  resumeSessionId?: string;

  /** Maximum iterations (default: 50, 0 = unlimited) */
  maxIterations?: number;

  /** User prompt for yolo mode */
  userPrompt?: string;
}

/**
 * Load features from a feature-list.json file and convert to RalphFeature format.
 *
 * @param featureListPath - Path to the feature-list.json file
 * @returns Array of RalphFeature objects
 */
async function loadFeaturesFromFile(featureListPath: string): Promise<RalphFeature[]> {
  if (!existsSync(featureListPath)) {
    throw new Error(`Feature list not found: ${featureListPath}`);
  }

  const content = await readFile(featureListPath, "utf-8");
  const featureList = JSON.parse(content) as FeatureListJson;

  if (!featureList.features || !Array.isArray(featureList.features)) {
    throw new Error(`Invalid feature list format in ${featureListPath}`);
  }

  // Convert feature-list.json format to RalphFeature format
  return featureList.features.map((f, index) => ({
    id: `feat-${String(index + 1).padStart(3, "0")}`,
    name: f.description.substring(0, 60), // Use first 60 chars of description as name
    description: f.description,
    acceptanceCriteria: f.steps,
    status: f.passes ? "passing" : "pending",
    implementedAt: f.passes ? new Date().toISOString() : undefined,
  } as RalphFeature));
}

/**
 * Initialize the session progress.txt file with a header.
 *
 * @param sessionDir - Path to the session directory
 * @param sessionId - Session ID
 * @param yolo - Whether the session is in yolo mode
 * @param featureCount - Number of features (0 for yolo mode)
 */
async function initializeProgressFile(
  sessionDir: string,
  sessionId: string,
  yolo: boolean,
  featureCount: number
): Promise<void> {
  const timestamp = new Date().toISOString();
  const mode = yolo ? "YOLO (freestyle)" : `Feature List (${featureCount} features)`;

  const header = `# Ralph Session Progress
# Session ID: ${sessionId}
# Started: ${timestamp}
# Mode: ${mode}
# ====================================

`;

  const progressPath = join(sessionDir, "progress.txt");
  await writeFile(progressPath, header, "utf-8");
}

/**
 * Copy features to the session's local feature-list.json.
 *
 * @param sessionDir - Path to the session directory
 * @param features - Features to save
 */
async function saveSessionFeatureList(
  sessionDir: string,
  features: RalphFeature[]
): Promise<void> {
  const featureListPath = join(sessionDir, "research", "feature-list.json");

  // Convert RalphFeature format back to feature-list.json format
  const featureList: FeatureListJson = {
    features: features.map((f) => ({
      category: "functional", // Default category
      description: f.description,
      steps: f.acceptanceCriteria ?? [],
      passes: f.status === "passing",
    })),
  };

  await writeFile(featureListPath, JSON.stringify(featureList, null, 2), "utf-8");
}

/**
 * Create a node that initializes or resumes a Ralph session.
 *
 * This node handles:
 * - Creating a new session with a unique ID
 * - Resuming an existing session from disk
 * - Loading features from a feature-list.json file
 * - Creating the session directory structure
 * - Initializing progress tracking files
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for initializing Ralph sessions
 *
 * @example
 * ```typescript
 * // Create a node for starting a new session
 * const initNode = initRalphSessionNode({
 *   id: "init-session",
 *   featureListPath: "research/feature-list.json",
 *   maxIterations: 100,
 * });
 *
 * // Create a node for resuming an existing session
 * const resumeNode = initRalphSessionNode({
 *   id: "resume-session",
 *   resumeSessionId: "abc123-def456",
 * });
 *
 * // Create a node for yolo mode
 * const yoloNode = initRalphSessionNode({
 *   id: "yolo-session",
 *   yolo: true,
 *   userPrompt: "Build a snake game in Rust",
 * });
 * ```
 */
export function initRalphSessionNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: InitRalphSessionNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "init-ralph-session",
    description = "Initialize or resume a Ralph session",
    featureListPath = "research/feature-list.json",
    yolo = false,
    resumeSessionId,
    maxIterations = 50,
    userPrompt,
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const sessionId = resumeSessionId ?? generateSessionId();
      const sessionDir = getSessionDir(sessionId);

      // Check if we're resuming an existing session
      if (resumeSessionId) {
        const existingSession = await loadSessionIfExists(sessionDir);

        if (existingSession) {
          // Resume existing session
          console.log(`Resuming Ralph session: ${sessionId}`);

          // Convert session to workflow state
          const resumedState = sessionToWorkflowState(existingSession, ctx.state.executionId);

          // Log the resume action
          await appendLog(sessionDir, "agent-calls", {
            action: "resume",
            sessionId,
            iteration: existingSession.iteration,
          });

          return {
            stateUpdate: {
              ...resumedState,
              lastUpdated: new Date().toISOString(),
            } as Partial<TState>,
          };
        } else {
          // Session not found, create new
          console.log(`Session ${sessionId} not found, creating new session`);
        }
      }

      // Create new session
      console.log(`Started Ralph session: ${sessionId}`);

      // Create session directory structure
      await createSessionDirectory(sessionId);

      // Load features if not in yolo mode
      let features: RalphFeature[] = [];
      if (!yolo) {
        features = await loadFeaturesFromFile(featureListPath);

        // Copy features to session directory
        await saveSessionFeatureList(sessionDir, features);
      }

      // Create the session state
      const newState = createRalphWorkflowState({
        executionId: ctx.state.executionId,
        sessionId,
        yolo,
        maxIterations,
        sourceFeatureListPath: yolo ? undefined : featureListPath,
        userPrompt,
        features,
      });

      // Initialize progress.txt with session header
      await initializeProgressFile(sessionDir, sessionId, yolo, features.length);

      // Save session.json
      const session = workflowStateToSession(newState);
      await saveSession(sessionDir, session);

      // Log the init action
      await appendLog(sessionDir, "agent-calls", {
        action: "init",
        sessionId,
        yolo,
        maxIterations,
        featureCount: features.length,
        sourceFeatureListPath: yolo ? undefined : featureListPath,
      });

      return {
        stateUpdate: {
          ...newState,
          lastUpdated: new Date().toISOString(),
        } as Partial<TState>,
      };
    },
  };
}

// ============================================================================
// CREATE PR NODE
// ============================================================================

/**
 * Default prompt template for creating a pull request.
 *
 * Placeholders:
 * - $SESSION_ID: The Ralph session ID
 * - $COMPLETED_FEATURES: JSON array of completed feature names
 * - $TOTAL_FEATURES: Total number of features
 * - $PASSING_FEATURES: Number of passing features
 * - $BASE_BRANCH: The base branch to merge into
 */
export const CREATE_PR_PROMPT = `
Create a pull request for the Ralph session $SESSION_ID.

## Completed Features
$COMPLETED_FEATURES

## Summary
- Total features: $TOTAL_FEATURES
- Passing features: $PASSING_FEATURES

## Instructions
1. Review the changes made during this session
2. Create a descriptive PR title summarizing the work done
3. Write a comprehensive PR description that:
   - Lists the features implemented
   - Describes any notable changes or decisions
   - Mentions any known issues or follow-up work needed
4. Create the PR targeting the $BASE_BRANCH branch
5. Return the PR URL

Use the gh CLI to create the PR:
\`\`\`bash
gh pr create --title "TITLE" --body "BODY" --base $BASE_BRANCH
\`\`\`

After creating the PR, output the PR URL on its own line in this format:
PR_URL: https://github.com/...
`;

/**
 * Configuration options for createPRNode.
 */
export interface CreatePRNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /** Base branch to merge into (default: "main") */
  baseBranch?: string;

  /** Custom title template (supports $SESSION_ID, $FEATURE_COUNT placeholders) */
  titleTemplate?: string;

  /** Custom PR prompt (overrides CREATE_PR_PROMPT) */
  promptTemplate?: string;
}

/**
 * Extract PR URL from agent output.
 *
 * Looks for patterns like:
 * - PR_URL: https://github.com/...
 * - https://github.com/.../pull/123
 *
 * @param output - The agent's output text
 * @returns The PR URL if found, undefined otherwise
 */
export function extractPRUrl(output: string): string | undefined {
  // First, try to find explicit PR_URL marker
  const prUrlMatch = output.match(/PR_URL:\s*(https:\/\/[^\s]+)/i);
  if (prUrlMatch) {
    return prUrlMatch[1];
  }

  // Fall back to finding any GitHub PR URL
  const githubPrMatch = output.match(/(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/);
  if (githubPrMatch) {
    return githubPrMatch[1];
  }

  return undefined;
}

/**
 * Extract branch name from agent output or git.
 *
 * @param output - The agent's output text
 * @returns The branch name if found, undefined otherwise
 */
export function extractBranchName(output: string): string | undefined {
  // Look for branch name patterns in output
  const branchMatch = output.match(/branch[:\s]+['"]?([a-zA-Z0-9/_-]+)['"]?/i);
  if (branchMatch) {
    return branchMatch[1];
  }

  return undefined;
}

/**
 * Create a node that creates a pull request with session metadata.
 *
 * This node handles:
 * - Building a PR prompt with completed features summary
 * - Preparing state for agent to create the PR
 * - Extracting PR URL from agent output (via processCreatePRResult)
 * - Updating session with PR metadata
 * - Marking the session as completed
 *
 * Note: The actual PR creation is performed by an agent node that follows
 * this node. Use processCreatePRResult() to handle the agent's output.
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for creating pull requests
 *
 * @example
 * ```typescript
 * // Create a PR node
 * const prNode = createPRNode({
 *   id: "create-pr",
 *   baseBranch: "main",
 *   titleTemplate: "feat: Ralph session $SESSION_ID",
 * });
 *
 * // Use in a workflow after all features are implemented
 * graph<RalphWorkflowState>()
 *   .start(initNode)
 *   .loop({ ... })
 *   .then(prNode)
 *   .then(agentNode)  // Agent creates the actual PR
 *   .then(processResultNode)  // Process PR result
 *   .compile();
 * ```
 */
export function createPRNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: CreatePRNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "create-pr",
    description = "Create a pull request with session metadata",
    baseBranch = "main",
    titleTemplate,
    promptTemplate = CREATE_PR_PROMPT,
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const state = ctx.state as RalphWorkflowState;
      const sessionDir = state.ralphSessionDir;
      const now = new Date().toISOString();

      // Build completed features list
      const completedFeatures = state.features
        .filter((f) => f.status === "passing")
        .map((f) => f.name);

      const totalFeatures = state.features.length;
      const passingFeatures = completedFeatures.length;

      // Build the PR prompt with placeholders replaced
      let prPrompt = promptTemplate
        .replace(/\$SESSION_ID/g, state.ralphSessionId)
        .replace(/\$COMPLETED_FEATURES/g, JSON.stringify(completedFeatures, null, 2))
        .replace(/\$TOTAL_FEATURES/g, String(totalFeatures))
        .replace(/\$PASSING_FEATURES/g, String(passingFeatures))
        .replace(/\$BASE_BRANCH/g, baseBranch);

      // Build title if template provided
      let prTitle: string | undefined;
      if (titleTemplate) {
        prTitle = titleTemplate
          .replace(/\$SESSION_ID/g, state.ralphSessionId)
          .replace(/\$FEATURE_COUNT/g, String(passingFeatures));
      }

      // Log the PR creation action
      await appendLog(sessionDir, "agent-calls", {
        action: "create-pr-start",
        sessionId: state.ralphSessionId,
        iteration: state.iteration,
        baseBranch,
        completedFeatures: completedFeatures.length,
        totalFeatures,
        titleTemplate: prTitle,
      });

      // Return state with PR prompt in outputs
      // The actual PR creation is handled by a separate agentNode
      return {
        stateUpdate: {
          lastUpdated: now,
          outputs: {
            ...state.outputs,
            [`${id}_prompt`]: prPrompt,
            [`${id}_baseBranch`]: baseBranch,
            ...(prTitle ? { [`${id}_title`]: prTitle } : {}),
          },
        } as Partial<TState>,
      };
    },
  };
}

/**
 * Process the results of a PR creation agent call.
 *
 * This is a helper function that extracts the PR URL from agent output,
 * updates session state, and marks the session as completed.
 *
 * @param state - Current workflow state (after agent execution)
 * @param agentOutput - The agent's output text
 * @returns Updated state with PR metadata
 */
export async function processCreatePRResult(
  state: RalphWorkflowState,
  agentOutput: string
): Promise<Partial<RalphWorkflowState>> {
  const sessionDir = state.ralphSessionDir;
  const now = new Date().toISOString();

  // Extract PR URL from agent output
  const prUrl = extractPRUrl(agentOutput);
  const prBranch = extractBranchName(agentOutput);

  // Build updated state
  const updatedState: Partial<RalphWorkflowState> = {
    prUrl,
    prBranch,
    sessionStatus: "completed",
    shouldContinue: false,
    lastUpdated: now,
  };

  // Save session with updated state
  const session = workflowStateToSession({
    ...state,
    ...updatedState,
  } as RalphWorkflowState);
  await saveSession(sessionDir, session);

  // Append final completion to progress.txt
  const completedCount = state.features.filter((f) => f.status === "passing").length;
  const totalCount = state.features.length;

  // Create a pseudo-feature for the PR completion
  const prFeature: RalphFeature = {
    id: "session-complete",
    name: `Session Complete (${completedCount}/${totalCount} features)`,
    description: prUrl ? `PR: ${prUrl}` : "Session completed",
    status: prUrl ? "passing" : "failing",
  };
  await appendProgress(sessionDir, prFeature, !!prUrl);

  // Log the PR result
  await appendLog(sessionDir, "agent-calls", {
    action: "create-pr-result",
    sessionId: state.ralphSessionId,
    iteration: state.iteration,
    prUrl,
    prBranch,
    success: !!prUrl,
    completedFeatures: completedCount,
    totalFeatures: totalCount,
  });

  // Log completion message
  if (prUrl) {
    console.log(`Pull request created: ${prUrl}`);
  } else {
    console.log("Session completed (no PR URL extracted from output)");
  }

  return updatedState;
}
