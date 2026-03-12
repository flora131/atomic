import type { Theme, ThemeColors } from "@/theme/types.ts";
import { darkTheme, lightTheme } from "@/theme/themes.ts";

export function getThemeByName(name: string): Theme {
  switch (name.toLowerCase()) {
    case "light":
      return lightTheme;
    case "dark":
    default:
      return darkTheme;
  }
}

export function getMessageColor(
  role: "user" | "assistant" | "system",
  colors: ThemeColors,
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

export function createCustomTheme(
  base: Theme,
  overrides: Partial<ThemeColors> & { name?: string },
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
