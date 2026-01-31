/**
 * Theme Support for Terminal Chat UI
 *
 * Provides theme configuration and context for dark/light mode support.
 * Uses React context for theme propagation through component tree.
 *
 * Reference: Feature 19 - Implement theme support with dark/light modes
 */

import React, { createContext, useContext, useState, useCallback } from "react";

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
 * Muted dusty pink & pale blue aesthetic with dark background.
 */
export const darkTheme: Theme = {
  name: "dark",
  isDark: true,
  colors: {
    background: "black",
    foreground: "white",
    accent: "#D4A5A5",      // Dusty rose accent
    border: "#B8878A",      // Muted rose border
    userMessage: "#A8C5D8", // Pale sky blue for user
    assistantMessage: "#D4A5A5", // Dusty rose for assistant
    systemMessage: "#C9B896",    // Muted gold
    error: "#C98A8A",       // Dusty red
    success: "#8AB89A",     // Muted sage
    warning: "#C9B896",     // Muted gold
    muted: "#9A9AAC",       // Dusty lavender
    inputFocus: "#D4A5A5",  // Dusty rose focus
    inputStreaming: "#B8A0B8", // Muted mauve streaming
  },
};

/**
 * Light theme configuration.
 * Muted dusty pink & pale blue aesthetic with light background.
 */
export const lightTheme: Theme = {
  name: "light",
  isDark: false,
  colors: {
    background: "white",
    foreground: "black",
    accent: "#B8878A",      // Muted rose accent
    border: "#E8C4C4",      // Pale rose border
    userMessage: "#5A8AA8", // Muted steel blue for user
    assistantMessage: "#B8878A", // Muted rose for assistant
    systemMessage: "#A89060",    // Dusty gold
    error: "#A86868",       // Muted red
    success: "#5A886A",     // Muted sage
    warning: "#A89060",     // Dusty gold
    muted: "#7A7A8C",       // Dusty gray-violet
    inputFocus: "#B8878A",  // Muted rose focus
    inputStreaming: "#9A7898", // Dusty mauve streaming
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
