import { test, expect, describe } from "bun:test";
import { deriveGraphTheme } from "../../../packages/workflow-sdk/src/components/graph-theme.ts";
import type { TerminalTheme } from "../../../packages/workflow-sdk/src/runtime/theme.ts";

const fakeTheme: TerminalTheme = {
  bg: "#1e1e2e",
  surface: "#313244",
  selection: "#45475a",
  border: "#6c7086",
  borderDim: "#585b70",
  accent: "#89b4fa",
  text: "#cdd6f4",
  dim: "#7f849c",
  success: "#a6e3a1",
  error: "#f38ba8",
  warning: "#f9e2af",
};

describe("deriveGraphTheme", () => {
  test("maps background from theme bg", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.background).toBe(fakeTheme.bg);
  });

  test("maps backgroundElement from theme surface", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.backgroundElement).toBe(fakeTheme.surface);
  });

  test("maps text from theme text", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.text).toBe(fakeTheme.text);
  });

  test("computes textMuted as lerp between text and bg at 0.3", () => {
    const gt = deriveGraphTheme(fakeTheme);
    // textMuted should be a valid hex color string
    expect(gt.textMuted).toMatch(/^#[0-9a-f]{6}$/);
    // Should not equal raw text or bg
    expect(gt.textMuted).not.toBe(fakeTheme.text);
    expect(gt.textMuted).not.toBe(fakeTheme.bg);
  });

  test("maps textDim from theme dim", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.textDim).toBe(fakeTheme.dim);
  });

  test("maps primary from theme accent", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.primary).toBe(fakeTheme.accent);
  });

  test("maps success from theme success", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.success).toBe(fakeTheme.success);
  });

  test("maps error from theme error", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.error).toBe(fakeTheme.error);
  });

  test("maps warning from theme warning", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.warning).toBe(fakeTheme.warning);
  });

  test("maps info from theme accent", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.info).toBe(fakeTheme.accent);
  });

  test("maps border from theme borderDim", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.border).toBe(fakeTheme.borderDim);
  });

  test("maps borderActive from theme border", () => {
    const gt = deriveGraphTheme(fakeTheme);
    expect(gt.borderActive).toBe(fakeTheme.border);
  });

  test("returns all required GraphTheme keys", () => {
    const gt = deriveGraphTheme(fakeTheme);
    const keys = Object.keys(gt).sort();
    expect(keys).toEqual([
      "background",
      "backgroundElement",
      "border",
      "borderActive",
      "error",
      "info",
      "primary",
      "success",
      "text",
      "textDim",
      "textMuted",
      "warning",
    ]);
  });
});
