/**
 * Ralph Configuration Module
 *
 * Provides centralized configuration for the Ralph autonomous execution loop.
 * The graph engine is the only execution mode (hook-based execution was removed).
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Ralph execution configuration interface.
 *
 * This interface defines all configuration options for the Ralph loop.
 */
export interface RalphConfig {
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
 * Note: ATOMIC_USE_GRAPH_ENGINE was removed - graph engine is now the only mode.
 */
export const RALPH_ENV_VARS = {} as const;

/**
 * Default configuration values for Ralph.
 */
export const RALPH_DEFAULTS = {
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
// MAIN CONFIGURATION LOADER
// ============================================================================

/**
 * Load Ralph configuration from defaults and optional overrides.
 *
 * This function provides a centralized way to load Ralph configuration,
 * providing sensible defaults.
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
 *   maxIterations: 50,
 * });
 * ```
 */
export function loadRalphConfig(
  options: LoadRalphConfigOptions = {}
): RalphConfig {
  // Determine settings (options override defaults)
  const maxIterations = options.maxIterations ?? RALPH_DEFAULTS.maxIterations;
  const featureListPath = options.featureListPath ?? RALPH_DEFAULTS.featureListPath;
  const completionPromise = options.completionPromise;

  return {
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
    `Max iterations: ${config.maxIterations === 0 ? "unlimited" : config.maxIterations}`,
    `Feature list: ${config.featureListPath}`,
  ];

  if (config.completionPromise) {
    lines.push(`Completion promise: "${config.completionPromise}"`);
  }

  return lines.join("\n");
}
