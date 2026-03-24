/**
 * Tests for src/theme/helpers.ts
 *
 * Pure function tests for theme helper utilities:
 * - getThemeByName: theme lookup by string name
 * - getMessageColor: role-based color resolution
 * - createCustomTheme: theme derivation with overrides
 */

import { describe, expect, test } from "bun:test";
import {
  getThemeByName,
  getMessageColor,
  createCustomTheme,
} from "@/theme/helpers.ts";
import { darkTheme, lightTheme } from "@/theme/themes.ts";
import type { ThemeColors } from "@/theme/types.ts";

// --- getThemeByName ---

describe("getThemeByName", () => {
  test("returns darkTheme for 'dark'", () => {
    expect(getThemeByName("dark")).toBe(darkTheme);
  });

  test("returns lightTheme for 'light'", () => {
    expect(getThemeByName("light")).toBe(lightTheme);
  });

  test("is case-insensitive", () => {
    expect(getThemeByName("Dark")).toBe(darkTheme);
    expect(getThemeByName("DARK")).toBe(darkTheme);
    expect(getThemeByName("Light")).toBe(lightTheme);
    expect(getThemeByName("LIGHT")).toBe(lightTheme);
  });

  test("handles mixed case", () => {
    expect(getThemeByName("dArK")).toBe(darkTheme);
    expect(getThemeByName("LiGhT")).toBe(lightTheme);
  });

  test("defaults to darkTheme for unknown names", () => {
    expect(getThemeByName("neon")).toBe(darkTheme);
    expect(getThemeByName("solarized")).toBe(darkTheme);
    expect(getThemeByName("dracula")).toBe(darkTheme);
  });

  test("defaults to darkTheme for empty string", () => {
    expect(getThemeByName("")).toBe(darkTheme);
  });

  test("defaults to darkTheme for whitespace-only strings", () => {
    expect(getThemeByName(" ")).toBe(darkTheme);
    expect(getThemeByName("  dark  ")).toBe(darkTheme);
  });

  test("returns the exact same object reference (not a copy)", () => {
    const d = getThemeByName("dark");
    const d2 = getThemeByName("dark");
    expect(d).toBe(d2);
    const l = getThemeByName("light");
    const l2 = getThemeByName("light");
    expect(l).toBe(l2);
  });

  test("returned theme satisfies Theme interface shape", () => {
    const theme = getThemeByName("dark");
    expect(typeof theme.name).toBe("string");
    expect(typeof theme.isDark).toBe("boolean");
    expect(typeof theme.colors).toBe("object");
    expect(theme.colors).not.toBeNull();
  });
});

// --- getMessageColor ---

describe("getMessageColor", () => {
  describe("with darkTheme colors", () => {
    const colors = darkTheme.colors;

    test("returns userMessage for 'user' role", () => {
      expect(getMessageColor("user", colors)).toBe(colors.userMessage);
    });

    test("returns assistantMessage for 'assistant' role", () => {
      expect(getMessageColor("assistant", colors)).toBe(colors.assistantMessage);
    });

    test("returns systemMessage for 'system' role", () => {
      expect(getMessageColor("system", colors)).toBe(colors.systemMessage);
    });
  });

  describe("with lightTheme colors", () => {
    const colors = lightTheme.colors;

    test("returns userMessage for 'user' role", () => {
      expect(getMessageColor("user", colors)).toBe(colors.userMessage);
    });

    test("returns assistantMessage for 'assistant' role", () => {
      expect(getMessageColor("assistant", colors)).toBe(colors.assistantMessage);
    });

    test("returns systemMessage for 'system' role", () => {
      expect(getMessageColor("system", colors)).toBe(colors.systemMessage);
    });
  });

  test("returns different colors for different roles", () => {
    const colors = darkTheme.colors;
    const userColor = getMessageColor("user", colors);
    const assistantColor = getMessageColor("assistant", colors);
    const systemColor = getMessageColor("system", colors);
    expect(userColor).not.toBe(assistantColor);
    expect(userColor).not.toBe(systemColor);
    expect(assistantColor).not.toBe(systemColor);
  });

  test("dark and light themes return different colors for the same role", () => {
    const darkUserColor = getMessageColor("user", darkTheme.colors);
    const lightUserColor = getMessageColor("user", lightTheme.colors);
    expect(darkUserColor).not.toBe(lightUserColor);
  });

  test("returned values are valid hex color strings", () => {
    const roles: Array<"user" | "assistant" | "system"> = ["user", "assistant", "system"];
    for (const role of roles) {
      const color = getMessageColor(role, darkTheme.colors);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// --- createCustomTheme ---

describe("createCustomTheme", () => {
  test("overrides specific color fields", () => {
    const custom = createCustomTheme(darkTheme, { foreground: "#ffffff", accent: "#ff0000" });
    expect(custom.colors.foreground).toBe("#ffffff");
    expect(custom.colors.accent).toBe("#ff0000");
  });

  test("preserves non-overridden color fields from the base", () => {
    const custom = createCustomTheme(darkTheme, { foreground: "#ffffff" });
    expect(custom.colors.background).toBe(darkTheme.colors.background);
    expect(custom.colors.error).toBe(darkTheme.colors.error);
    expect(custom.colors.success).toBe(darkTheme.colors.success);
    expect(custom.colors.warning).toBe(darkTheme.colors.warning);
    expect(custom.colors.muted).toBe(darkTheme.colors.muted);
    expect(custom.colors.border).toBe(darkTheme.colors.border);
    expect(custom.colors.accent).toBe(darkTheme.colors.accent);
    expect(custom.colors.userMessage).toBe(darkTheme.colors.userMessage);
    expect(custom.colors.assistantMessage).toBe(darkTheme.colors.assistantMessage);
    expect(custom.colors.systemMessage).toBe(darkTheme.colors.systemMessage);
  });

  test("overrides theme name when provided", () => {
    const custom = createCustomTheme(darkTheme, { name: "my-theme" });
    expect(custom.name).toBe("my-theme");
  });

  test("auto-generates name suffix '-custom' when name not provided", () => {
    const customDark = createCustomTheme(darkTheme, { foreground: "#fff" });
    expect(customDark.name).toBe("dark-custom");
    const customLight = createCustomTheme(lightTheme, { foreground: "#000" });
    expect(customLight.name).toBe("light-custom");
  });

  test("preserves isDark from the base theme", () => {
    const customDark = createCustomTheme(darkTheme, {});
    expect(customDark.isDark).toBe(true);
    const customLight = createCustomTheme(lightTheme, {});
    expect(customLight.isDark).toBe(false);
  });

  test("does not mutate the base theme", () => {
    const originalBg = darkTheme.colors.background;
    const originalFg = darkTheme.colors.foreground;
    const originalName = darkTheme.name;
    createCustomTheme(darkTheme, { background: "#000000", foreground: "#ffffff", name: "mutated" });
    expect(darkTheme.colors.background).toBe(originalBg);
    expect(darkTheme.colors.foreground).toBe(originalFg);
    expect(darkTheme.name).toBe(originalName);
  });

  test("returns a new Theme object (not the base reference)", () => {
    const custom = createCustomTheme(darkTheme, {});
    expect(custom).not.toBe(darkTheme);
    expect(custom.colors).not.toBe(darkTheme.colors);
  });

  test("works with empty overrides", () => {
    const custom = createCustomTheme(darkTheme, {});
    expect(custom.name).toBe("dark-custom");
    expect(custom.isDark).toBe(darkTheme.isDark);
    for (const key of Object.keys(darkTheme.colors) as (keyof ThemeColors)[]) {
      expect(custom.colors[key]).toBe(darkTheme.colors[key]);
    }
  });

  test("works when overriding all color fields", () => {
    const allOverrides: Partial<ThemeColors> = {
      background: "#000000", foreground: "#ffffff", accent: "#ff0000",
      border: "#333333", userMessage: "#0000ff", assistantMessage: "#00ff00",
      systemMessage: "#ff00ff", error: "#ff0000", success: "#00ff00",
      warning: "#ffff00", muted: "#888888", inputFocus: "#444444",
      inputStreaming: "#555555", userBubbleBg: "#222222", userBubbleFg: "#eeeeee",
      dim: "#666666", scrollbarFg: "#777777", scrollbarBg: "#111111",
      codeBorder: "#333333", codeTitle: "#00ffff",
    };
    const custom = createCustomTheme(darkTheme, allOverrides);
    for (const [key, value] of Object.entries(allOverrides)) {
      expect(custom.colors[key as keyof ThemeColors]).toBe(value);
    }
  });

  test("can derive a custom theme from lightTheme", () => {
    const custom = createCustomTheme(lightTheme, { background: "#f0f0f0", name: "custom-light" });
    expect(custom.name).toBe("custom-light");
    expect(custom.isDark).toBe(false);
    expect(custom.colors.background).toBe("#f0f0f0");
    expect(custom.colors.foreground).toBe(lightTheme.colors.foreground);
  });

  test("can chain theme derivation", () => {
    const first = createCustomTheme(darkTheme, { accent: "#ff0000" });
    const second = createCustomTheme(first, { accent: "#00ff00", name: "chained" });
    expect(second.name).toBe("chained");
    expect(second.colors.accent).toBe("#00ff00");
    expect(second.colors.background).toBe(darkTheme.colors.background);
    expect(second.isDark).toBe(true);
  });
});
