/**
 * Tests for createDimmedSyntaxStyle()
 *
 * Verifies that the dimmed variant produces a valid SyntaxStyle
 * with reduced-opacity foreground colors.
 */

import { describe, expect, test } from "bun:test";
import { SyntaxStyle, RGBA } from "@opentui/core";
import { createDimmedSyntaxStyle, createMarkdownSyntaxStyle } from "./theme.tsx";

// Simple base style for isolated tests
function makeBaseStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex("#cba6f7"), bold: true },
    string: { fg: RGBA.fromHex("#a6e3a1") },
    comment: { fg: RGBA.fromHex("#9399b2"), italic: true },
    default: { fg: RGBA.fromHex("#cdd6f4") },
  });
}

describe("createDimmedSyntaxStyle", () => {
  test("returns a valid SyntaxStyle instance", () => {
    const base = makeBaseStyle();
    const dimmed = createDimmedSyntaxStyle(base, 0.6);
    expect(dimmed).toBeInstanceOf(SyntaxStyle);
    base.destroy();
    dimmed.destroy();
  });

  test("preserves all style names from the base", () => {
    const base = makeBaseStyle();
    const dimmed = createDimmedSyntaxStyle(base, 0.6);

    const baseNames = base.getRegisteredNames().sort();
    const dimmedNames = dimmed.getRegisteredNames().sort();
    expect(dimmedNames).toEqual(baseNames);

    base.destroy();
    dimmed.destroy();
  });

  test("reduces alpha channel of foreground colors by the opacity factor", () => {
    const base = makeBaseStyle();
    const dimmed = createDimmedSyntaxStyle(base, 0.5);

    const baseDef = base.getStyle("keyword");
    const dimmedDef = dimmed.getStyle("keyword");

    expect(baseDef).toBeDefined();
    expect(dimmedDef).toBeDefined();
    expect(dimmedDef!.fg).toBeDefined();

    // The dimmed alpha should be approximately baseAlpha * 0.5
    const baseAlpha = baseDef!.fg!.a;
    const dimmedAlpha = dimmedDef!.fg!.a;
    expect(dimmedAlpha).toBeCloseTo(baseAlpha * 0.5, 2);

    base.destroy();
    dimmed.destroy();
  });

  test("preserves non-fg style properties (bold, italic)", () => {
    const base = makeBaseStyle();
    const dimmed = createDimmedSyntaxStyle(base, 0.6);

    const keywordDef = dimmed.getStyle("keyword");
    expect(keywordDef!.bold).toBe(true);

    const commentDef = dimmed.getStyle("comment");
    expect(commentDef!.italic).toBe(true);

    base.destroy();
    dimmed.destroy();
  });

  test("uses default opacity of 0.6 when not specified", () => {
    const base = makeBaseStyle();
    const dimmed = createDimmedSyntaxStyle(base);

    const baseDef = base.getStyle("string");
    const dimmedDef = dimmed.getStyle("string");

    const baseAlpha = baseDef!.fg!.a;
    const dimmedAlpha = dimmedDef!.fg!.a;
    expect(dimmedAlpha).toBeCloseTo(baseAlpha * 0.6, 2);

    base.destroy();
    dimmed.destroy();
  });

  test("works with the full markdown syntax style", () => {
    const colors = {
      foreground: "#cdd6f4",
      background: "#1e1e2e",
      accent: "#94e2d5",
      muted: "#6c7086",
      error: "#f38ba8",
      warning: "#f9e2af",
      success: "#a6e3a1",
      info: "#89b4fa",
      border: "#45475a",
      surface: "#313244",
      overlay: "#585b70",
    };
    const full = createMarkdownSyntaxStyle(colors as any, true);
    const dimmed = createDimmedSyntaxStyle(full, 0.6);

    expect(dimmed).toBeInstanceOf(SyntaxStyle);
    expect(dimmed.getStyleCount()).toBe(full.getStyleCount());

    full.destroy();
    dimmed.destroy();
  });
});
