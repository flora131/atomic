/**
 * Constants related to tool result size limits.
 *
 * These mirror the conventions used by the upstream Claude Code tool-result
 * storage mechanism (mehmoodosman/claude-code, `src/constants/toolLimits.ts`):
 * oversized tool results are persisted to disk and replaced in model context
 * with a short preview that references the saved file.
 */

/**
 * Default maximum size in characters for tool results before they get persisted
 * to disk. When exceeded, the result is saved to a file and the model receives
 * a preview with the file path instead of the full content.
 *
 * Individual tools may declare a lower cap, but this constant acts as a
 * system-wide ceiling regardless of what tools declare.
 */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/**
 * Maximum size for tool results in tokens. Based on analysis of tool result
 * sizes, this is a reasonable upper bound to prevent excessively large tool
 * results from consuming too much context (~400KB of text at ~4 bytes/token).
 */
export const MAX_TOOL_RESULT_TOKENS = 100_000;

/**
 * Bytes-per-token estimate for converting between byte size and token count.
 * Conservative estimate — actual token count may vary.
 */
export const BYTES_PER_TOKEN = 4;

/** Maximum size for tool results in bytes (derived from the token limit). */
export const MAX_TOOL_RESULT_BYTES = MAX_TOOL_RESULT_TOKENS * BYTES_PER_TOKEN;

/** Subdirectory (within the session directory) for persisted tool results. */
export const TOOL_RESULTS_SUBDIR = "tool-results";

/** XML tags wrapping a persisted-output preview message. */
export const PERSISTED_OUTPUT_TAG = "<persisted-output>";
export const PERSISTED_OUTPUT_CLOSING_TAG = "</persisted-output>";

/** Preview size in bytes shown inline in the persisted-output message. */
export const PREVIEW_SIZE_BYTES = 2000;
