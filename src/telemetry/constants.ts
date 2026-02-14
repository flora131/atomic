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
 *
 * IMPORTANT: This list is duplicated in:
 * - bin/telemetry-helper.sh (ATOMIC_COMMANDS array)
 * - .opencode/plugin/telemetry.ts (ATOMIC_COMMANDS const)
 *
 * Tests in atomic-commands-sync.test.ts verify synchronization.
 */
export const ATOMIC_COMMANDS = [
  "/research-codebase",
  "/create-spec",
  "/explain-code",
  "/ralph",
] as const;

/** Type for valid Atomic command strings */
export type AtomicCommand = (typeof ATOMIC_COMMANDS)[number];