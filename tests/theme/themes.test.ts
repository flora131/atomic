/**
 * Tests for src/theme/themes.ts
 *
 * Validates theme object definitions:
 * - darkTheme / lightTheme (primary themes)
 * - darkThemeAnsi / lightThemeAnsi (ANSI fallback themes)
 * - Structural conformance to the Theme / ThemeColors interfaces
 */

import { describe, expect, test } from "bun:test";
import {
  darkTheme,
  lightTheme,
  darkThemeAnsi,
  lightThemeAnsi,
} from "@/theme/themes.ts";
import type { Theme, ThemeColors } from "@/theme/types.ts";

const COLOR_KEYS: readonly (keyof ThemeColors)[] = [
  "background", "foreground", "accent", "border",
  "userMessage", "assistantMessage", "systemMessage",
  "error", "success", "warning", "muted",
  "inputFocus", "inputStreaming", "userBubbleBg", "userBubbleFg",
  "dim", "scrollbarFg", "scrollbarBg", "codeBorder", "codeTitle",
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

function assertValidTheme(theme: Theme, expectedName: string, expectedIsDark: boolean): void {
  expect(theme.name).toBe(expectedName);
  expect(theme.isDark).toBe(expectedIsDark);
  expect(typeof theme.colors).toBe("object");
  expect(theme.colors).not.toBeNull();
  for (const key of COLOR_KEYS) {
    expect(theme.colors).toHaveProperty(key);
    expect(typeof theme.colors[key]).toBe("string");
    expect(theme.colors[key]).toMatch(HEX_COLOR);
  }
  expect(Object.keys(theme.colors)).toHaveLength(COLOR_KEYS.length);
}

describe("darkTheme", () => {
  test("has name 'dark'", () => { expect(darkTheme.name).toBe("dark"); });
  test("isDark is true", () => { expect(darkTheme.isDark).toBe(true); });
  test("satisfies Theme interface with all 20 color keys as valid hex values", () => {
    assertValidTheme(darkTheme, "dark", true);
  });
  test("background is dark (low luminance hex value)", () => {
    expect(parseInt(darkTheme.colors.background.slice(1), 16)).toBeLessThan(0x808080);
  });
  test("foreground is light (high luminance hex value)", () => {
    expect(parseInt(darkTheme.colors.foreground.slice(1), 16)).toBeGreaterThan(0x808080);
  });
  test("semantic colors are present and non-empty", () => {
    expect(darkTheme.colors.error).toBeTruthy();
    expect(darkTheme.colors.success).toBeTruthy();
    expect(darkTheme.colors.warning).toBeTruthy();
  });
  test("uses Catppuccin Mocha base as background", () => {
    expect(darkTheme.colors.background).toBe("#1e1e2e");
  });
  test("uses Catppuccin Mocha text as foreground", () => {
    expect(darkTheme.colors.foreground).toBe("#cdd6f4");
  });
});

describe("lightTheme", () => {
  test("has name 'light'", () => { expect(lightTheme.name).toBe("light"); });
  test("isDark is false", () => { expect(lightTheme.isDark).toBe(false); });
  test("satisfies Theme interface with all 20 color keys as valid hex values", () => {
    assertValidTheme(lightTheme, "light", false);
  });
  test("background is light (high luminance hex value)", () => {
    expect(parseInt(lightTheme.colors.background.slice(1), 16)).toBeGreaterThan(0x808080);
  });
  test("foreground is dark (low luminance hex value)", () => {
    expect(parseInt(lightTheme.colors.foreground.slice(1), 16)).toBeLessThan(0x808080);
  });
  test("uses Catppuccin Latte base as background", () => {
    expect(lightTheme.colors.background).toBe("#eff1f5");
  });
  test("uses Catppuccin Latte text as foreground", () => {
    expect(lightTheme.colors.foreground).toBe("#4c4f69");
  });
});

describe("darkThemeAnsi", () => {
  test("has name 'dark'", () => { expect(darkThemeAnsi.name).toBe("dark"); });
  test("isDark is true", () => { expect(darkThemeAnsi.isDark).toBe(true); });
  test("satisfies Theme interface with all 20 color keys as valid hex values", () => {
    assertValidTheme(darkThemeAnsi, "dark", true);
  });
  test("has the same color values as darkTheme", () => {
    for (const key of COLOR_KEYS) {
      expect(darkThemeAnsi.colors[key]).toBe(darkTheme.colors[key]);
    }
  });
  test("is a distinct object reference from darkTheme", () => {
    expect(darkThemeAnsi).not.toBe(darkTheme);
    expect(darkThemeAnsi.colors).not.toBe(darkTheme.colors);
  });
});

describe("lightThemeAnsi", () => {
  test("has name 'light'", () => { expect(lightThemeAnsi.name).toBe("light"); });
  test("isDark is false", () => { expect(lightThemeAnsi.isDark).toBe(false); });
  test("satisfies Theme interface with all 20 color keys as valid hex values", () => {
    assertValidTheme(lightThemeAnsi, "light", false);
  });
  test("has the same color values as lightTheme", () => {
    for (const key of COLOR_KEYS) {
      expect(lightThemeAnsi.colors[key]).toBe(lightTheme.colors[key]);
    }
  });
  test("is a distinct object reference from lightTheme", () => {
    expect(lightThemeAnsi).not.toBe(lightTheme);
    expect(lightThemeAnsi.colors).not.toBe(lightTheme.colors);
  });
});

describe("cross-theme invariants", () => {
  const allThemes: readonly Theme[] = [darkTheme, lightTheme, darkThemeAnsi, lightThemeAnsi];

  test("all four themes are distinct objects", () => {
    for (let i = 0; i < allThemes.length; i++) {
      for (let j = i + 1; j < allThemes.length; j++) {
        expect(allThemes[i]).not.toBe(allThemes[j]);
      }
    }
  });

  test("dark themes have darker backgrounds than light themes", () => {
    expect(parseInt(darkTheme.colors.background.slice(1), 16))
      .toBeLessThan(parseInt(lightTheme.colors.background.slice(1), 16));
  });

  test("dark themes have lighter foregrounds than light themes", () => {
    expect(parseInt(darkTheme.colors.foreground.slice(1), 16))
      .toBeGreaterThan(parseInt(lightTheme.colors.foreground.slice(1), 16));
  });

  test("message role colors differ between dark and light themes", () => {
    const roleKeys: (keyof ThemeColors)[] = ["userMessage", "assistantMessage", "systemMessage"];
    for (const key of roleKeys) {
      expect(darkTheme.colors[key]).not.toBe(lightTheme.colors[key]);
    }
  });

  test("every theme has distinct error, success, and warning colors", () => {
    for (const theme of allThemes) {
      const semanticColors = new Set([theme.colors.error, theme.colors.success, theme.colors.warning]);
      expect(semanticColors.size).toBe(3);
    }
  });

  test("every theme has distinct role colors (user, assistant, system)", () => {
    for (const theme of allThemes) {
      const roleColors = new Set([theme.colors.userMessage, theme.colors.assistantMessage, theme.colors.systemMessage]);
      expect(roleColors.size).toBe(3);
    }
  });

  test("accent and codeTitle colors are consistent within each theme", () => {
    expect(darkTheme.colors.accent).toBe(darkTheme.colors.codeTitle);
    expect(lightTheme.colors.accent).toBe(lightTheme.colors.codeTitle);
  });

  test("border and codeBorder colors are consistent within each theme", () => {
    expect(darkTheme.colors.border).toBe(darkTheme.colors.codeBorder);
    expect(lightTheme.colors.border).toBe(lightTheme.colors.codeBorder);
  });
});
