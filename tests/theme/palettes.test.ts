/**
 * Tests for src/theme/palettes.ts
 */

import { describe, expect, test } from "bun:test";
import { catppuccinMocha, catppuccinLatte, getCatppuccinPalette } from "@/theme/palettes.ts";
import type { CatppuccinPalette } from "@/theme/palettes.ts";

const PALETTE_KEYS: readonly (keyof CatppuccinPalette)[] = [
  "rosewater", "flamingo", "pink", "mauve", "red", "maroon",
  "peach", "yellow", "green", "teal", "sky", "sapphire",
  "blue", "lavender", "text", "subtext1", "subtext0",
  "overlay2", "overlay1", "overlay0", "surface2", "surface1",
  "surface0", "base", "mantle", "crust",
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

describe("catppuccinMocha", () => {
  test("is a non-null object", () => {
    expect(typeof catppuccinMocha).toBe("object");
    expect(catppuccinMocha).not.toBeNull();
  });

  test("contains all 26 required palette keys", () => {
    for (const key of PALETTE_KEYS) { expect(catppuccinMocha).toHaveProperty(key); }
  });

  test("has exactly 26 keys (no extra fields)", () => {
    expect(Object.keys(catppuccinMocha)).toHaveLength(PALETTE_KEYS.length);
  });

  test("every value is a valid 6-digit hex color", () => {
    for (const key of PALETTE_KEYS) { expect(catppuccinMocha[key]).toMatch(HEX_COLOR); }
  });

  test("matches the official Catppuccin Mocha base color", () => {
    expect(catppuccinMocha.base).toBe("#1e1e2e");
  });

  test("matches the official Catppuccin Mocha text color", () => {
    expect(catppuccinMocha.text).toBe("#cdd6f4");
  });

  test("accent colors are distinct", () => {
    const accents = [
      catppuccinMocha.rosewater, catppuccinMocha.flamingo, catppuccinMocha.pink,
      catppuccinMocha.mauve, catppuccinMocha.red, catppuccinMocha.maroon,
      catppuccinMocha.peach, catppuccinMocha.yellow, catppuccinMocha.green,
      catppuccinMocha.teal, catppuccinMocha.sky, catppuccinMocha.sapphire,
      catppuccinMocha.blue, catppuccinMocha.lavender,
    ];
    expect(new Set(accents).size).toBe(accents.length);
  });

  test("surface/background colors form a dark-to-light gradient", () => {
    const ordered = [
      catppuccinMocha.crust, catppuccinMocha.mantle, catppuccinMocha.base,
      catppuccinMocha.surface0, catppuccinMocha.surface1, catppuccinMocha.surface2,
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(parseInt(ordered[i + 1]!.slice(1), 16)).toBeGreaterThan(parseInt(ordered[i]!.slice(1), 16));
    }
  });
});

describe("catppuccinLatte", () => {
  test("contains all 26 required palette keys", () => {
    for (const key of PALETTE_KEYS) { expect(catppuccinLatte).toHaveProperty(key); }
  });

  test("has exactly 26 keys (no extra fields)", () => {
    expect(Object.keys(catppuccinLatte)).toHaveLength(PALETTE_KEYS.length);
  });

  test("every value is a valid 6-digit hex color", () => {
    for (const key of PALETTE_KEYS) { expect(catppuccinLatte[key]).toMatch(HEX_COLOR); }
  });

  test("matches the official Catppuccin Latte base color", () => {
    expect(catppuccinLatte.base).toBe("#eff1f5");
  });

  test("matches the official Catppuccin Latte text color", () => {
    expect(catppuccinLatte.text).toBe("#4c4f69");
  });

  test("accent colors are distinct", () => {
    const accents = [
      catppuccinLatte.rosewater, catppuccinLatte.flamingo, catppuccinLatte.pink,
      catppuccinLatte.mauve, catppuccinLatte.red, catppuccinLatte.maroon,
      catppuccinLatte.peach, catppuccinLatte.yellow, catppuccinLatte.green,
      catppuccinLatte.teal, catppuccinLatte.sky, catppuccinLatte.sapphire,
      catppuccinLatte.blue, catppuccinLatte.lavender,
    ];
    expect(new Set(accents).size).toBe(accents.length);
  });

  test("surface/background colors form a light-to-dark gradient", () => {
    const ordered = [
      catppuccinLatte.base, catppuccinLatte.mantle, catppuccinLatte.crust,
      catppuccinLatte.surface0, catppuccinLatte.surface1, catppuccinLatte.surface2,
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(parseInt(ordered[i + 1]!.slice(1), 16)).toBeLessThan(parseInt(ordered[i]!.slice(1), 16));
    }
  });
});

describe("palette contrast (Mocha vs Latte)", () => {
  test("both palettes have the same set of keys", () => {
    expect(Object.keys(catppuccinMocha).sort()).toEqual(Object.keys(catppuccinLatte).sort());
  });

  test("corresponding color values differ between palettes", () => {
    for (const key of PALETTE_KEYS) { expect(catppuccinMocha[key]).not.toBe(catppuccinLatte[key]); }
  });

  test("Mocha base is darker than Latte base", () => {
    expect(parseInt(catppuccinMocha.base.slice(1), 16)).toBeLessThan(parseInt(catppuccinLatte.base.slice(1), 16));
  });

  test("Mocha text is lighter than Latte text", () => {
    expect(parseInt(catppuccinMocha.text.slice(1), 16)).toBeGreaterThan(parseInt(catppuccinLatte.text.slice(1), 16));
  });
});

describe("getCatppuccinPalette", () => {
  test("returns catppuccinMocha when isDark is true", () => {
    expect(getCatppuccinPalette(true)).toBe(catppuccinMocha);
  });

  test("returns catppuccinLatte when isDark is false", () => {
    expect(getCatppuccinPalette(false)).toBe(catppuccinLatte);
  });

  test("returns the exact same object reference (identity, not copy)", () => {
    expect(getCatppuccinPalette(true)).toBe(getCatppuccinPalette(true));
    expect(getCatppuccinPalette(false)).toBe(getCatppuccinPalette(false));
  });

  test("returned palette satisfies CatppuccinPalette shape", () => {
    const palette = getCatppuccinPalette(true);
    for (const key of PALETTE_KEYS) {
      expect(palette).toHaveProperty(key);
      expect(typeof palette[key]).toBe("string");
    }
  });

  test("dark and light palettes are different objects", () => {
    expect(getCatppuccinPalette(true)).not.toBe(getCatppuccinPalette(false));
  });
});
