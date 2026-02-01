/**
 * Tests for FooterStatus Component
 *
 * Tests cover:
 * - Utility functions (getPermissionModeIndicator, formatQueuedCount, getShortcutHints, buildStatusParts)
 * - FooterStatusProps interface
 * - Component structure
 */

import { describe, test, expect } from "bun:test";
import {
  FooterStatus,
  getPermissionModeIndicator,
  formatQueuedCount,
  getShortcutHints,
  buildStatusParts,
  type FooterStatusProps,
} from "../../../src/ui/components/footer-status.tsx";

// ============================================================================
// GET PERMISSION MODE INDICATOR TESTS
// ============================================================================

describe("getPermissionModeIndicator", () => {
  test("returns Auto-approve indicator", () => {
    const result = getPermissionModeIndicator();
    expect(result).toBe("Auto-approve");
  });

  test("returns non-empty string", () => {
    const result = getPermissionModeIndicator();
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// FORMAT QUEUED COUNT TESTS
// ============================================================================

describe("formatQueuedCount", () => {
  test("returns empty string for 0", () => {
    expect(formatQueuedCount(0)).toBe("");
  });

  test("returns singular form for 1", () => {
    expect(formatQueuedCount(1)).toBe("1 queued");
  });

  test("returns plural form for 2", () => {
    expect(formatQueuedCount(2)).toBe("2 queued");
  });

  test("returns plural form for larger numbers", () => {
    expect(formatQueuedCount(5)).toBe("5 queued");
    expect(formatQueuedCount(10)).toBe("10 queued");
    expect(formatQueuedCount(100)).toBe("100 queued");
  });
});

// ============================================================================
// GET SHORTCUT HINTS TESTS
// ============================================================================

describe("getShortcutHints", () => {
  test("returns array of shortcuts", () => {
    const hints = getShortcutHints();
    expect(Array.isArray(hints)).toBe(true);
    expect(hints.length).toBeGreaterThan(0);
  });

  test("includes Ctrl+O for verbose", () => {
    const hints = getShortcutHints();
    expect(hints.some((h) => h.includes("Ctrl+O"))).toBe(true);
  });

  test("includes Ctrl+C for copy", () => {
    const hints = getShortcutHints();
    expect(hints.some((h) => h.includes("Ctrl+C"))).toBe(true);
  });

  test("includes Ctrl+V for paste", () => {
    const hints = getShortcutHints();
    expect(hints.some((h) => h.includes("Ctrl+V"))).toBe(true);
  });
});

// ============================================================================
// BUILD STATUS PARTS TESTS
// ============================================================================

describe("buildStatusParts", () => {
  test("always includes permission mode indicator", () => {
    const parts = buildStatusParts({});
    expect(parts).toContain("Auto-approve");
  });

  test("includes modelId when provided", () => {
    const parts = buildStatusParts({ modelId: "claude-3-opus" });
    expect(parts).toContain("claude-3-opus");
  });

  test("includes streaming indicator when streaming", () => {
    const parts = buildStatusParts({ isStreaming: true });
    expect(parts).toContain("streaming...");
  });

  test("excludes streaming indicator when not streaming", () => {
    const parts = buildStatusParts({ isStreaming: false });
    expect(parts).not.toContain("streaming...");
  });

  test("includes queued count when > 0", () => {
    const parts = buildStatusParts({ queuedCount: 3 });
    expect(parts).toContain("3 queued");
  });

  test("excludes queued count when 0", () => {
    const parts = buildStatusParts({ queuedCount: 0 });
    expect(parts.some((p) => p.includes("queued"))).toBe(false);
  });

  test("includes verbose indicator when enabled", () => {
    const parts = buildStatusParts({ verboseMode: true });
    expect(parts).toContain("verbose");
  });

  test("excludes verbose indicator when disabled", () => {
    const parts = buildStatusParts({ verboseMode: false });
    expect(parts).not.toContain("verbose");
  });

  test("builds complete status with all props", () => {
    const parts = buildStatusParts({
      verboseMode: true,
      isStreaming: true,
      queuedCount: 2,
      modelId: "gpt-4",
    });

    expect(parts).toContain("Auto-approve");
    expect(parts).toContain("gpt-4");
    expect(parts).toContain("streaming...");
    expect(parts).toContain("2 queued");
    expect(parts).toContain("verbose");
  });
});

// ============================================================================
// FOOTER STATUS PROPS TESTS
// ============================================================================

describe("FooterStatusProps interface", () => {
  test("allows empty props", () => {
    const props: FooterStatusProps = {};
    expect(props.verboseMode).toBeUndefined();
    expect(props.isStreaming).toBeUndefined();
    expect(props.queuedCount).toBeUndefined();
    expect(props.modelId).toBeUndefined();
  });

  test("allows all props", () => {
    const props: FooterStatusProps = {
      verboseMode: true,
      isStreaming: true,
      queuedCount: 5,
      modelId: "claude-3-sonnet",
    };

    expect(props.verboseMode).toBe(true);
    expect(props.isStreaming).toBe(true);
    expect(props.queuedCount).toBe(5);
    expect(props.modelId).toBe("claude-3-sonnet");
  });

  test("allows partial props", () => {
    const props: FooterStatusProps = {
      verboseMode: false,
      queuedCount: 1,
    };

    expect(props.verboseMode).toBe(false);
    expect(props.queuedCount).toBe(1);
    expect(props.isStreaming).toBeUndefined();
    expect(props.modelId).toBeUndefined();
  });
});

// ============================================================================
// FOOTER STATUS COMPONENT TESTS
// ============================================================================

describe("FooterStatus component", () => {
  test("is a function component", () => {
    expect(typeof FooterStatus).toBe("function");
  });

  test("component function exists and is exported", () => {
    expect(FooterStatus).toBeDefined();
  });

  test("component name is FooterStatus", () => {
    expect(FooterStatus.name).toBe("FooterStatus");
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("FooterStatus integration", () => {
  test("status parts join correctly", () => {
    const parts = buildStatusParts({
      modelId: "claude-3",
      isStreaming: true,
    });

    const statusLine = parts.join(" │ ");
    expect(statusLine).toContain("│");
    expect(statusLine).toContain("Auto-approve");
    expect(statusLine).toContain("claude-3");
    expect(statusLine).toContain("streaming...");
  });

  test("shortcuts join correctly", () => {
    const hints = getShortcutHints();
    const shortcutLine = hints.join("  ");
    expect(shortcutLine).toContain("Ctrl+O");
    expect(shortcutLine).toContain("Ctrl+C");
    expect(shortcutLine).toContain("Ctrl+V");
  });
});
