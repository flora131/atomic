/**
 * Banner display utility for atomic CLI
 *
 * Displays the ANSI-colored logo if terminal meets minimum size requirements.
 */

import { LOGO, LOGO_TRUE_COLOR, LOGO_MIN_COLS, LOGO_MIN_ROWS } from "./constants";
import { supports256Color, supportsTrueColor } from "../detect";

/**
 * Get terminal dimensions with fallback for non-TTY environments
 */
function getTerminalSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * Display the atomic banner
 *
 * Shows the ANSI-colored logo if:
 * - Terminal is at least 79 columns wide
 * - Terminal is at least 27 rows tall
 * - Terminal supports 256 colors or true color
 *
 * Uses true color (24-bit) if supported, falls back to 256-color version.
 * Does nothing if terminal is too small or lacks color support.
 */
export function displayBanner(): void {
  const { cols, rows } = getTerminalSize();

  if (cols < LOGO_MIN_COLS || rows < LOGO_MIN_ROWS) {
    return;
  }

  if (supportsTrueColor()) {
    console.log(LOGO_TRUE_COLOR);
  } else if (supports256Color()) {
    console.log(LOGO);
  }
}
