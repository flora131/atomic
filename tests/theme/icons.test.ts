/**
 * Tests for src/theme/icons.ts
 */

import { describe, expect, test } from "bun:test";
import {
  STATUS, TREE, CONNECTOR, ARROW, PROMPT,
  SPINNER_FRAMES, SPINNER_COMPLETE,
  PROGRESS, CHECKBOX, SCROLLBAR, TASK,
  SEPARATOR, MISC,
} from "@/theme/icons.ts";

function assertAllNonEmptyStrings(obj: Readonly<Record<string, string>>): void {
  for (const [_key, value] of Object.entries(obj)) {
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  }
}

describe("STATUS", () => {
  test("has expected keys", () => {
    for (const k of ["pending", "active", "error", "background", "selected", "success"]) {
      expect(STATUS).toHaveProperty(k);
    }
  });
  test("has exactly 6 keys", () => { expect(Object.keys(STATUS)).toHaveLength(6); });
  test("all values are non-empty strings", () => { assertAllNonEmptyStrings(STATUS); });
  test("specific character values", () => {
    expect(STATUS.pending).toBe("\u25CB");
    expect(STATUS.active).toBe("\u25CF");
    expect(STATUS.error).toBe("\u2717");
    expect(STATUS.success).toBe("\u2713");
    expect(STATUS.selected).toBe("\u25C9");
  });
});

describe("TREE", () => {
  test("has expected keys", () => {
    for (const k of ["branch", "lastBranch", "vertical", "space"]) { expect(TREE).toHaveProperty(k); }
  });
  test("has exactly 4 keys", () => { expect(Object.keys(TREE)).toHaveLength(4); });
  test("all values are non-empty strings", () => { assertAllNonEmptyStrings(TREE); });
  test("branch uses box-drawing characters", () => {
    expect(TREE.branch).toBe("\u251C\u2500");
    expect(TREE.lastBranch).toBe("\u2514\u2500");
  });
});

describe("CONNECTOR", () => {
  test("has expected keys", () => {
    for (const k of ["subStatus", "horizontal", "roundedTopLeft", "roundedTopRight"]) { expect(CONNECTOR).toHaveProperty(k); }
  });
  test("has exactly 4 keys", () => { expect(Object.keys(CONNECTOR)).toHaveLength(4); });
  test("all values are non-empty strings", () => { assertAllNonEmptyStrings(CONNECTOR); });
  test("specific character values", () => {
    expect(CONNECTOR.subStatus).toBe("\u2570");
    expect(CONNECTOR.horizontal).toBe("\u2500");
    expect(CONNECTOR.roundedTopLeft).toBe("\u256D");
    expect(CONNECTOR.roundedTopRight).toBe("\u256E");
  });
});

describe("ARROW", () => {
  test("has expected keys", () => {
    for (const k of ["right", "up", "down"]) { expect(ARROW).toHaveProperty(k); }
  });
  test("has exactly 3 keys", () => { expect(Object.keys(ARROW)).toHaveLength(3); });
  test("all values are non-empty strings", () => { assertAllNonEmptyStrings(ARROW); });
  test("specific character values", () => {
    expect(ARROW.right).toBe("\u2192");
    expect(ARROW.up).toBe("\u2191");
    expect(ARROW.down).toBe("\u2193");
  });
  test("all arrows are distinct", () => {
    expect(new Set(Object.values(ARROW)).size).toBe(Object.values(ARROW).length);
  });
});

describe("PROMPT", () => {
  test("has expected keys", () => {
    for (const k of ["cursor", "editPrefix"]) { expect(PROMPT).toHaveProperty(k); }
  });
  test("has exactly 2 keys", () => { expect(Object.keys(PROMPT)).toHaveLength(2); });
  test("all values are non-empty strings", () => { assertAllNonEmptyStrings(PROMPT); });
  test("cursor and editPrefix are distinct", () => { expect(PROMPT.cursor).not.toBe(PROMPT.editPrefix); });
  test("specific character values", () => {
    expect(PROMPT.cursor).toBe("\u276F");
    expect(PROMPT.editPrefix).toBe("\u203A");
  });
});

describe("SPINNER_FRAMES", () => {
  test("is an array with 8 frames", () => {
    expect(Array.isArray(SPINNER_FRAMES)).toBe(true);
    expect(SPINNER_FRAMES).toHaveLength(8);
  });
  test("all frames are non-empty strings", () => {
    for (const frame of SPINNER_FRAMES) {
      expect(typeof frame).toBe("string");
      expect(frame.length).toBeGreaterThan(0);
    }
  });
  test("all frames are braille characters (U+2800-U+28FF range)", () => {
    for (const frame of SPINNER_FRAMES) {
      const cp = frame.codePointAt(0)!;
      expect(cp).toBeGreaterThanOrEqual(0x2800);
      expect(cp).toBeLessThanOrEqual(0x28ff);
    }
  });
  test("all frames are distinct", () => {
    expect(new Set(SPINNER_FRAMES).size).toBe(SPINNER_FRAMES.length);
  });
});

describe("SPINNER_COMPLETE", () => {
  test("is a non-empty string", () => {
    expect(typeof SPINNER_COMPLETE).toBe("string");
    expect(SPINNER_COMPLETE.length).toBeGreaterThan(0);
  });
  test("is the full braille block character (U+28FF)", () => { expect(SPINNER_COMPLETE).toBe("\u28FF"); });
  test("is not one of the spinner frames", () => {
    for (const frame of SPINNER_FRAMES) { expect(SPINNER_COMPLETE).not.toBe(frame); }
  });
});

describe("PROGRESS", () => {
  test("has expected keys", () => {
    for (const k of ["filled", "empty"]) { expect(PROGRESS).toHaveProperty(k); }
  });
  test("has exactly 2 keys", () => { expect(Object.keys(PROGRESS)).toHaveLength(2); });
  test("filled and empty are distinct", () => { expect(PROGRESS.filled).not.toBe(PROGRESS.empty); });
  test("specific character values", () => {
    expect(PROGRESS.filled).toBe("\u2588");
    expect(PROGRESS.empty).toBe("\u2591");
  });
});

describe("CHECKBOX", () => {
  test("has expected keys", () => {
    for (const k of ["checked", "unchecked"]) { expect(CHECKBOX).toHaveProperty(k); }
  });
  test("has exactly 2 keys", () => { expect(Object.keys(CHECKBOX)).toHaveLength(2); });
  test("checked and unchecked are distinct", () => { expect(CHECKBOX.checked).not.toBe(CHECKBOX.unchecked); });
  test("specific character values", () => {
    expect(CHECKBOX.checked).toBe("\u2713");
    expect(CHECKBOX.unchecked).toBe("\u25CB");
  });
});

describe("SCROLLBAR", () => {
  test("has expected keys", () => {
    for (const k of ["thumb", "track"]) { expect(SCROLLBAR).toHaveProperty(k); }
  });
  test("has exactly 2 keys", () => { expect(Object.keys(SCROLLBAR)).toHaveLength(2); });
  test("thumb and track are distinct", () => { expect(SCROLLBAR.thumb).not.toBe(SCROLLBAR.track); });
  test("specific character values", () => {
    expect(SCROLLBAR.thumb).toBe("\u2588");
    expect(SCROLLBAR.track).toBe("\u2502");
  });
});

describe("TASK", () => {
  test("has all expected keys", () => {
    for (const k of ["completed", "active", "pending", "error", "track", "trackEnd", "trackDot", "barFilled", "barEmpty"]) {
      expect(TASK).toHaveProperty(k);
    }
  });
  test("has exactly 9 keys", () => { expect(Object.keys(TASK)).toHaveLength(9); });
  test("all values are non-empty strings", () => { assertAllNonEmptyStrings(TASK); });
  test("specific character values", () => {
    expect(TASK.completed).toBe("\u2713");
    expect(TASK.error).toBe("\u2717");
    expect(TASK.pending).toBe("\u25CB");
  });
  test("barFilled and barEmpty are distinct", () => { expect(TASK.barFilled).not.toBe(TASK.barEmpty); });
});

describe("SEPARATOR", () => {
  test("has expected keys", () => { expect(SEPARATOR).toHaveProperty("line"); });
  test("has exactly 1 key", () => { expect(Object.keys(SEPARATOR)).toHaveLength(1); });
  test("line is a sequence of horizontal rule characters", () => {
    expect(SEPARATOR.line).toBe("\u2500\u2500\u2500\u2500");
  });
  test("line is 4 characters long", () => { expect(SEPARATOR.line.length).toBe(4); });
});

describe("MISC", () => {
  test("has all expected keys", () => {
    for (const k of ["separator", "ellipsis", "warning", "thinking", "queue", "collapsed"]) {
      expect(MISC).toHaveProperty(k);
    }
  });
  test("has exactly 6 keys", () => { expect(Object.keys(MISC)).toHaveLength(6); });
  test("all values are non-empty strings", () => { assertAllNonEmptyStrings(MISC); });
  test("specific character values", () => {
    expect(MISC.separator).toBe("\u00B7");
    expect(MISC.ellipsis).toBe("\u2026");
    expect(MISC.warning).toBe("\u26A0");
    expect(MISC.thinking).toBe("\u2234");
    expect(MISC.queue).toBe("\u22EE");
    expect(MISC.collapsed).toBe("\u25BE");
  });
  test("all values are distinct", () => {
    expect(new Set(Object.values(MISC)).size).toBe(Object.values(MISC).length);
  });
});

describe("cross-group consistency", () => {
  test("STATUS.success, CHECKBOX.checked, and TASK.completed all use check mark", () => {
    expect(STATUS.success).toBe("\u2713");
    expect(CHECKBOX.checked).toBe("\u2713");
    expect(TASK.completed).toBe("\u2713");
  });
  test("STATUS.error and TASK.error both use X mark", () => {
    expect(STATUS.error).toBe("\u2717");
    expect(TASK.error).toBe("\u2717");
  });
  test("STATUS.pending, CHECKBOX.unchecked, and TASK.pending all use circle", () => {
    expect(STATUS.pending).toBe("\u25CB");
    expect(CHECKBOX.unchecked).toBe("\u25CB");
    expect(TASK.pending).toBe("\u25CB");
  });
  test("SCROLLBAR.thumb and PROGRESS.filled share the full block character", () => {
    expect(SCROLLBAR.thumb).toBe(PROGRESS.filled);
    expect(SCROLLBAR.thumb).toBe("\u2588");
  });
});
