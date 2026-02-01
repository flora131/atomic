/**
 * Ralph Configuration Module
 *
 * Provides centralized configuration for the Ralph autonomous execution loop,
 * including feature flags and environment variable handling.
 *
 * Reference: Feature 32 - Add feature flag ATOMIC_USE_GRAPH_ENGINE for rollout
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Ralph execution configuration interface.
 *
 * This interface defines all configuration options for the Ralph loop,
 * including feature flags for execution mode selection.
 */
export interface RalphConfig {
  /**
   * Whether to use the graph-based execution engine.
   * When false, uses traditional hook-based execution.
   * Default: false during rollout phase, will become true in Phase 8.
   */
  useGraphEngine: boolean;

  /**
   * Maximum number of iterations for the loop.
   * 0 means unlimited (loop until completion or manual stop).
   */
  maxIterations: number;

  /**
   * Path to the feature list JSON file.
   * Default: "research/feature-list.json"
   */
  featureListPath: string;

  /**
   * Completion promise text that signals task completion.
   * When detected in output, the loop will exit.
   */
  completionPromise?: string;
}

/**
 * Options for loading Ralph configuration.
 */
export interface LoadRalphConfigOptions {
  /**
   * Override the graph engine flag.
   * If not provided, determined by ATOMIC_USE_GRAPH_ENGINE env var.
   */
  useGraphEngine?: boolean;

  /**
   * Override max iterations.
   */
  maxIterations?: number;

  /**
   * Override feature list path.
   */
  featureListPath?: string;

  /**
   * Override completion promise.
   */
  completionPromise?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Environment variable names for Ralph configuration.
 */
export const RALPH_ENV_VARS = {
  /**
   * Feature flag to enable graph-based execution engine.
   * Set to "true" to enable, any other value uses hook-based execution.
   *
   * During Phase 7 (current): Defaults to false for stability.
   * Phase 8 (future): Will default to true.
   */
  ATOMIC_USE_GRAPH_ENGINE: "ATOMIC_USE_GRAPH_ENGINE",
} as const;

/**
 * Default configuration values for Ralph.
 */
export const RALPH_DEFAULTS = {
  /** Default to hook-based execution during rollout */
  useGraphEngine: false,
  /** Unlimited iterations by default */
  maxIterations: 0,
  /** Default feature list path */
  featureListPath: "research/feature-list.json",
  /** Default progress file path */
  progressFilePath: "research/progress.txt",
} as const;

// ============================================================================
// SESSION-BASED FILE PATHS
// ============================================================================

/**
 * Generate a unique session ID for Ralph loop instances.
 * Uses timestamp + random suffix to ensure uniqueness.
 *
 * @returns A unique session ID like "sess_1706812800000_a1b2c3"
 */
export function generateRalphSessionId(): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `sess_${timestamp}_${randomSuffix}`;
}

/**
 * Session-aware file paths for Ralph.
 * When a sessionId is provided, file names include the session ID
 * to prevent conflicts when multiple Ralph loops run concurrently.
 */
export interface RalphSessionPaths {
  /** Path to feature list JSON file */
  featureListPath: string;
  /** Path to progress text file */
  progressFilePath: string;
  /** Path to Ralph state file (agent-specific) */
  stateFilePath: string;
}

/**
 * Agent-specific directory prefixes for Ralph state files.
 */
export const AGENT_STATE_DIRS: Record<string, string> = {
  claude: ".claude",
  opencode: ".opencode",
  copilot: ".github",
} as const;

/**
 * Generate session-aware file paths for Ralph.
 *
 * When sessionId is provided, generates unique file paths:
 * - feature-list.json → feature-list-{sessionId}.json
 * - progress.txt → progress-{sessionId}.txt
 * - ralph-loop.local.md → ralph-loop-{sessionId}.local.md
 *
 * When sessionId is not provided, returns default paths for backwards compatibility.
 *
 * @param agentType - The agent type (claude, opencode, copilot)
 * @param sessionId - Optional session ID for unique paths
 * @returns Session-aware file paths
 *
 * @example
 * ```typescript
 * // Default paths (backwards compatible)
 * const paths = getRalphSessionPaths("claude");
 * // { featureListPath: "research/feature-list.json", ... }
 *
 * // Session-specific paths
 * const sessionPaths = getRalphSessionPaths("claude", "sess_123_abc");
 * // { featureListPath: "research/feature-list-sess_123_abc.json", ... }
 * ```
 */
export function getRalphSessionPaths(
  agentType: string,
  sessionId?: string
): RalphSessionPaths {
  const stateDir = AGENT_STATE_DIRS[agentType] ?? ".claude";

  if (sessionId) {
    return {
      featureListPath: `research/feature-list-${sessionId}.json`,
      progressFilePath: `research/progress-${sessionId}.txt`,
      stateFilePath: `${stateDir}/ralph-loop-${sessionId}.local.md`,
    };
  }

  // Default paths for backwards compatibility
  return {
    featureListPath: RALPH_DEFAULTS.featureListPath,
    progressFilePath: RALPH_DEFAULTS.progressFilePath,
    stateFilePath: `${stateDir}/ralph-loop.local.md`,
  };
}

/**
 * Extract session ID from a session-specific file path.
 *
 * @param filePath - A file path that may contain a session ID
 * @returns The session ID if found, undefined otherwise
 *
 * @example
 * ```typescript
 * extractSessionId("research/feature-list-sess_123_abc.json")
 * // Returns: "sess_123_abc"
 *
 * extractSessionId("research/feature-list.json")
 * // Returns: undefined
 * ```
 */
export function extractSessionId(filePath: string): string | undefined {
  // Match pattern: -sess_<timestamp>_<random>. or -sess_<timestamp>_<random>$
  const match = filePath.match(/-(sess_\d+_[a-z0-9]+)(?:\.|$)/);
  return match?.[1];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if graph engine is enabled via environment variable.
 *
 * The graph engine is an experimental feature that provides:
 * - Structured workflow execution with defined nodes and edges
 * - Checkpointing for workflow resumption
 * - Context window monitoring with automatic session compaction
 * - Human-in-the-loop approvals for spec review
 *
 * @returns true if ATOMIC_USE_GRAPH_ENGINE=true, false otherwise
 *
 * @example
 * ```typescript
 * // Enable graph engine via environment
 * process.env.ATOMIC_USE_GRAPH_ENGINE = "true";
 *
 * if (isGraphEngineEnabled()) {
 *   return executeGraphWorkflow(options);
 * }
 * ```
 */
export function isGraphEngineEnabled(): boolean {
  return process.env[RALPH_ENV_VARS.ATOMIC_USE_GRAPH_ENGINE] === "true";
}

// ============================================================================
// MAIN CONFIGURATION LOADER
// ============================================================================

/**
 * Load Ralph configuration from environment and defaults.
 *
 * This function provides a centralized way to load Ralph configuration,
 * respecting environment variables and providing sensible defaults.
 *
 * **Environment Variables:**
 * - `ATOMIC_USE_GRAPH_ENGINE=true` - Enable graph-based execution
 *
 * @param options - Optional overrides for configuration values
 * @returns Complete Ralph configuration
 *
 * @example
 * ```typescript
 * // Load default configuration
 * const config = loadRalphConfig();
 *
 * // Load with overrides
 * const customConfig = loadRalphConfig({
 *   useGraphEngine: true, // Force graph engine
 *   maxIterations: 50,
 * });
 *
 * // Use in Ralph setup
 * if (config.useGraphEngine) {
 *   return executeGraphWorkflow(options);
 * }
 * ```
 */
export function loadRalphConfig(
  options: LoadRalphConfigOptions = {}
): RalphConfig {
  // Determine graph engine state (options override environment)
  const useGraphEngine = options.useGraphEngine ?? isGraphEngineEnabled();

  // Determine other settings (options override defaults)
  const maxIterations = options.maxIterations ?? RALPH_DEFAULTS.maxIterations;
  const featureListPath = options.featureListPath ?? RALPH_DEFAULTS.featureListPath;
  const completionPromise = options.completionPromise;

  return {
    useGraphEngine,
    maxIterations,
    featureListPath,
    completionPromise,
  };
}

/**
 * Create a descriptive summary of the Ralph configuration.
 *
 * Useful for logging or displaying to users what settings are active.
 *
 * @param config - Ralph configuration to describe
 * @returns Human-readable configuration summary
 */
export function describeRalphConfig(config: RalphConfig): string {
  const lines: string[] = [
    `Execution mode: ${config.useGraphEngine ? "graph engine" : "hook-based"}`,
    `Max iterations: ${config.maxIterations === 0 ? "unlimited" : config.maxIterations}`,
    `Feature list: ${config.featureListPath}`,
  ];

  if (config.completionPromise) {
    lines.push(`Completion promise: "${config.completionPromise}"`);
  }

  return lines.join("\n");
}
