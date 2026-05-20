import { describe, expect, it } from "vitest";
import {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	getThemeByName,
	isLightTheme,
} from "../src/modes/interactive/theme/theme.ts";

const CATPPUCCIN_THEMES = [
	"catppuccin-frappe",
	"catppuccin-latte",
	"catppuccin-macchiato",
	"catppuccin-mocha",
] as const;

describe("built-in themes", () => {
	it("includes the bundled Catppuccin themes", () => {
		const availableThemes = getAvailableThemes();

		for (const themeName of CATPPUCCIN_THEMES) {
			expect(availableThemes).toContain(themeName);
		}
	});

	it("loads every bundled Catppuccin theme by name", () => {
		for (const themeName of CATPPUCCIN_THEMES) {
			expect(getThemeByName(themeName)?.name).toBe(themeName);
		}
	});

	it("reports built-in Catppuccin theme file paths", () => {
		const themePaths = new Map(getAvailableThemesWithPaths().map((theme) => [theme.name, theme.path]));

		for (const themeName of CATPPUCCIN_THEMES) {
			expect(themePaths.get(themeName)).toMatch(new RegExp(`${themeName}\\.json$`));
		}
	});

	it("treats Catppuccin Latte as a light theme", () => {
		expect(isLightTheme("catppuccin-latte")).toBe(true);
		expect(isLightTheme("catppuccin-mocha")).toBe(false);
	});
});
