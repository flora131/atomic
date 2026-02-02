/**
 * Ralph Session Types and Interfaces
 *
 * This module defines the core interfaces for Ralph loop session management.
 * A Ralph session tracks the state of an autonomous feature implementation
 * workflow, including feature progress, iteration counts, and session metadata.
 *
 * Sessions are persisted to disk in the .ralph/sessions/{sessionId}/ directory
 * structure, enabling session resumption and progress tracking.
 *
 * Reference: Feature list - Create src/workflows/ralph-session.ts
 */

// ============================================================================
// RALPH FEATURE INTERFACE
// ============================================================================

/**
 * Represents a single feature to be implemented by the Ralph loop.
 *
 * Features are the atomic units of work in a Ralph session. Each feature
 * has a lifecycle: pending -> in_progress -> passing/failing
 *
 * @example
 * ```typescript
 * const feature: RalphFeature = {
 *   id: "feat-001",
 *   name: "Add user authentication",
 *   description: "Implement JWT-based authentication",
 *   acceptanceCriteria: [
 *     "Users can register with email/password",
 *     "Users can login and receive a JWT token",
 *     "Protected routes require valid JWT"
 *   ],
 *   status: "pending"
 * };
 * ```
 */
export interface RalphFeature {
  /** Unique identifier for the feature (e.g., "feat-001", UUID) */
  id: string;

  /** Short, descriptive name of the feature */
  name: string;

  /** Detailed description of what the feature should accomplish */
  description: string;

  /** List of criteria that must be met for the feature to be considered complete */
  acceptanceCriteria?: string[];

  /**
   * Current status of the feature in the implementation lifecycle
   * - pending: Not yet started
   * - in_progress: Currently being implemented
   * - passing: Implemented and tests pass
   * - failing: Implementation attempted but tests fail
   */
  status: "pending" | "in_progress" | "passing" | "failing";

  /** ISO 8601 timestamp when the feature was successfully implemented */
  implementedAt?: string;

  /** Error message if the feature is in failing status */
  error?: string;
}

// ============================================================================
// RALPH SESSION INTERFACE
// ============================================================================

/**
 * Represents a Ralph loop session with all state needed for execution and resumption.
 *
 * A session encapsulates the entire state of a Ralph loop execution, including:
 * - Session identity and metadata (id, timestamps, directory)
 * - Configuration (yolo mode, max iterations, source feature list)
 * - Feature tracking (list, current index, completed features)
 * - Execution state (iteration count, status)
 * - Output artifacts (PR URL and branch)
 *
 * Sessions are persisted to .ralph/sessions/{sessionId}/ for resumption.
 *
 * @example
 * ```typescript
 * const session: RalphSession = {
 *   sessionId: "abc123-def456",
 *   sessionDir: ".ralph/sessions/abc123-def456/",
 *   createdAt: "2026-02-02T10:00:00.000Z",
 *   lastUpdated: "2026-02-02T10:30:00.000Z",
 *   yolo: false,
 *   maxIterations: 50,
 *   sourceFeatureListPath: "research/feature-list.json",
 *   features: [...],
 *   currentFeatureIndex: 2,
 *   completedFeatures: ["feat-001", "feat-002"],
 *   iteration: 15,
 *   status: "running",
 *   prBranch: "feature/my-feature"
 * };
 * ```
 */
export interface RalphSession {
  /** Unique identifier for this session (UUID v4) */
  sessionId: string;

  /** Path to the session directory (e.g., ".ralph/sessions/{sessionId}/") */
  sessionDir: string;

  /** ISO 8601 timestamp when the session was created */
  createdAt: string;

  /** ISO 8601 timestamp when the session was last updated */
  lastUpdated: string;

  /**
   * YOLO mode flag
   * - true: Run without a feature list (autonomous exploration)
   * - false: Follow the provided feature list
   */
  yolo: boolean;

  /** Maximum number of iterations before the session stops */
  maxIterations: number;

  /** Path to the source feature-list.json file (if not in yolo mode) */
  sourceFeatureListPath?: string;

  /** List of features to implement in this session */
  features: RalphFeature[];

  /** Index of the currently active feature in the features array */
  currentFeatureIndex: number;

  /** List of feature IDs that have been successfully completed */
  completedFeatures: string[];

  /** Current iteration number (increments each loop cycle) */
  iteration: number;

  /**
   * Current status of the session
   * - running: Actively processing features
   * - paused: Temporarily stopped, can be resumed
   * - completed: All features implemented successfully
   * - failed: Session encountered an unrecoverable error
   */
  status: "running" | "paused" | "completed" | "failed";

  /** URL of the pull request created by this session (if any) */
  prUrl?: string;

  /** Git branch name for this session's work */
  prBranch?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique session ID using crypto.randomUUID().
 *
 * @returns A UUID v4 string for use as a session identifier
 *
 * @example
 * ```typescript
 * const sessionId = generateSessionId();
 * // "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Get the session directory path for a given session ID.
 *
 * @param sessionId - The session ID
 * @returns The path to the session directory
 *
 * @example
 * ```typescript
 * const dir = getSessionDir("abc123");
 * // ".ralph/sessions/abc123/"
 * ```
 */
export function getSessionDir(sessionId: string): string {
  return `.ralph/sessions/${sessionId}/`;
}

/**
 * Create a new RalphSession with default values.
 *
 * @param options - Optional initial values for the session
 * @returns A new RalphSession instance
 *
 * @example
 * ```typescript
 * const session = createRalphSession({
 *   yolo: false,
 *   maxIterations: 100,
 *   sourceFeatureListPath: "research/feature-list.json"
 * });
 * ```
 */
export function createRalphSession(
  options: Partial<RalphSession> = {}
): RalphSession {
  const sessionId = options.sessionId ?? generateSessionId();
  const now = new Date().toISOString();

  return {
    sessionId,
    sessionDir: options.sessionDir ?? getSessionDir(sessionId),
    createdAt: options.createdAt ?? now,
    lastUpdated: options.lastUpdated ?? now,
    yolo: options.yolo ?? false,
    maxIterations: options.maxIterations ?? 50,
    sourceFeatureListPath: options.sourceFeatureListPath,
    features: options.features ?? [],
    currentFeatureIndex: options.currentFeatureIndex ?? 0,
    completedFeatures: options.completedFeatures ?? [],
    iteration: options.iteration ?? 1,
    status: options.status ?? "running",
    prUrl: options.prUrl,
    prBranch: options.prBranch,
  };
}

/**
 * Create a new RalphFeature with default values.
 *
 * @param options - Required and optional values for the feature
 * @returns A new RalphFeature instance
 *
 * @example
 * ```typescript
 * const feature = createRalphFeature({
 *   id: "feat-001",
 *   name: "Add login",
 *   description: "Implement user login functionality"
 * });
 * ```
 */
export function createRalphFeature(
  options: Pick<RalphFeature, "id" | "name" | "description"> &
    Partial<RalphFeature>
): RalphFeature {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    acceptanceCriteria: options.acceptanceCriteria,
    status: options.status ?? "pending",
    implementedAt: options.implementedAt,
    error: options.error,
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a valid RalphFeature.
 *
 * @param value - The value to check
 * @returns True if the value is a valid RalphFeature
 */
export function isRalphFeature(value: unknown): value is RalphFeature {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.description === "string" &&
    (obj.acceptanceCriteria === undefined ||
      Array.isArray(obj.acceptanceCriteria)) &&
    ["pending", "in_progress", "passing", "failing"].includes(
      obj.status as string
    ) &&
    (obj.implementedAt === undefined || typeof obj.implementedAt === "string") &&
    (obj.error === undefined || typeof obj.error === "string")
  );
}

/**
 * Type guard to check if a value is a valid RalphSession.
 *
 * @param value - The value to check
 * @returns True if the value is a valid RalphSession
 */
export function isRalphSession(value: unknown): value is RalphSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.sessionId === "string" &&
    typeof obj.sessionDir === "string" &&
    typeof obj.createdAt === "string" &&
    typeof obj.lastUpdated === "string" &&
    typeof obj.yolo === "boolean" &&
    typeof obj.maxIterations === "number" &&
    (obj.sourceFeatureListPath === undefined ||
      typeof obj.sourceFeatureListPath === "string") &&
    Array.isArray(obj.features) &&
    typeof obj.currentFeatureIndex === "number" &&
    Array.isArray(obj.completedFeatures) &&
    typeof obj.iteration === "number" &&
    ["running", "paused", "completed", "failed"].includes(obj.status as string) &&
    (obj.prUrl === undefined || typeof obj.prUrl === "string") &&
    (obj.prBranch === undefined || typeof obj.prBranch === "string")
  );
}
