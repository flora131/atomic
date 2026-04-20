/**
 * Constants for the open-claude-design workflow.
 *
 * Design-rule constants (REFLEX_FONTS, IMPECCABLE_BANS, DESIGN_DONTS) mirror
 * the canonical impeccable skill shipped at
 * `~/.claude/skills/impeccable/SKILL.md`. The skill itself is only loaded
 * opportunistically by the agent — so we inline the load-bearing rules here
 * to guarantee every generation/refinement/critique turn sees them even if
 * the skill is missing or fails to load. Re-sync when the skill updates.
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
 * Structured ban — rendered into generation/refinement/critique prompts as a
 * `rule` (what is forbidden) plus `detail` (the CSS pattern + the rewrite).
 */
export interface ImpeccableBan {
  readonly id: string;
  readonly rule: string;
  readonly detail: string;
}

/**
 * Absolute CSS bans from the canonical impeccable skill's `<absolute_bans>`
 * section. These are the two patterns that the skill flags as "NEVER
 * acceptable" regardless of color, radius, or CSS variable naming. If you
 * change this list, re-sync with `~/.claude/skills/impeccable/SKILL.md`.
 */
export const IMPECCABLE_BANS: readonly ImpeccableBan[] = [
  {
    id: "side-stripe-borders",
    rule: "BAN 1 — Side-stripe borders on cards/list items/callouts/alerts",
    detail:
      "PATTERN: `border-left:` or `border-right:` with width greater than 1px. " +
      "Forbidden for any color, any CSS variable name (including `--color-warning`, " +
      "`--color-accent`, `--color-primary`). REWRITE: use a different element " +
      "structure entirely — full borders, background tints, leading icons, numbers, " +
      "or no visual indicator at all. Do NOT just swap to `box-shadow: inset`.",
  },
  {
    id: "gradient-text",
    rule: "BAN 2 — Gradient text",
    detail:
      "PATTERN: `background-clip: text` (or `-webkit-background-clip: text`) combined " +
      "with a `linear-gradient`, `radial-gradient`, or `conic-gradient` background. " +
      "Forbidden on any text element — headings, metrics, or inline spans. " +
      "REWRITE: solid colors only for text.",
  },
] as const;

/**
 * Canonical reflex fonts from the impeccable skill's
 * `<reflex_fonts_to_reject>` list. These are the training-data defaults that
 * create monoculture across projects; every one of them is banned.
 */
export const REFLEX_FONTS: readonly string[] = [
  "Fraunces",
  "Newsreader",
  "Lora",
  "Crimson",
  "Crimson Pro",
  "Crimson Text",
  "Playfair Display",
  "Cormorant",
  "Cormorant Garamond",
  "Syne",
  "IBM Plex Mono",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "Space Mono",
  "Space Grotesk",
  "Inter",
  "DM Sans",
  "DM Serif Display",
  "DM Serif Text",
  "Outfit",
  "Plus Jakarta Sans",
  "Instrument Sans",
  "Instrument Serif",
] as const;

/**
 * Non-ban DON'Ts distilled from the impeccable skill sections on Typography,
 * Color, Layout/Space, Motion, UX Writing, and Responsive. These are not
 * absolute bans, but they are the recognizable AI fingerprints from
 * 2024-2025 and must be avoided in generated designs.
 */
export const DESIGN_DONTS: readonly string[] = [
  // Typography
  "Do not use monospace typography as lazy shorthand for 'technical/developer' vibes.",
  "Do not put large icons with rounded corners above every heading.",
  "Do not use only one font family for the entire page — pair a distinctive display font with a refined body font.",
  "Do not use a flat type hierarchy where sizes are too close together — aim for at least a 1.25 ratio between steps.",
  "Do not set long body passages in uppercase — reserve all-caps for short labels and headings.",
  // Color & theme
  "Do not use pure black (#000) or pure white (#fff) — always tint toward the brand hue.",
  "Do not use the AI color palette (cyan-on-dark, purple-to-blue gradients, neon accents on dark backgrounds).",
  "Do not default to dark mode with glowing accents, or to light mode 'to be safe' — derive theme from audience and viewing context.",
  "Do not use gray text on colored backgrounds — use a shade of the background color instead.",
  // Layout & space
  "Do not wrap everything in cards — not everything needs a container.",
  "Do not nest cards inside cards.",
  "Do not use identical card grids (same-sized cards with icon + heading + text, repeated endlessly).",
  "Do not use the hero metric layout template (big number, small label, supporting stats, gradient accent).",
  "Do not center everything — left-aligned text with asymmetric layouts feels more designed.",
  "Do not use the same spacing everywhere — create rhythm with tight groupings and generous separations.",
  "Do not let body text wrap beyond ~80 characters per line — use a max-width like 65–75ch.",
  // Motion
  "Do not animate layout properties (width, height, padding, margin) — use transform and opacity only.",
  "Do not use bounce or elastic easing — real objects decelerate smoothly.",
  // UX writing
  "Do not repeat information (redundant headers, intros that restate the heading).",
  "Do not make every button primary — use ghost buttons, text links, and secondary styles for hierarchy.",
  // Responsive
  "Do not hide critical functionality on mobile — adapt the interface, don't amputate it.",
] as const;

/**
 * Command invocation for the impeccable scanner. The correct subcommand is
 * `detect`; a bare `impeccable --json` just prints the top-level help.
 * Exit code is always 0 — callers must parse the JSON array and check length
 * to know whether findings exist.
 */
export const IMPECCABLE_SCAN_CMD = [
  "bunx",
  "impeccable",
  "detect",
  "--json",
] as const;
