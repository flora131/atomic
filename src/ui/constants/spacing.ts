/**
 * Spacing Constants Module
 *
 * Semantic spacing tokens for consistent layout across the TUI.
 * Values are in terminal cells (characters). Use these instead of
 * hardcoded magic numbers for margin, padding, and gap props.
 */

export const SPACING = {
  /** No spacing (0). Tight layout, explicit zero. */
  NONE: 0,
  /** Standard gap between sibling elements — messages, list items, parts (1). */
  ELEMENT: 1,
  /** Gap between logical sections within a container (1). */
  SECTION: 1,
  /** Inner padding for containers, bordered boxes, scrollbox edges (1). */
  CONTAINER_PAD: 1,
  /** Outer/bordered container padding, autocomplete rows, indentation (2). */
  CONTAINER_PAD_LG: 2,
  /** Content indentation — reasoning, sub-content, nested blocks (2). */
  INDENT: 2,
  /** Large horizontal spacing — logo gutter, wide separation (3). */
  GUTTER: 3,
} as const;
