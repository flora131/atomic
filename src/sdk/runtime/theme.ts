/**
 * Terminal color theme using Catppuccin palettes.
 *
 * Uses OpenTUI's built-in dark/light mode detection (via the renderer's
 * themeMode property) to select the appropriate palette:
 * - Mocha for dark terminals (and as fallback)
 * - Latte for light terminals
 */

import type { ThemeMode } from "@opentui/core";

// ---------------------------------------------------------------------------
// Theme type
// ---------------------------------------------------------------------------

export interface TerminalTheme {
  bg: string;
  surface: string;
  selection: string;
  border: string;
  borderDim: string;
  accent: string;
  text: string;
  dim: string;
  success: string;
  error: string;
  warning: string;
  mauve: string;
}

// ---------------------------------------------------------------------------
// Catppuccin Mocha (dark)
// ---------------------------------------------------------------------------

const CATPPUCCIN_MOCHA: TerminalTheme = {
  bg: "#1e1e2e",         // Base
  surface: "#313244",    // Surface0
  selection: "#45475a",  // Surface1
  border: "#6c7086",     // Overlay0
  borderDim: "#585b70",  // Surface2
  accent: "#89b4fa",     // Blue
  text: "#cdd6f4",       // Text
  dim: "#7f849c",        // Overlay1
  success: "#a6e3a1",    // Green
  error: "#f38ba8",      // Red
  warning: "#f9e2af",    // Yellow
  mauve: "#cba6f7",      // Mauve
};

// ---------------------------------------------------------------------------
// Catppuccin Latte (light)
// ---------------------------------------------------------------------------

const CATPPUCCIN_LATTE: TerminalTheme = {
  bg: "#eff1f5",         // Base
  surface: "#ccd0da",    // Surface0
  selection: "#bcc0cc",  // Surface1
  border: "#9ca0b0",     // Overlay0
  borderDim: "#acb0be",  // Surface2
  accent: "#1e66f5",     // Blue
  text: "#4c4f69",       // Text
  dim: "#8c8fa1",        // Overlay1
  success: "#40a02b",    // Green
  error: "#d20f39",      // Red
  warning: "#df8e1d",    // Yellow
  mauve: "#8839ef",      // Mauve
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the terminal theme from the renderer's detected theme mode.
 * Returns Catppuccin Latte for light terminals, Mocha for dark or unknown.
 */
export function resolveTheme(mode: ThemeMode | null): TerminalTheme {
  return mode === "light" ? CATPPUCCIN_LATTE : CATPPUCCIN_MOCHA;
}
