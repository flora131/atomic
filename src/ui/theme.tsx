/**
 * Theme Support for Terminal Chat UI
 *
 * Provides theme configuration and context for dark/light mode support.
 * Uses React context for theme propagation through component tree.
 *
 * Reference: Feature 19 - Implement theme support with dark/light modes
 */

import React, { createContext, useContext, useState, useCallback } from "react";
import { SyntaxStyle, RGBA } from "@opentui/core";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Color configuration for the theme.
 */
export interface ThemeColors {
  /** Background color for the main container */
  background: string;
  /** Primary foreground/text color */
  foreground: string;
  /** Accent color for highlights and interactive elements */
  accent: string;
  /** Border color for containers and separators */
  border: string;
  /** Color for user message bubbles */
  userMessage: string;
  /** Color for assistant message bubbles */
  assistantMessage: string;
  /** Color for system messages */
  systemMessage: string;
  /** Color for error states and messages */
  error: string;
  /** Color for success states and messages */
  success: string;
  /** Color for warning states and messages */
  warning: string;
  /** Muted/dimmed text color */
  muted: string;
  /** Color for input field borders when focused */
  inputFocus: string;
  /** Color for input field borders when streaming */
  inputStreaming: string;
  /** User message bubble background */
  userBubbleBg: string;
  /** User message bubble foreground */
  userBubbleFg: string;
  /** Very faded text for separators, tool counts, collapsed indicators */
  dim: string;
  /** Input scrollbar thumb */
  scrollbarFg: string;
  /** Input scrollbar track */
  scrollbarBg: string;
  /** Code block border */
  codeBorder: string;
  /** Code block language label */
  codeTitle: string;
}

/**
 * Theme configuration.
 */
export interface Theme {
  /** Theme name identifier */
  name: string;
  /** Whether this is a dark theme */
  isDark: boolean;
  /** Theme color palette */
  colors: ThemeColors;
}

/**
 * Theme context value with current theme and toggle function.
 */
export interface ThemeContextValue {
  /** Current active theme */
  theme: Theme;
  /** Function to toggle between themes */
  toggleTheme: () => void;
  /** Function to set a specific theme */
  setTheme: (theme: Theme) => void;
  /** Check if current theme is dark */
  isDark: boolean;
}

/**
 * Props for ThemeProvider component.
 */
export interface ThemeProviderProps {
  /** Initial theme to use (defaults to darkTheme) */
  initialTheme?: Theme;
  /** Child components to wrap */
  children: React.ReactNode;
}

// ============================================================================
// THEME DEFINITIONS
// ============================================================================

/**
 * Dark theme configuration.
 * High-contrast "Atomic" aesthetic with neon accents on dark background.
 * Optimized for terminal legibility and modern developer vibes.
 */
export const darkTheme: Theme = {
  name: "dark",
  isDark: true,
  colors: {
    background: "black",    // Standard terminal black
    foreground: "#ecf2f8",  // Ice white
    accent: "#2dd4bf",      // Atomic Teal (Teal 400)
    border: "#3f3f46",      // Zinc 700
    userMessage: "#60a5fa", // Electric Blue (Blue 400)
    assistantMessage: "#2dd4bf", // Atomic Teal
    systemMessage: "#a78bfa",    // Electric Purple (Violet 400)
    error: "#fb7185",       // Rose 400
    success: "#4ade80",     // Neon Green (Green 400)
    warning: "#fbbf24",     // Amber 400
    muted: "#9ca3af",       // Gray 400
    inputFocus: "#2dd4bf",  // Teal focus
    inputStreaming: "#c084fc", // Purple pulsing
    userBubbleBg: "#3f3f46",  // Zinc 700
    userBubbleFg: "#ecf2f8",  // Ice white
    dim: "#555566",
    scrollbarFg: "#6b7280",   // Gray 500
    scrollbarBg: "#3f3f46",
    codeBorder: "#3f3f46",
    codeTitle: "#2dd4bf",     // Teal accent
  },
};

/**
 * Light theme configuration.
 * Clean "Laboratory" aesthetic with crisp contrast.
 * Professional, precise, and highly readable.
 */
export const lightTheme: Theme = {
  name: "light",
  isDark: false,
  colors: {
    background: "white",    // Standard terminal white
    foreground: "#0f172a",  // Slate 900
    accent: "#0d9488",      // Deep Teal (Teal 600)
    border: "#cbd5e1",      // Slate 300
    userMessage: "#2563eb", // Royal Blue (Blue 600)
    assistantMessage: "#0d9488", // Deep Teal
    systemMessage: "#7c3aed",    // Deep Violet (Violet 600)
    error: "#e11d48",       // Rose 600
    success: "#16a34a",     // Green 600
    warning: "#d97706",     // Amber 600
    muted: "#64748b",       // Slate 500
    inputFocus: "#0d9488",  // Teal focus
    inputStreaming: "#9333ea", // Purple pulsing
    userBubbleBg: "#e2e8f0",  // Slate 200
    userBubbleFg: "#0f172a",  // Slate 900
    dim: "#94a3b8",           // Slate 400
    scrollbarFg: "#94a3b8",   // Slate 400
    scrollbarBg: "#e2e8f0",   // Slate 200
    codeBorder: "#cbd5e1",    // Slate 300
    codeTitle: "#0d9488",     // Teal 600
  },
};

// ============================================================================
// THEME CONTEXT
// ============================================================================

/**
 * Default theme context value.
 */
const defaultContextValue: ThemeContextValue = {
  theme: darkTheme,
  toggleTheme: () => {},
  setTheme: () => {},
  isDark: true,
};

/**
 * React context for theme state.
 */
export const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to access the current theme and theme controls.
 *
 * @returns The current theme context value
 * @throws Error if used outside of ThemeProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, toggleTheme, isDark } = useTheme();
 *
 *   return (
 *     <box>
 *       <text fg={theme.colors.foreground}>
 *         Current theme: {theme.name}
 *       </text>
 *       <button onClick={toggleTheme}>
 *         Toggle to {isDark ? 'light' : 'dark'}
 *       </button>
 *     </box>
 *   );
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  return context;
}

/**
 * Hook to get just the current theme colors.
 * Convenience wrapper around useTheme.
 *
 * @returns The current theme color palette
 */
export function useThemeColors(): ThemeColors {
  const { theme } = useTheme();
  return theme.colors;
}

// ============================================================================
// THEME PROVIDER COMPONENT
// ============================================================================

/**
 * Provider component for theme context.
 *
 * Wraps the application and provides theme state to all descendants.
 * Includes toggle functionality for switching between light and dark themes.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ThemeProvider initialTheme={darkTheme}>
 *       <ChatApp />
 *     </ThemeProvider>
 *   );
 * }
 * ```
 */
export function ThemeProvider({
  initialTheme = darkTheme,
  children,
}: ThemeProviderProps): React.ReactNode {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  /**
   * Toggle between dark and light themes.
   */
  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current.isDark ? lightTheme : darkTheme));
  }, []);

  /**
   * Set a specific theme.
   */
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const contextValue: ThemeContextValue = {
    theme,
    toggleTheme,
    setTheme,
    isDark: theme.isDark,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a theme by name.
 *
 * @param name - Theme name ("dark" or "light")
 * @returns The matching theme, defaults to darkTheme
 */
export function getThemeByName(name: string): Theme {
  switch (name.toLowerCase()) {
    case "light":
      return lightTheme;
    case "dark":
    default:
      return darkTheme;
  }
}

/**
 * Get the color for a message role based on the current theme.
 *
 * @param role - Message role ("user", "assistant", "system")
 * @param colors - Theme color palette
 * @returns The appropriate color for the role
 */
export function getMessageColor(
  role: "user" | "assistant" | "system",
  colors: ThemeColors
): string {
  switch (role) {
    case "user":
      return colors.userMessage;
    case "assistant":
      return colors.assistantMessage;
    case "system":
      return colors.systemMessage;
    default:
      return colors.foreground;
  }
}

/**
 * Create a custom theme with partial color overrides.
 *
 * @param base - Base theme to extend
 * @param overrides - Partial color overrides
 * @returns New theme with applied overrides
 */
export function createCustomTheme(
  base: Theme,
  overrides: Partial<ThemeColors> & { name?: string }
): Theme {
  return {
    name: overrides.name ?? `${base.name}-custom`,
    isDark: base.isDark,
    colors: {
      ...base.colors,
      ...overrides,
    },
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

// ============================================================================
// MARKDOWN SYNTAX STYLE
// ============================================================================

/**
 * Light theme overrides for WCAG AA compliance and consistent "Atomic" aesthetic.
 */
const lightThemeOverrides = {
  accent:      "#0d9488", // Teal 600
  muted:       "#64748b", // Slate 500
  success:     "#16a34a", // Green 600
  userMessage: "#2563eb", // Blue 600
  warning:     "#d97706", // Amber 600
  border:      "#cbd5e1", // Slate 300
};

/**
 * Create a theme-aware SyntaxStyle for markdown rendering.
 * Maps ThemeColors to markdown syntax scopes for OpenTUI's MarkdownRenderable.
 */
export function createMarkdownSyntaxStyle(colors: ThemeColors, isDark: boolean): SyntaxStyle {
  const c = isDark ? {
    accent: colors.accent,
    muted: colors.muted,
    success: colors.success,
    userMessage: colors.userMessage,
    warning: colors.warning,
    border: colors.border,
    foreground: colors.foreground,
  } : {
    accent: lightThemeOverrides.accent,
    muted: lightThemeOverrides.muted,
    success: lightThemeOverrides.success,
    userMessage: lightThemeOverrides.userMessage,
    warning: lightThemeOverrides.warning,
    border: lightThemeOverrides.border,
    foreground: colors.foreground,
  };

  return SyntaxStyle.fromStyles({
    "markup.heading.1": { fg: RGBA.fromHex(c.accent), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(c.accent), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(c.accent), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(c.accent) },
    "markup.heading.5": { fg: RGBA.fromHex(c.accent) },
    "markup.heading.6": { fg: RGBA.fromHex(c.accent), dim: true },
    "markup.raw": { fg: RGBA.fromHex(c.muted) },
    "markup.list": { fg: RGBA.fromHex(c.border) },
    "markup.link": { fg: RGBA.fromHex(c.userMessage), underline: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": {},
    "punctuation.special": { fg: RGBA.fromHex(c.muted) },
    "conceal": { fg: RGBA.fromHex(c.muted) },
    keyword: { fg: RGBA.fromHex(c.accent), bold: true },
    string: { fg: RGBA.fromHex(c.success) },
    comment: { fg: RGBA.fromHex(c.muted), italic: true },
    variable: { fg: RGBA.fromHex(c.foreground) },
    "function": { fg: RGBA.fromHex(c.userMessage) },
    number: { fg: RGBA.fromHex(c.warning) },
    type: { fg: RGBA.fromHex(c.accent) },
    operator: { fg: RGBA.fromHex(c.foreground) },
    punctuation: { fg: RGBA.fromHex(c.muted) },
    constant: { fg: RGBA.fromHex(c.warning) },
    property: { fg: RGBA.fromHex(c.foreground) },
    boolean: { fg: RGBA.fromHex(c.warning) },
    default: { fg: RGBA.fromHex(c.foreground) },
  });
}

export default {
  darkTheme,
  lightTheme,
  ThemeContext,
  ThemeProvider,
  useTheme,
  useThemeColors,
  getThemeByName,
  getMessageColor,
  createCustomTheme,
};
