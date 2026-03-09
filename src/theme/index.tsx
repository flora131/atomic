import {
  ThemeContext,
  ThemeProvider,
  useTheme,
  useThemeColors,
} from "@/theme/context.tsx";
import { catppuccinLatte, catppuccinMocha, getCatppuccinPalette } from "@/theme/palettes.ts";
import { createCustomTheme, getMessageColor, getThemeByName } from "@/theme/helpers.ts";
import { darkTheme, darkThemeAnsi, lightTheme, lightThemeAnsi } from "@/theme/themes.ts";

export type { CatppuccinPalette } from "@/theme/palettes.ts";
export type { Theme, ThemeColors, ThemeContextValue } from "@/theme/types.ts";
export type { ThemeProviderProps } from "@/theme/context.tsx";
export { ThemeContext, ThemeProvider, useTheme, useThemeColors } from "@/theme/context.tsx";
export { catppuccinLatte, catppuccinMocha, getCatppuccinPalette } from "@/theme/palettes.ts";
export { darkTheme, darkThemeAnsi, lightTheme, lightThemeAnsi } from "@/theme/themes.ts";
export { createCustomTheme, getMessageColor, getThemeByName } from "@/theme/helpers.ts";
export { createDimmedSyntaxStyle, createMarkdownSyntaxStyle } from "@/theme/syntax.ts";

export default {
  darkTheme,
  darkThemeAnsi,
  lightTheme,
  lightThemeAnsi,
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
