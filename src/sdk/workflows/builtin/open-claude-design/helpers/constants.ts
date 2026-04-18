/**
 * Constants for the open-claude-design workflow.
 */

/** Maximum refinement iterations before the loop exits unconditionally. */
export const MAX_REFINEMENTS = 5;

/**
 * Headless stages: structured analysis, tool orchestration, rubric-following.
 * Uses Sonnet for cost efficiency. Bypasses permissions for unattended operation.
 */
export const HEADLESS_OPTS = {
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  model: "sonnet",
} as const;

/**
 * Visible/creative stages: inherit orchestrator model (Opus).
 * No model override — inherits from the parent session.
 */
export const VISIBLE_OPTS = {
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
} as const;

/** Name of the design system file written to the project root. */
export const DESIGN_SYSTEM_FILENAME = "Design.md";

/** Directory under project root where final design outputs are stored. */
export const DESIGNS_DIR = "research/designs";

/** Name of the existing impeccable brand context file. */
export const IMPECCABLE_FILENAME = ".impeccable.md";

/**
 * Impeccable absolute bans — embedded directly in generation/refinement
 * prompts to prevent AI slop at the prompt level.
 */
export const IMPECCABLE_BANS = [
  "BAN 1: No side-stripe borders (border-left/right > 1px)",
  "BAN 2: No gradient text (background-clip: text)",
  "No AI color palette: cyan-on-dark, purple-to-blue gradients, neon on dark",
  'No reflex fonts: Inter, DM Sans, Fraunces, Poppins, Montserrat, Raleway, Playfair Display, Space Grotesk, Plus Jakarta Sans, Sora, Outfit, Urbanist, Lexend, Satoshi, General Sans, Cabinet Grotesk, Clash Display, Switzer, Synonym, Zodiak, Erode, Gambetta',
] as const;
