/**
 * Spinner Verbs Constants
 *
 * Configurable array of spinner verbs for the loading indicator.
 * These verbs are contextually appropriate for AI assistant actions.
 * One is randomly selected when LoadingIndicator mounts.
 *
 * Reference: Task #2 - Create spinner verbs constants
 */

// ============================================================================
// SPINNER VERBS
// ============================================================================

/**
 * Array of spinner verbs for the loading indicator.
 * These verbs are contextually appropriate for AI assistant actions.
 * Used by LoadingIndicator component to show varied activity messages.
 */
export const SPINNER_VERBS: readonly string[] = [
  "Thinking",
  "Analyzing",
  "Processing",
  "Reasoning",
  "Considering",
  "Evaluating",
  "Formulating",
  "Generating",
  "Orchestrating",
  "Iterating",
  "Synthesizing",
  "Resolving",
  "Fermenting",
] as const;

/**
 * Spinner verb type derived from SPINNER_VERBS array.
 */
export type SpinnerVerb = (typeof SPINNER_VERBS)[number];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Select a random verb from the SPINNER_VERBS array.
 *
 * @returns A randomly selected verb string
 *
 * @example
 * ```ts
 * const verb = getRandomVerb();
 * console.log(verb); // e.g., "Analyzing"
 * ```
 */
export function getRandomVerb(): SpinnerVerb {
  const index = Math.floor(Math.random() * SPINNER_VERBS.length);
  return SPINNER_VERBS[index] as SpinnerVerb;
}

// ============================================================================
// COMPLETION VERBS (for CompletionSummary)
// ============================================================================

/**
 * Past-tense verbs for the completion summary line.
 * Displayed after a response finishes: "⣿ Worked for 1m 6s"
 */
export const COMPLETION_VERBS: readonly string[] = [
  "Worked",
  "Crafted",
  "Processed",
  "Computed",
  "Reasoned",
  "Composed",
  "Delivered",
  "Produced",
] as const;

/**
 * Completion verb type derived from COMPLETION_VERBS array.
 */
export type CompletionVerb = (typeof COMPLETION_VERBS)[number];

/**
 * Pick a random completion verb.
 *
 * @returns A randomly selected completion verb
 */
export function getRandomCompletionVerb(): CompletionVerb {
  const index = Math.floor(Math.random() * COMPLETION_VERBS.length);
  return COMPLETION_VERBS[index] as CompletionVerb;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default SPINNER_VERBS;
