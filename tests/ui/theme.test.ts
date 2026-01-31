/**
 * Unit tests for theme support
 *
 * Tests cover:
 * - Theme definitions (darkTheme, lightTheme)
 * - Helper functions (getThemeByName, getMessageColor, createCustomTheme)
 * - Type validation
 */

import { describe, test, expect } from "bun:test";
import {
  darkTheme,
  lightTheme,
  getThemeByName,
  getMessageColor,
  createCustomTheme,
  type Theme,
  type ThemeColors,
  type ThemeContextValue,
  type ThemeProviderProps,
} from "../../src/ui/theme.tsx";

// ============================================================================
// Theme Definitions Tests
// ============================================================================

describe("darkTheme", () => {
  test("has correct name", () => {
    expect(darkTheme.name).toBe("dark");
  });

  test("is marked as dark theme", () => {
    expect(darkTheme.isDark).toBe(true);
  });

  test("has all required color properties", () => {
    expect(darkTheme.colors.background).toBeDefined();
    expect(darkTheme.colors.foreground).toBeDefined();
    expect(darkTheme.colors.accent).toBeDefined();
    expect(darkTheme.colors.border).toBeDefined();
    expect(darkTheme.colors.userMessage).toBeDefined();
    expect(darkTheme.colors.assistantMessage).toBeDefined();
    expect(darkTheme.colors.systemMessage).toBeDefined();
    expect(darkTheme.colors.error).toBeDefined();
    expect(darkTheme.colors.success).toBeDefined();
    expect(darkTheme.colors.warning).toBeDefined();
    expect(darkTheme.colors.muted).toBeDefined();
    expect(darkTheme.colors.inputFocus).toBeDefined();
    expect(darkTheme.colors.inputStreaming).toBeDefined();
  });

  test("has appropriate dark theme colors", () => {
    expect(darkTheme.colors.background).toBe("black");
    expect(darkTheme.colors.foreground).toBe("white");
  });

  test("has distinct message colors", () => {
    expect(darkTheme.colors.userMessage).toBe("cyan");
    expect(darkTheme.colors.assistantMessage).toBe("green");
    expect(darkTheme.colors.systemMessage).toBe("yellow");
  });
});

describe("lightTheme", () => {
  test("has correct name", () => {
    expect(lightTheme.name).toBe("light");
  });

  test("is not marked as dark theme", () => {
    expect(lightTheme.isDark).toBe(false);
  });

  test("has all required color properties", () => {
    expect(lightTheme.colors.background).toBeDefined();
    expect(lightTheme.colors.foreground).toBeDefined();
    expect(lightTheme.colors.accent).toBeDefined();
    expect(lightTheme.colors.border).toBeDefined();
    expect(lightTheme.colors.userMessage).toBeDefined();
    expect(lightTheme.colors.assistantMessage).toBeDefined();
    expect(lightTheme.colors.systemMessage).toBeDefined();
    expect(lightTheme.colors.error).toBeDefined();
    expect(lightTheme.colors.success).toBeDefined();
    expect(lightTheme.colors.warning).toBeDefined();
    expect(lightTheme.colors.muted).toBeDefined();
    expect(lightTheme.colors.inputFocus).toBeDefined();
    expect(lightTheme.colors.inputStreaming).toBeDefined();
  });

  test("has appropriate light theme colors", () => {
    expect(lightTheme.colors.background).toBe("white");
    expect(lightTheme.colors.foreground).toBe("black");
  });

  test("has distinct message colors", () => {
    expect(lightTheme.colors.userMessage).toBe("blue");
    expect(lightTheme.colors.assistantMessage).toBe("magenta");
    expect(lightTheme.colors.systemMessage).toBe("yellow");
  });
});

describe("theme color consistency", () => {
  test("both themes have same structure", () => {
    const darkKeys = Object.keys(darkTheme.colors).sort();
    const lightKeys = Object.keys(lightTheme.colors).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  test("error color is consistent", () => {
    expect(darkTheme.colors.error).toBe("red");
    expect(lightTheme.colors.error).toBe("red");
  });

  test("success color is consistent", () => {
    expect(darkTheme.colors.success).toBe("green");
    expect(lightTheme.colors.success).toBe("green");
  });

  test("warning color is consistent", () => {
    expect(darkTheme.colors.warning).toBe("yellow");
    expect(lightTheme.colors.warning).toBe("yellow");
  });
});

// ============================================================================
// getThemeByName Tests
// ============================================================================

describe("getThemeByName", () => {
  test("returns darkTheme for 'dark'", () => {
    expect(getThemeByName("dark")).toBe(darkTheme);
  });

  test("returns lightTheme for 'light'", () => {
    expect(getThemeByName("light")).toBe(lightTheme);
  });

  test("is case insensitive", () => {
    expect(getThemeByName("DARK")).toBe(darkTheme);
    expect(getThemeByName("Light")).toBe(lightTheme);
    expect(getThemeByName("LIGHT")).toBe(lightTheme);
  });

  test("defaults to darkTheme for unknown names", () => {
    expect(getThemeByName("unknown")).toBe(darkTheme);
    expect(getThemeByName("")).toBe(darkTheme);
    expect(getThemeByName("invalid")).toBe(darkTheme);
  });
});

// ============================================================================
// getMessageColor Tests
// ============================================================================

describe("getMessageColor", () => {
  test("returns user color for user role", () => {
    expect(getMessageColor("user", darkTheme.colors)).toBe("cyan");
    expect(getMessageColor("user", lightTheme.colors)).toBe("blue");
  });

  test("returns assistant color for assistant role", () => {
    expect(getMessageColor("assistant", darkTheme.colors)).toBe("green");
    expect(getMessageColor("assistant", lightTheme.colors)).toBe("magenta");
  });

  test("returns system color for system role", () => {
    expect(getMessageColor("system", darkTheme.colors)).toBe("yellow");
    expect(getMessageColor("system", lightTheme.colors)).toBe("yellow");
  });
});

// ============================================================================
// createCustomTheme Tests
// ============================================================================

describe("createCustomTheme", () => {
  test("creates theme with partial overrides", () => {
    const custom = createCustomTheme(darkTheme, {
      background: "navy",
      foreground: "lightgray",
    });

    expect(custom.colors.background).toBe("navy");
    expect(custom.colors.foreground).toBe("lightgray");
    // Non-overridden colors should remain
    expect(custom.colors.accent).toBe(darkTheme.colors.accent);
    expect(custom.colors.error).toBe(darkTheme.colors.error);
  });

  test("preserves isDark from base theme", () => {
    const customDark = createCustomTheme(darkTheme, { background: "navy" });
    const customLight = createCustomTheme(lightTheme, { background: "cream" });

    expect(customDark.isDark).toBe(true);
    expect(customLight.isDark).toBe(false);
  });

  test("generates default custom name", () => {
    const custom = createCustomTheme(darkTheme, { background: "navy" });
    expect(custom.name).toBe("dark-custom");

    const customLight = createCustomTheme(lightTheme, { background: "cream" });
    expect(customLight.name).toBe("light-custom");
  });

  test("allows custom name override", () => {
    const custom = createCustomTheme(darkTheme, {
      name: "midnight",
      background: "navy",
    });
    expect(custom.name).toBe("midnight");
  });

  test("creates new object, not mutation", () => {
    const custom = createCustomTheme(darkTheme, { background: "navy" });
    expect(custom).not.toBe(darkTheme);
    expect(custom.colors).not.toBe(darkTheme.colors);
    expect(darkTheme.colors.background).toBe("black");
  });
});

// ============================================================================
// Type Tests
// ============================================================================

describe("Theme interface", () => {
  test("Theme type structure", () => {
    const theme: Theme = {
      name: "test",
      isDark: true,
      colors: {
        background: "black",
        foreground: "white",
        accent: "blue",
        border: "gray",
        userMessage: "cyan",
        assistantMessage: "green",
        systemMessage: "yellow",
        error: "red",
        success: "green",
        warning: "yellow",
        muted: "gray",
        inputFocus: "green",
        inputStreaming: "yellow",
      },
    };

    expect(theme.name).toBe("test");
    expect(theme.isDark).toBe(true);
    expect(Object.keys(theme.colors).length).toBe(13);
  });
});

describe("ThemeColors interface", () => {
  test("ThemeColors type structure", () => {
    const colors: ThemeColors = {
      background: "black",
      foreground: "white",
      accent: "blue",
      border: "gray",
      userMessage: "cyan",
      assistantMessage: "green",
      systemMessage: "yellow",
      error: "red",
      success: "green",
      warning: "yellow",
      muted: "gray",
      inputFocus: "green",
      inputStreaming: "yellow",
    };

    expect(colors.background).toBe("black");
    expect(colors.error).toBe("red");
  });
});

describe("ThemeContextValue interface", () => {
  test("ThemeContextValue type structure", () => {
    const contextValue: ThemeContextValue = {
      theme: darkTheme,
      toggleTheme: () => {},
      setTheme: () => {},
      isDark: true,
    };

    expect(contextValue.theme).toBe(darkTheme);
    expect(contextValue.isDark).toBe(true);
    expect(typeof contextValue.toggleTheme).toBe("function");
    expect(typeof contextValue.setTheme).toBe("function");
  });
});

describe("ThemeProviderProps interface", () => {
  test("ThemeProviderProps type structure", () => {
    const props: ThemeProviderProps = {
      initialTheme: darkTheme,
      children: null,
    };

    expect(props.initialTheme).toBe(darkTheme);
  });

  test("initialTheme is optional", () => {
    const props: ThemeProviderProps = {
      children: null,
    };

    expect(props.initialTheme).toBeUndefined();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Theme integration", () => {
  test("can create multiple custom themes from same base", () => {
    const midnight = createCustomTheme(darkTheme, {
      name: "midnight",
      background: "navy",
    });
    const charcoal = createCustomTheme(darkTheme, {
      name: "charcoal",
      background: "#333333",
    });

    expect(midnight.name).toBe("midnight");
    expect(charcoal.name).toBe("charcoal");
    expect(midnight.colors.background).not.toBe(charcoal.colors.background);
    expect(midnight.isDark).toBe(charcoal.isDark);
  });

  test("getMessageColor works with custom themes", () => {
    const custom = createCustomTheme(darkTheme, {
      userMessage: "orange",
      assistantMessage: "purple",
    });

    expect(getMessageColor("user", custom.colors)).toBe("orange");
    expect(getMessageColor("assistant", custom.colors)).toBe("purple");
  });
});
