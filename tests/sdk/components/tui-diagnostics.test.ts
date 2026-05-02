import { describe, expect, test } from "bun:test";
import { OptimizedBuffer, RGBA } from "@opentui/core";
import {
  isTuiDiagnosticsEnabled,
  summarizeBuffer,
} from "../../../src/sdk/components/tui-diagnostics.ts";

describe("isTuiDiagnosticsEnabled", () => {
  test("requires an explicit opt-in value", () => {
    const previous = process.env.ATOMIC_TUI_DIAGNOSTICS;
    delete process.env.ATOMIC_TUI_DIAGNOSTICS;
    try {
      expect(isTuiDiagnosticsEnabled()).toBe(false);
      process.env.ATOMIC_TUI_DIAGNOSTICS = "1";
      expect(isTuiDiagnosticsEnabled()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ATOMIC_TUI_DIAGNOSTICS;
      else process.env.ATOMIC_TUI_DIAGNOSTICS = previous;
    }
  });
});

describe("summarizeBuffer", () => {
  test("groups background colors and flags yellow-hue cells", () => {
    const buffer = OptimizedBuffer.create(4, 2, "unicode");
    try {
      const text = RGBA.fromInts(255, 255, 255, 255);
      const dark = RGBA.fromInts(30, 30, 46, 255);
      const yellow = RGBA.fromInts(249, 226, 175, 255);

      for (let x = 0; x < 4; x++) {
        buffer.setCell(x, 0, "a", text, x < 2 ? yellow : dark);
        buffer.setCell(x, 1, "b", text, dark);
      }

      const summary = summarizeBuffer(buffer);

      expect(summary.width).toBe(4);
      expect(summary.height).toBe(2);
      expect(summary.topBackgrounds[0]).toEqual({
        color: "#1e1e2e",
        count: 6,
        percent: 75,
      });
      expect(summary.topBackgrounds[1]).toEqual({
        color: "#f9e2af",
        count: 2,
        percent: 25,
      });
      expect(summary.yellowHueCells).toBe(2);
      expect(summary.rows[0]?.backgrounds).toEqual([
        { x: 0, width: 2, color: "#f9e2af" },
        { x: 2, width: 2, color: "#1e1e2e" },
      ]);
    } finally {
      buffer.destroy();
    }
  });
});
