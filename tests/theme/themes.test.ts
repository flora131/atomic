/**
 * Tests for src/theme/themes.ts
 */

import { describe, expect, test } from "bun:test";
import { darkTheme, lightTheme, darkThemeAnsi, lightThemeAnsi } from "@/theme/themes.ts";
import type { Theme, ThemeColors } from "@/theme/types.ts";

const THEME_COLOR_KEYS: (keyof ThemeColors)[] = [
  "background", "foreground", "accent", "border",
  "userMessage", "assistantMessage", "systemMessage",
  "error", "success", "warning", "muted",
  "inputFocus", "inputStreaming",
  "userBubbleBg", "userBubbleFg", "dim",
  "scrollbarFg", "scrollbarBg", "codeBorder", "codeTitle",
];

const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

const ALL_THEMES: { label: string; theme: Theme }[] = [
  { label: "darkTheme", theme: darkTheme },
  { label: "lightTheme", theme: lightTheme },
  { label: "darkThemeAnsi", theme: darkThemeAnsi },
  { label: "lightThemeAnsi", theme: lightThemeAnsi },
];

describe("darkTheme", () => {
  test("has name 'dark'", () => { expect(darkTheme.name).toBe("dark"); });
  test("has isDark=true", () => { expect(darkTheme.isDark).toBe(true); });
  test("has all required ThemeColors fields", () => {
    for (const key of THEME_COLOR_KEYS) { expect(darkTheme.colors[key]).toBeDefined(); }
  });
  test("all color values are valid hex strings", () => {
    for (const key of THEME_COLOR_KEYS) { expect(darkTheme.colors[key]).toMatch(HEX_COLOR_REGEX); }
  });
  test("has exactly the right number of color keys", () => {
    expect(Object.keys(darkTheme.colors).length).toBe(THEME_COLOR_KEYS.length);
  });
  test("has a dark background (low luminance red channel)", () => {
    expect(parseInt(darkTheme.colors.background.slice(1, 3), 16)).toBeLessThan(64);
  });
  test("error is a red-ish color", () => {
    expect(parseInt(darkTheme.colors.error.slice(1, 3), 16)).toBeGreaterThan(parseInt(darkTheme.colors.error.slice(3, 5), 16));
  });
  test("success is a green-ish color", () => {
    expect(parseInt(darkTheme.colors.success.slice(3, 5), 16)).toBeGreaterThan(parseInt(darkTheme.colors.success.slice(1, 3), 16));
  });
  test("specific known colors (spot check)", () => {
    expect(darkTheme.colors.background).toBe("#1e1e2e");
    expect(darkTheme.colors.foreground).toBe("#cdd6f4");
    expect(darkTheme.colors.accent).toBe("#94e2d5");
    expect(darkTheme.colors.error).toBe("#f38ba8");
    expect(darkTheme.colors.success).toBe("#a6e3a1");
  });
});

describe("lightTheme", () => {
  test("has name 'light'", () => { expect(lightTheme.name).toBe("light"); });
  test("has isDark=false", () => { expect(lightTheme.isDark).toBe(false); });
  test("has all required ThemeColors fields", () => {
    for (const key of THEME_COLOR_KEYS) { expect(lightTheme.colors[key]).toBeDefined(); }
  });
  test("all color values are valid hex strings", () => {
    for (const key of THEME_COLOR_KEYS) { expect(lightTheme.colors[key]).toMatch(HEX_COLOR_REGEX); }
  });
  test("has exactly the right number of color keys", () => {
    expect(Object.keys(lightTheme.colors).length).toBe(THEME_COLOR_KEYS.length);
  });
  test("has a light background (high luminance red channel)", () => {
    expect(parseInt(lightTheme.colors.background.slice(1, 3), 16)).toBeGreaterThan(192);
  });
  test("background is lighter than darkTheme background", () => {
    expect(parseInt(lightTheme.colors.background.slice(1, 3), 16)).toBeGreaterThan(parseInt(darkTheme.colors.background.slice(1, 3), 16));
  });
  test("specific known colors (spot check)", () => {
    expect(lightTheme.colors.background).toBe("#eff1f5");
    expect(lightTheme.colors.foreground).toBe("#4c4f69");
    expect(lightTheme.colors.accent).toBe("#179299");
    expect(lightTheme.colors.error).toBe("#d20f39");
    expect(lightTheme.colors.success).toBe("#40a02b");
  });
});

describe("darkThemeAnsi", () => {
  test("has name 'dark'", () => { expect(darkThemeAnsi.name).toBe("dark"); });
  test("has isDark=true", () => { expect(darkThemeAnsi.isDark).toBe(true); });
  test("has all required ThemeColors fields", () => {
    for (const key of THEME_COLOR_KEYS) { expect(darkThemeAnsi.colors[key]).toBeDefined(); }
  });
  test("all color values are valid hex strings", () => {
    for (const key of THEME_COLOR_KEYS) { expect(darkThemeAnsi.colors[key]).toMatch(HEX_COLOR_REGEX); }
  });
  test("has exactly the right number of color keys", () => {
    expect(Object.keys(darkThemeAnsi.colors).length).toBe(THEME_COLOR_KEYS.length);
  });
});

describe("lightThemeAnsi", () => {
  test("has name 'light'", () => { expect(lightThemeAnsi.name).toBe("light"); });
  test("has isDark=false", () => { expect(lightThemeAnsi.isDark).toBe(false); });
  test("has all required ThemeColors fields", () => {
    for (const key of THEME_COLOR_KEYS) { expect(lightThemeAnsi.colors[key]).toBeDefined(); }
  });
  test("all color values are valid hex strings", () => {
    for (const key of THEME_COLOR_KEYS) { expect(lightThemeAnsi.colors[key]).toMatch(HEX_COLOR_REGEX); }
  });
  test("has exactly the right number of color keys", () => {
    expect(Object.keys(lightThemeAnsi.colors).length).toBe(THEME_COLOR_KEYS.length);
  });
});

describe("cross-theme invariants", () => {
  test("dark and light themes have different backgrounds", () => {
    expect(darkTheme.colors.background).not.toBe(lightTheme.colors.background);
  });
  test("dark and light themes have different foregrounds", () => {
    expect(darkTheme.colors.foreground).not.toBe(lightTheme.colors.foreground);
  });
  test("all themes have the same set of color keys", () => {
    for (const { theme } of ALL_THEMES) {
      expect(Object.keys(theme.colors).sort()).toEqual([...THEME_COLOR_KEYS].sort());
    }
  });
  test("dark themes have isDark=true, light themes have isDark=false", () => {
    expect(darkTheme.isDark).toBe(true);
    expect(darkThemeAnsi.isDark).toBe(true);
    expect(lightTheme.isDark).toBe(false);
    expect(lightThemeAnsi.isDark).toBe(false);
  });
  test("ANSI themes share the same name as their true-color counterparts", () => {
    expect(darkThemeAnsi.name).toBe(darkTheme.name);
    expect(lightThemeAnsi.name).toBe(lightTheme.name);
  });
  test("every theme satisfies the Theme interface shape", () => {
    for (const { theme } of ALL_THEMES) {
      expect(typeof theme.name).toBe("string");
      expect(theme.name.length).toBeGreaterThan(0);
      expect(typeof theme.isDark).toBe("boolean");
      expect(typeof theme.colors).toBe("object");
      expect(theme.colors).not.toBeNull();
    }
  });
  test("all color values across all themes are non-empty strings", () => {
    for (const { theme } of ALL_THEMES) {
      for (const key of THEME_COLOR_KEYS) {
        expect(typeof theme.colors[key]).toBe("string");
        expect(theme.colors[key].length).toBeGreaterThan(0);
      }
    }
  });
  test("message colors are distinct within each theme", () => {
    for (const { theme } of ALL_THEMES) {
      const { userMessage, assistantMessage, systemMessage } = theme.colors;
      expect(userMessage).not.toBe(assistantMessage);
      expect(userMessage).not.toBe(systemMessage);
      expect(assistantMessage).not.toBe(systemMessage);
    }
  });
  test("background and foreground are distinct within each theme", () => {
    for (const { theme } of ALL_THEMES) {
      expect(theme.colors.background).not.toBe(theme.colors.foreground);
    }
  });
  test("error, success, and warning are distinct within each theme", () => {
    for (const { theme } of ALL_THEMES) {
      expect(theme.colors.error).not.toBe(theme.colors.success);
      expect(theme.colors.error).not.toBe(theme.colors.warning);
      expect(theme.colors.success).not.toBe(theme.colors.warning);
    }
  });
});
