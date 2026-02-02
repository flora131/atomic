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
// INIT RALPH SESSION NODE
// ============================================================================

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
