/**
 * Test fixture factory for ThemeColors.
 *
 * Provides a fully-typed ThemeColors object with all required fields,
 * eliminating `{ ...partialColors } as any` casts in theme tests.
 */

import type { ThemeColors } from "@/theme/types.ts";

// ---------------------------------------------------------------------------
// ThemeColors factory
// ---------------------------------------------------------------------------

/**
 * Creates a complete ThemeColors object with sensible dark-theme defaults.
 *
 * @example
 * ```ts
 * const colors = createMockThemeColors({ accent: "#ff0000" });
 * const style = createMarkdownSyntaxStyle(colors, true);
 * ```
 */
export function createMockThemeColors(
  overrides?: Partial<ThemeColors>,
): ThemeColors {
  return {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    accent: "#94e2d5",
    border: "#45475a",
    userMessage: "#f5e0dc",
    assistantMessage: "#cdd6f4",
    systemMessage: "#a6adc8",
    error: "#f38ba8",
    success: "#a6e3a1",
    warning: "#f9e2af",
    muted: "#6c7086",
    inputFocus: "#94e2d5",
    inputStreaming: "#f9e2af",
    userBubbleBg: "#313244",
    userBubbleFg: "#cdd6f4",
    dim: "#585b70",
    scrollbarFg: "#45475a",
    scrollbarBg: "#1e1e2e",
    codeBorder: "#45475a",
    codeTitle: "#94e2d5",
    ...overrides,
  };
}
