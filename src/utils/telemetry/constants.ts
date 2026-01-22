/**
 * Telemetry constants for command tracking
 *
 * These are the slash commands that Atomic provides across all agents.
 * Used for extracting commands from CLI args and agent session transcripts.
 *
 * Reference: Spec Section 5.3.2
 */

/**
 * List of all Atomic slash commands that are tracked.
 * Includes both short and fully-qualified (namespace:command) forms.
 */
export const ATOMIC_COMMANDS = [
  "/research-codebase",
  "/create-spec",
  "/create-feature-list",
  "/implement-feature",
  "/commit",
  "/create-gh-pr",
  "/explain-code",
  "/ralph-loop",
  "/ralph:ralph-loop",
  "/cancel-ralph",
  "/ralph:cancel-ralph",
  "/ralph-help",
  "/ralph:help",
] as const;

/** Type for valid Atomic command strings */
export type AtomicCommand = (typeof ATOMIC_COMMANDS)[number];
