/**
 * State Annotation System for Graph Execution Engine
 *
 * This module provides a type-safe state annotation system that enables:
 * - Declarative state schema definitions with default values
 * - Customizable state reducers for merging updates
 * - Type inference for workflow state from annotations
 *
 * Inspired by LangGraph's annotation system for state management.
 *
 * Reference: Feature 10 - Create src/graph/annotation.ts with state annotation system
 */

import { join } from "path";
import { homedir } from "os";

import type { ContextWindowUsage, DebugReport, NodeId } from "./types.ts";
import type { ReviewResult, TaskItem } from "./nodes/ralph.ts";

// ============================================================================
// ANNOTATION TYPES
// ============================================================================

/**
 * Reducer function type for merging state values.
 * Takes the current value and an update, returns the new value.
 *
 * @template T - The type of value being reduced
 */
export type Reducer<T> = (current: T, update: T) => T;

/**
 * Definition of a single state annotation field.
 * Contains the default value and optional reducer for merging updates.
 *
 * @template T - The type of the annotated value
 */
export interface Annotation<T> {
  /** Default value for this field when initializing state */
  default: T | (() => T);
  /** Reducer function for merging updates (defaults to replace) */
  reducer?: Reducer<T>;
}

/**
 * Root type for combining multiple annotations into a state schema.
 * Each key maps to an Annotation definition.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnnotationRoot = Record<string, Annotation<any>>;

/**
 * Extract the value type from an Annotation.
 */
export type ValueOf<A> = A extends Annotation<infer T> ? T : never;

/**
 * Infer the state type from an AnnotationRoot schema.
 * Converts annotation definitions to their value types.
 */
export type StateFromAnnotation<A extends AnnotationRoot> = {
  [K in keyof A]: ValueOf<A[K]>;
};

// ============================================================================
// REDUCERS
// ============================================================================

/**
 * Built-in reducer functions for common state update patterns.
 */
export const Reducers = {
  /**
   * Replace the current value with the update (default behavior).
   * Always returns the new value.
   */
  replace: <T>(current: T, update: T): T => update,

  /**
   * Concatenate arrays.
   * If current is not an array, treats it as a single-element array.
   */
  concat: <T>(current: T[], update: T[]): T[] => {
    const currentArray = Array.isArray(current) ? current : [];
    const updateArray = Array.isArray(update) ? update : [];
    return [...currentArray, ...updateArray];
  },

  /**
   * Merge objects shallowly.
   * Update values override current values for the same keys.
   */
  merge: <T extends Record<string, unknown>>(current: T, update: Partial<T>): T => {
    return { ...current, ...update };
  },

  /**
   * Merge arrays by ID field.
   * Items with matching IDs are updated, new items are appended.
   *
   * @param idField - The field name to use as the unique identifier
   * @returns A reducer function for the array type
   */
  mergeById:
    <T extends object>(idField: keyof T): Reducer<T[]> =>
    (current: T[], update: T[]): T[] => {
      const currentArray = Array.isArray(current) ? current : [];
      const updateArray = Array.isArray(update) ? update : [];

      const idMap = new Map<unknown, T>();

      // Add all current items to the map
      for (const item of currentArray) {
        const id = item[idField];
        if (id !== undefined) {
          idMap.set(id, item);
        }
      }

      // Update or add items from the update array
      for (const item of updateArray) {
        const id = item[idField];
        if (id !== undefined) {
          const existing = idMap.get(id);
          if (existing) {
            // Merge the existing item with the update
            idMap.set(id, { ...existing, ...item });
          } else {
            // Add new item
            idMap.set(id, item);
          }
        }
      }

      return Array.from(idMap.values());
    },

  /**
   * Keep the maximum of two numbers.
   */
  max: (current: number, update: number): number => Math.max(current, update),

  /**
   * Keep the minimum of two numbers.
   */
  min: (current: number, update: number): number => Math.min(current, update),

  /**
   * Sum two numbers.
   */
  sum: (current: number, update: number): number => current + update,

  /**
   * Logical OR for booleans.
   */
  or: (current: boolean, update: boolean): boolean => current || update,

  /**
   * Logical AND for booleans.
   */
  and: (current: boolean, update: boolean): boolean => current && update,

  /**
   * Only update if the new value is not null/undefined.
   */
  ifDefined: <T>(current: T, update: T | null | undefined): T => {
    return update !== null && update !== undefined ? update : current;
  },
} as const;

// ============================================================================
// ANNOTATION FACTORY
// ============================================================================

/**
 * Create an annotation with a default value and optional reducer.
 *
 * @param defaultValue - The default value or a factory function
 * @param reducer - Optional reducer for merging updates (defaults to replace)
 * @returns An Annotation definition
 *
 * @example
 * ```typescript
 * const counterAnnotation = annotation(0, Reducers.sum);
 * const listAnnotation = annotation<string[]>([], Reducers.concat);
 * const configAnnotation = annotation({ enabled: true }, Reducers.merge);
 * ```
 */
export function annotation<T>(
  defaultValue: T | (() => T),
  reducer?: Reducer<T>
): Annotation<T> {
  return {
    default: defaultValue,
    reducer,
  };
}

/**
 * Get the default value from an annotation.
 * Handles both direct values and factory functions.
 */
export function getDefaultValue<T>(ann: Annotation<T>): T {
  if (typeof ann.default === "function") {
    return (ann.default as () => T)();
  }
  return ann.default;
}

/**
 * Apply a reducer to merge state values.
 * Falls back to replace if no reducer is defined.
 */
export function applyReducer<T>(ann: Annotation<T>, current: T, update: T): T {
  const reducer = ann.reducer ?? Reducers.replace;
  return reducer(current, update);
}

// ============================================================================
// STATE INITIALIZATION
// ============================================================================

/**
 * Initialize state from an annotation schema.
 * Creates a state object with all default values.
 *
 * @param schema - The annotation schema defining state fields
 * @returns A new state object with default values
 *
 * @example
 * ```typescript
 * const MyAnnotation = {
 *   counter: annotation(0),
 *   items: annotation<string[]>([]),
 * };
 *
 * const state = initializeState(MyAnnotation);
 * // { counter: 0, items: [] }
 * ```
 */
export function initializeState<A extends AnnotationRoot>(
  schema: A
): StateFromAnnotation<A> {
  const state: Record<string, unknown> = {};

  for (const [key, ann] of Object.entries(schema)) {
    state[key] = getDefaultValue(ann);
  }

  return state as StateFromAnnotation<A>;
}

/**
 * Apply a partial state update using annotation reducers.
 *
 * @param schema - The annotation schema defining state fields
 * @param current - The current state
 * @param update - Partial update to apply
 * @returns New state with updates applied
 *
 * @example
 * ```typescript
 * const newState = applyStateUpdate(
 *   MyAnnotation,
 *   currentState,
 *   { counter: 5, items: ['new item'] }
 * );
 * ```
 */
export function applyStateUpdate<A extends AnnotationRoot>(
  schema: A,
  current: StateFromAnnotation<A>,
  update: Partial<StateFromAnnotation<A>>
): StateFromAnnotation<A> {
  const newState = { ...current };

  for (const [key, value] of Object.entries(update)) {
    if (key in schema && schema[key] !== undefined) {
      const ann = schema[key]!;
      const currentValue = current[key as keyof StateFromAnnotation<A>];
      (newState as Record<string, unknown>)[key] = applyReducer(ann, currentValue, value);
    } else {
      // Allow updates to keys not in schema (for flexibility)
      (newState as Record<string, unknown>)[key] = value;
    }
  }

  return newState;
}

// ============================================================================
// ATOMIC WORKFLOW STATE ANNOTATION
// ============================================================================

/**
 * Feature entry in the feature list.
 */
export interface Feature {
  /** Category of the feature (e.g., functional, refactor, ui) */
  category: string;
  /** Description of what the feature does */
  description: string;
  /** Steps to implement the feature */
  steps: string[];
  /** Whether the feature has been implemented and passes tests */
  passes: boolean;
}

/**
 * Annotation schema for the Atomic workflow state.
 * Defines all fields needed for the Ralph loop and feature implementation.
 */
export const AtomicStateAnnotation = {
  // Base state fields (required by BaseState)
  executionId: annotation<string>(""),
  lastUpdated: annotation<string>(() => new Date().toISOString()),
  outputs: annotation<Record<NodeId, unknown>>({}),

  // Research and specification
  researchDoc: annotation<string>(""),
  specDoc: annotation<string>(""),
  specApproved: annotation<boolean>(false),

  // Feature list management
  featureList: annotation<Feature[]>([], Reducers.mergeById<Feature>("description")),
  currentFeature: annotation<Feature | null>(null),
  allFeaturesPassing: annotation<boolean>(false),

  // Debug and error tracking
  debugReports: annotation<DebugReport[]>([], Reducers.concat),

  // PR management
  prUrl: annotation<string | null>(null),

  // Context management
  contextWindowUsage: annotation<ContextWindowUsage | null>(null),

  // Iteration tracking
  iteration: annotation<number>(1),
};

/**
 * Type of the Atomic workflow state derived from annotations.
 */
export type AtomicWorkflowState = StateFromAnnotation<typeof AtomicStateAnnotation>;

/**
 * Create a new Atomic workflow state with default values.
 *
 * @param executionId - Unique ID for this execution (auto-generated if not provided)
 * @returns Initialized AtomicWorkflowState
 */
export function createAtomicState(executionId?: string): AtomicWorkflowState {
  const state = initializeState(AtomicStateAnnotation);
  return {
    ...state,
    executionId: executionId ?? crypto.randomUUID(),
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Apply an update to an Atomic workflow state.
 *
 * @param current - Current state
 * @param update - Partial update to apply
 * @returns New state with updates applied
 */
export function updateAtomicState(
  current: AtomicWorkflowState,
  update: Partial<AtomicWorkflowState>
): AtomicWorkflowState {
  const newState = applyStateUpdate(AtomicStateAnnotation, current, update);
  return {
    ...newState,
    lastUpdated: new Date().toISOString(),
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a valid Feature.
 */
export function isFeature(value: unknown): value is Feature {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.category === "string" &&
    typeof obj.description === "string" &&
    Array.isArray(obj.steps) &&
    typeof obj.passes === "boolean"
  );
}

/**
 * Type guard to check if a value is a valid AtomicWorkflowState.
 */
export function isAtomicWorkflowState(value: unknown): value is AtomicWorkflowState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.executionId === "string" &&
    typeof obj.lastUpdated === "string" &&
    typeof obj.outputs === "object" &&
    obj.outputs !== null &&
    typeof obj.researchDoc === "string" &&
    typeof obj.specDoc === "string" &&
    typeof obj.specApproved === "boolean" &&
    Array.isArray(obj.featureList) &&
    typeof obj.allFeaturesPassing === "boolean" &&
    Array.isArray(obj.debugReports) &&
    typeof obj.iteration === "number"
  );
}

// ============================================================================
// RALPH WORKFLOW STATE
// ============================================================================

/**
 * Ralph workflow state interface for the Ralph loop execution.
 *
 * This interface extends BaseState and includes all fields needed for
 * the Ralph autonomous feature implementation workflow. It combines:
 * - Base workflow state fields (executionId, lastUpdated, outputs)
 * - Research and specification tracking
 * - Feature list management
 * - Debug and error tracking
 * - PR management
 * - Context management
 * - Iteration tracking
 * - Ralph-specific session fields (yolo mode, session management)
 *
 * @example
 * ```typescript
 * const state: RalphWorkflowState = {
 *   executionId: "550e8400-e29b-41d4-a716-446655440000",
 *   lastUpdated: "2026-02-02T10:00:00.000Z",
 *   outputs: {},
 *   researchDoc: "# Research\n...",
 *   specDoc: "# Specification\n...",
 *   specApproved: true,
 *   featureList: [...],
 *   currentFeature: null,
 *   allFeaturesPassing: false,
 *   contextWindowUsage: null,
 *   iteration: 1,
 *   prUrl: null,
 *   debugReports: [],
 *   ralphSessionId: "abc123-def456",
 *   ralphSessionDir: "~/.atomic/workflows/sessions/abc123-def456",
 *   yolo: false,
 *   yoloPrompt: null,
 *   yoloComplete: false,
 *   maxIterations: 100,
 *   shouldContinue: true
 * };
 * ```
 */
export interface RalphWorkflowState {
  /** Unique identifier for this execution instance */
  executionId: string;

  /** ISO timestamp of last state update */
  lastUpdated: string;

  /** Map of node outputs keyed by node ID */
  outputs: Record<NodeId, unknown>;

  /** Research documentation content */
  researchDoc: string;

  /** Technical specification document content */
  specDoc: string;

  /** Whether the specification has been approved for implementation */
  specApproved: boolean;

  /** List of features to implement */
  featureList: Feature[];

  /** Currently active feature being implemented, or null */
  currentFeature: Feature | null;

  /** Whether all features have passed their tests */
  allFeaturesPassing: boolean;

  /** Current context window usage from agent sessions */
  contextWindowUsage: ContextWindowUsage | null;

  /** Current iteration number (increments each loop cycle) */
  iteration: number;

  /** URL of the pull request created by this workflow (if any) */
  prUrl: string | null;

  /** Array of debug reports generated during execution */
  debugReports: DebugReport[];

  // ============================================================================
  // RALPH-SPECIFIC SESSION FIELDS
  // ============================================================================

  /** Ralph session unique identifier (UUID v4) */
  ralphSessionId: string;

  /** Path to the Ralph session directory (e.g., "~/.atomic/workflows/sessions/{uuid}") */
  ralphSessionDir: string;

  /**
   * YOLO mode flag
   * - true: Run without a feature list (autonomous exploration with prompt)
   * - false: Follow the provided feature list
   */
  yolo: boolean;

  /** Prompt provided in yolo mode (null if not in yolo mode) */
  yoloPrompt: string | null;

  /** Whether yolo mode has completed (agent signaled COMPLETE) */
  yoloComplete: boolean;

  /** Maximum number of iterations before the workflow stops (0 = infinite) */
  maxIterations: number;

  /** Whether the workflow should continue to the next iteration */
  shouldContinue: boolean;

  /** Git branch name for this session's work (undefined if not set) */
  prBranch: string | undefined;

  /** Array of completed feature IDs */
  completedFeatures: string[];

  /** Path to the source feature-list.json file (undefined if in yolo mode) */
  sourceFeatureListPath: string | undefined;

  /** Maximum iterations reached flag (for loop exit condition) */
  maxIterationsReached: boolean | undefined;

  /** Structured task list generated by the decomposition phase */
  tasks: TaskItem[];

  /** Known task IDs from the decomposition phase */
  taskIds: Set<string>;

  /** Parsed reviewer output for the latest review phase */
  reviewResult: ReviewResult | null;

  /** Fix specification generated from reviewer findings */
  fixSpec: string;

  /** Current review cycle iteration */
  reviewIteration: number;

  /** Original user prompt for this Ralph execution */
  userPrompt: string;

  /** Number of consecutive empty decomposition outputs seen */
  decompositionRetryCount: number;
}

/**
 * Annotation schema for the Ralph workflow state.
 * Defines all fields needed for the Ralph loop with appropriate reducers.
 */
export const RalphStateAnnotation = {
  // Base state fields (required by BaseState)
  executionId: annotation<string>(""),
  lastUpdated: annotation<string>(() => new Date().toISOString()),
  outputs: annotation<Record<NodeId, unknown>>({}),

  // Research and specification
  researchDoc: annotation<string>(""),
  specDoc: annotation<string>(""),
  specApproved: annotation<boolean>(false),

  // Feature list management
  featureList: annotation<Feature[]>([], Reducers.mergeById<Feature>("description")),
  currentFeature: annotation<Feature | null>(null),
  allFeaturesPassing: annotation<boolean>(false),

  // Debug and error tracking
  debugReports: annotation<DebugReport[]>([], Reducers.concat),

  // PR management
  prUrl: annotation<string | null>(null),
  prBranch: annotation<string | undefined>(undefined),

  // Context management
  contextWindowUsage: annotation<ContextWindowUsage | null>(null),

  // Iteration tracking
  iteration: annotation<number>(1),

  // Ralph-specific session fields
  ralphSessionId: annotation<string>(""),
  ralphSessionDir: annotation<string>(""),
  yolo: annotation<boolean>(false),
  yoloPrompt: annotation<string | null>(null),
  yoloComplete: annotation<boolean>(false),
  maxIterations: annotation<number>(100),
  shouldContinue: annotation<boolean>(true),
  completedFeatures: annotation<string[]>([], Reducers.concat),
  sourceFeatureListPath: annotation<string | undefined>(undefined),
  maxIterationsReached: annotation<boolean | undefined>(undefined),
  tasks: annotation<TaskItem[]>([], Reducers.mergeById<TaskItem>("id")),
  taskIds: annotation<Set<string>>(new Set<string>(), Reducers.replace),
  reviewResult: annotation<ReviewResult | null>(null, Reducers.replace),
  fixSpec: annotation<string>("", Reducers.replace),
  reviewIteration: annotation<number>(0, Reducers.replace),
  userPrompt: annotation<string>("", Reducers.replace),
  decompositionRetryCount: annotation<number>(0, Reducers.replace),
};

/**
 * Create a new Ralph workflow state with default values.
 *
 * @param executionId - Unique ID for this execution (auto-generated if not provided)
 * @param options - Optional initial values for Ralph-specific fields
 * @returns Initialized RalphWorkflowState
 *
 * @example
 * ```typescript
 * // Create with defaults
 * const state = createRalphState();
 *
 * // Create with specific options
 * const state = createRalphState("my-exec-id", {
 *   yolo: true,
 *   yoloPrompt: "Build a snake game in Rust",
 *   maxIterations: 0
 * });
 * ```
 */
export function createRalphState(
  executionId?: string,
  options?: Partial<RalphWorkflowState>
): RalphWorkflowState {
  const state = initializeState(RalphStateAnnotation);
  const ralphSessionId = options?.ralphSessionId ?? crypto.randomUUID();

  return {
    ...state,
    executionId: executionId ?? crypto.randomUUID(),
    lastUpdated: new Date().toISOString(),
    ralphSessionId,
    ralphSessionDir: options?.ralphSessionDir ?? `${join(homedir(), ".atomic", "workflows", "sessions", ralphSessionId)}`,
    yolo: options?.yolo ?? false,
    yoloPrompt: options?.yoloPrompt ?? null,
    yoloComplete: options?.yoloComplete ?? false,
    maxIterations: options?.maxIterations ?? 100,
    shouldContinue: options?.shouldContinue ?? true,
    completedFeatures: options?.completedFeatures ?? [],
    sourceFeatureListPath: options?.sourceFeatureListPath,
    maxIterationsReached: options?.maxIterationsReached,
    tasks: options?.tasks ?? [],
    taskIds: options?.taskIds ?? new Set<string>(),
    reviewResult: options?.reviewResult ?? null,
    fixSpec: options?.fixSpec ?? "",
    reviewIteration: options?.reviewIteration ?? 0,
    userPrompt: options?.userPrompt ?? "",
    decompositionRetryCount: options?.decompositionRetryCount ?? 0,
    prBranch: options?.prBranch,
    ...options,
  };
}

/**
 * Apply an update to a Ralph workflow state.
 *
 * @param current - Current state
 * @param update - Partial update to apply
 * @returns New state with updates applied
 */
export function updateRalphState(
  current: RalphWorkflowState,
  update: Partial<RalphWorkflowState>
): RalphWorkflowState {
  const newState = applyStateUpdate(RalphStateAnnotation, current, update);
  return {
    ...newState,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Type guard to check if a value is a valid RalphWorkflowState.
 */
export function isRalphWorkflowState(value: unknown): value is RalphWorkflowState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    // Base state fields
    typeof obj.executionId === "string" &&
    typeof obj.lastUpdated === "string" &&
    typeof obj.outputs === "object" &&
    obj.outputs !== null &&
    // Atomic workflow fields
    typeof obj.researchDoc === "string" &&
    typeof obj.specDoc === "string" &&
    typeof obj.specApproved === "boolean" &&
    Array.isArray(obj.featureList) &&
    typeof obj.allFeaturesPassing === "boolean" &&
    Array.isArray(obj.debugReports) &&
    typeof obj.iteration === "number" &&
    // Ralph-specific fields
    typeof obj.ralphSessionId === "string" &&
    typeof obj.ralphSessionDir === "string" &&
    typeof obj.yolo === "boolean" &&
    typeof obj.maxIterations === "number" &&
    typeof obj.shouldContinue === "boolean" &&
    Array.isArray(obj.completedFeatures) &&
    Array.isArray(obj.tasks) &&
    obj.taskIds instanceof Set &&
    (typeof obj.reviewResult === "object" || obj.reviewResult === null) &&
    typeof obj.fixSpec === "string" &&
    typeof obj.reviewIteration === "number" &&
    typeof obj.userPrompt === "string" &&
    typeof obj.decompositionRetryCount === "number"
  );
}
