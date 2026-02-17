/**
 * Theme Support for Terminal Chat UI
 *
 * Provides theme configuration and context for dark/light mode support.
 * Uses React context for theme propagation through component tree.
 *
 * Reference: Feature 19 - Implement theme support with dark/light modes
 */

import React, { createContext, useContext, useState, useCallback } from "react";
import { SyntaxStyle, RGBA, type StyleDefinition } from "@opentui/core";

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
// CATPPUCCIN PALETTE
// ============================================================================

/**
 * Full Catppuccin Mocha palette.
 * Reference: docs/style-guide.md
 */
export const catppuccinMocha = {
  rosewater: "#f5e0dc",
  flamingo: "#f2cdcd",
  pink: "#f5c2e7",
  mauve: "#cba6f7",
  red: "#f38ba8",
  maroon: "#eba0ac",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  sky: "#89dceb",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
  lavender: "#b4befe",
  text: "#cdd6f4",
  subtext1: "#bac2de",
  subtext0: "#a6adc8",
  overlay2: "#9399b2",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  surface2: "#585b70",
  surface1: "#45475a",
  surface0: "#313244",
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
} as const;

/**
 * Full Catppuccin Latte palette.
 * Reference: docs/style-guide.md
 */
export const catppuccinLatte = {
  rosewater: "#dc8a78",
  flamingo: "#dd7878",
  pink: "#ea76cb",
  mauve: "#8839ef",
  red: "#d20f39",
  maroon: "#e64553",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  sky: "#04a5e5",
  sapphire: "#209fb5",
  blue: "#1e66f5",
  lavender: "#7287fd",
  text: "#4c4f69",
  subtext1: "#5c5f77",
  subtext0: "#6c6f85",
  overlay2: "#7c7f93",
  overlay1: "#8c8fa1",
  overlay0: "#9ca0b0",
  surface2: "#acb0be",
  surface1: "#bcc0cc",
  surface0: "#ccd0da",
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
} as const;

/** Type for a full Catppuccin palette. */
export interface CatppuccinPalette {
  readonly rosewater: string;
  readonly flamingo: string;
  readonly pink: string;
  readonly mauve: string;
  readonly red: string;
  readonly maroon: string;
  readonly peach: string;
  readonly yellow: string;
  readonly green: string;
  readonly teal: string;
  readonly sky: string;
  readonly sapphire: string;
  readonly blue: string;
  readonly lavender: string;
  readonly text: string;
  readonly subtext1: string;
  readonly subtext0: string;
  readonly overlay2: string;
  readonly overlay1: string;
  readonly overlay0: string;
  readonly surface2: string;
  readonly surface1: string;
  readonly surface0: string;
  readonly base: string;
  readonly mantle: string;
  readonly crust: string;
}

/**
 * Get the Catppuccin palette for the current theme mode.
 */
export function getCatppuccinPalette(isDark: boolean): CatppuccinPalette {
  return isDark ? catppuccinMocha : catppuccinLatte;
}

// ============================================================================
// THEME DEFINITIONS
// ============================================================================

/**
 * Dark theme configuration.
 * Catppuccin Mocha-inspired palette with Atomic identity.
 * Rich, warm dark theme with pastel accents for terminal legibility.
 */
export const darkTheme: Theme = {
  name: "dark",
  isDark: true,
  colors: {
    background: "#1e1e2e",  // Mocha Base
    foreground: "#cdd6f4",  // Mocha Text
    accent: "#94e2d5",      // Mocha Teal
    border: "#45475a",      // Mocha Surface 1
    userMessage: "#89b4fa", // Mocha Blue
    assistantMessage: "#94e2d5", // Mocha Teal
    systemMessage: "#cba6f7",    // Mocha Mauve
    error: "#f38ba8",       // Mocha Red
    success: "#a6e3a1",     // Mocha Green
    warning: "#f9e2af",     // Mocha Yellow
    muted: "#6c7086",       // Mocha Overlay 0
    inputFocus: "#585b70",  // Mocha Surface 2
    inputStreaming: "#6c7086", // Mocha Overlay 0
    userBubbleBg: "#313244",  // Mocha Surface 0
    userBubbleFg: "#cdd6f4",  // Mocha Text
    dim: "#585b70",           // Mocha Surface 2
    scrollbarFg: "#6c7086",   // Mocha Overlay 0
    scrollbarBg: "#313244",   // Mocha Surface 0
    codeBorder: "#45475a",    // Mocha Surface 1
    codeTitle: "#94e2d5",     // Mocha Teal
  },
};

/**
 * Light theme configuration.
 * Catppuccin Latte-inspired palette with Atomic identity.
 * Crisp, warm light theme with saturated accents for readability.
 */
export const lightTheme: Theme = {
  name: "light",
  isDark: false,
  colors: {
    background: "#eff1f5",  // Latte Base
    foreground: "#4c4f69",  // Latte Text
    accent: "#179299",      // Latte Teal
    border: "#ccd0da",      // Latte Surface 0
    userMessage: "#1e66f5", // Latte Blue
    assistantMessage: "#179299", // Latte Teal
    systemMessage: "#8839ef",    // Latte Mauve
    error: "#d20f39",       // Latte Red
    success: "#40a02b",     // Latte Green
    warning: "#df8e1d",     // Latte Yellow
    muted: "#8c8fa1",       // Latte Overlay 1
    inputFocus: "#acb0be",  // Latte Surface 2
    inputStreaming: "#9ca0b0", // Latte Overlay 0
    userBubbleBg: "#e6e9ef",  // Latte Mantle
    userBubbleFg: "#4c4f69",  // Latte Text
    dim: "#acb0be",           // Latte Surface 2
    scrollbarFg: "#9ca0b0",   // Latte Overlay 0
    scrollbarBg: "#e6e9ef",   // Latte Mantle
    codeBorder: "#ccd0da",    // Latte Surface 0
    codeTitle: "#179299",     // Latte Teal
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
 * Create a theme-aware SyntaxStyle for markdown rendering.
 * Uses Catppuccin palette colors per the style guide for syntax highlighting.
 */
export function createMarkdownSyntaxStyle(colors: ThemeColors, isDark: boolean): SyntaxStyle {
  // Catppuccin syntax colors following docs/style-guide.md
  const s = isDark ? {
    heading:  "#94e2d5", // Mocha Teal (accent)
    keyword:  "#cba6f7", // Mocha Mauve
    string:   "#a6e3a1", // Mocha Green
    comment:  "#9399b2", // Mocha Overlay 2
    variable: "#cdd6f4", // Mocha Text
    func:     "#89b4fa", // Mocha Blue
    number:   "#fab387", // Mocha Peach
    type:     "#f9e2af", // Mocha Yellow
    operator: "#89dceb", // Mocha Sky
    punct:    "#9399b2", // Mocha Overlay 2
    property: "#89b4fa", // Mocha Blue
    link:     "#89b4fa", // Mocha Blue
    list:     "#45475a", // Mocha Surface 1
    raw:      "#6c7086", // Mocha Overlay 0
    bool:     "#fab387", // Mocha Peach
    constant: "#fab387", // Mocha Peach
  } : {
    heading:  "#179299", // Latte Teal (accent)
    keyword:  "#8839ef", // Latte Mauve
    string:   "#40a02b", // Latte Green
    comment:  "#7c7f93", // Latte Overlay 2
    variable: "#4c4f69", // Latte Text
    func:     "#1e66f5", // Latte Blue
    number:   "#fe640b", // Latte Peach
    type:     "#df8e1d", // Latte Yellow
    operator: "#04a5e5", // Latte Sky
    punct:    "#7c7f93", // Latte Overlay 2
    property: "#1e66f5", // Latte Blue
    link:     "#1e66f5", // Latte Blue
    list:     "#ccd0da", // Latte Surface 0
    raw:      "#8c8fa1", // Latte Overlay 1
    bool:     "#fe640b", // Latte Peach
    constant: "#fe640b", // Latte Peach
  };

  return SyntaxStyle.fromStyles({
    "markup.heading.1": { fg: RGBA.fromHex(s.heading), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(s.heading), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(s.heading), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(s.heading) },
    "markup.heading.5": { fg: RGBA.fromHex(s.heading) },
    "markup.heading.6": { fg: RGBA.fromHex(s.heading), dim: true },
    "markup.raw": { fg: RGBA.fromHex(s.raw) },
    "markup.list": { fg: RGBA.fromHex(s.list) },
    "markup.link": { fg: RGBA.fromHex(s.link), underline: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": {},
    "punctuation.special": { fg: RGBA.fromHex(s.punct) },
    "conceal": { fg: RGBA.fromHex(s.raw) },
    keyword: { fg: RGBA.fromHex(s.keyword), bold: true },
    string: { fg: RGBA.fromHex(s.string) },
    comment: { fg: RGBA.fromHex(s.comment), italic: true },
    variable: { fg: RGBA.fromHex(s.variable) },
    "function": { fg: RGBA.fromHex(s.func) },
    number: { fg: RGBA.fromHex(s.number) },
    type: { fg: RGBA.fromHex(s.type) },
    operator: { fg: RGBA.fromHex(s.operator) },
    punctuation: { fg: RGBA.fromHex(s.punct) },
    constant: { fg: RGBA.fromHex(s.constant) },
    property: { fg: RGBA.fromHex(s.property) },
    boolean: { fg: RGBA.fromHex(s.bool) },
    default: { fg: RGBA.fromHex(s.variable) },
  });
}

/**
 * Create a dimmed variant of a SyntaxStyle by reducing the alpha channel
 * of all foreground colors. Used for reasoning/thinking content display.
 *
 * Iterates over all registered styles in the base SyntaxStyle, creates new
 * RGBA instances with reduced alpha for each `fg` color, and rebuilds via
 * SyntaxStyle.fromStyles().
 *
 * @param baseStyle - The SyntaxStyle to dim
 * @param opacity - Alpha multiplier (0.0 to 1.0), default 0.6
 * @returns A new SyntaxStyle with reduced-opacity foreground colors
 */
export function createDimmedSyntaxStyle(
  baseStyle: SyntaxStyle,
  opacity: number = 0.6,
): SyntaxStyle {
  const allStyles = baseStyle.getAllStyles();
  const dimmedRecord: Record<string, StyleDefinition> = {};

  for (const [name, def] of allStyles) {
    const dimmedDef: StyleDefinition = { ...def };
    if (dimmedDef.fg) {
      dimmedDef.fg = RGBA.fromValues(
        dimmedDef.fg.r,
        dimmedDef.fg.g,
        dimmedDef.fg.b,
        dimmedDef.fg.a * opacity,
      );
    }
    dimmedRecord[name] = dimmedDef;
  }

  return SyntaxStyle.fromStyles(dimmedRecord);
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
  catppuccinMocha,
  catppuccinLatte,
  getCatppuccinPalette,
};
