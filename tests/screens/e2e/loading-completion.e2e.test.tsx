/**
 * LoadingIndicator, CompletionSummary & StreamingBullet E2E Tests
 *
 * End-to-end rendering tests using OpenTUI's testRender.
 * Validates spinner animation frames, elapsed time display, token counts,
 * thinking-time output, verb overrides, completion summary verbs, and
 * the streaming bullet toggle.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import {
  CompletionSummary,
  LoadingIndicator,
  StreamingBullet,
} from "@/components/chat-loading-indicator.tsx";
import { SPINNER_FRAMES } from "@/theme/icons.ts";

// ============================================================================
// HELPERS
// ============================================================================

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 5;

let activeRenderer: { renderer: { destroy(): void } } | null = null;

/**
 * Render LoadingIndicator inside a ThemeProvider and capture the text frame.
 */
async function renderLoadingIndicator(
  props: {
    speed?: number;
    verbOverride?: string;
    elapsedMs?: number;
    outputTokens?: number;
    thinkingMs?: number;
    isStreaming?: boolean;
  },
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <LoadingIndicator {...props} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

/**
 * Render CompletionSummary inside a ThemeProvider and capture the text frame.
 */
async function renderCompletionSummary(
  props: {
    durationMs: number;
    outputTokens?: number;
    thinkingMs?: number;
  },
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <CompletionSummary {...props} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

/**
 * Render StreamingBullet inside a ThemeProvider and capture the text frame.
 */
async function renderStreamingBullet(
  props?: { speed?: number },
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <StreamingBullet {...(props ?? {})} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

// ============================================================================
// TEARDOWN
// ============================================================================

afterEach(() => {
  if (activeRenderer) {
    activeRenderer.renderer.destroy();
    activeRenderer = null;
  }
});

// ============================================================================
// LOADING INDICATOR TESTS
// ============================================================================

describe("LoadingIndicator E2E", () => {
  // --------------------------------------------------------------------------
  // 1. Renders a spinner character from SPINNER_FRAMES
  // --------------------------------------------------------------------------
  test("renders spinner character", async () => {
    const frame = await renderLoadingIndicator({});

    const hasSpinnerChar = SPINNER_FRAMES.some((ch) => frame.includes(ch));
    expect(hasSpinnerChar).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 2. Shows elapsed time in seconds
  // --------------------------------------------------------------------------
  test("shows elapsed time in seconds", async () => {
    const frame = await renderLoadingIndicator({ elapsedMs: 5000 });

    expect(frame).toContain("5s");
  });

  // --------------------------------------------------------------------------
  // 3. Shows output token count
  // --------------------------------------------------------------------------
  test("shows output token count", async () => {
    const frame = await renderLoadingIndicator({ outputTokens: 150 });

    expect(frame).toContain("150");
    expect(frame).toContain("↓");
  });

  // --------------------------------------------------------------------------
  // 4. Shows thinking time when provided
  // --------------------------------------------------------------------------
  test("shows thinking time when provided", async () => {
    const frame = await renderLoadingIndicator({ thinkingMs: 3000 });

    expect(frame).toContain("thought");
    expect(frame).toContain("3s");
  });

  // --------------------------------------------------------------------------
  // 5. Does not show thinking time when zero
  // --------------------------------------------------------------------------
  test("does not show thinking time when zero", async () => {
    const frame = await renderLoadingIndicator({ thinkingMs: 0 });

    expect(frame).not.toContain("thought");
  });

  // --------------------------------------------------------------------------
  // 6. Uses custom verb override
  // --------------------------------------------------------------------------
  test("uses custom verb override", async () => {
    const frame = await renderLoadingIndicator({ verbOverride: "Analyzing" });

    expect(frame).toContain("Analyzing");
  });

  // --------------------------------------------------------------------------
  // 7. Shows default verb when no override
  // --------------------------------------------------------------------------
  test("shows default verb when no override", async () => {
    const frame = await renderLoadingIndicator({});

    // Default verb without thinking is "Composing"
    expect(frame).toContain("Composing");
  });
});

// ============================================================================
// COMPLETION SUMMARY TESTS
// ============================================================================

describe("CompletionSummary E2E", () => {
  // --------------------------------------------------------------------------
  // 8. Shows duration in seconds
  // --------------------------------------------------------------------------
  test("shows duration in seconds", async () => {
    const frame = await renderCompletionSummary({ durationMs: 8000 });

    expect(frame).toContain("8s");
  });

  // --------------------------------------------------------------------------
  // 9. Shows output token count
  // --------------------------------------------------------------------------
  test("shows output token count", async () => {
    const frame = await renderCompletionSummary({
      durationMs: 5000,
      outputTokens: 500,
    });

    expect(frame).toContain("500");
  });

  // --------------------------------------------------------------------------
  // 10. Shows "Composed" when no thinking
  // --------------------------------------------------------------------------
  test("shows 'Composed' when no thinking", async () => {
    const frame = await renderCompletionSummary({ durationMs: 5000 });

    expect(frame).toContain("Composed");
  });

  // --------------------------------------------------------------------------
  // 11. Shows "Reasoned" when thinking time present
  // --------------------------------------------------------------------------
  test("shows 'Reasoned' when thinking time present", async () => {
    const frame = await renderCompletionSummary({
      durationMs: 5000,
      thinkingMs: 2000,
    });

    expect(frame).toContain("Reasoned");
  });

  // --------------------------------------------------------------------------
  // 12. Shows thinking time in completion
  // --------------------------------------------------------------------------
  test("shows thinking time in completion", async () => {
    const frame = await renderCompletionSummary({
      durationMs: 5000,
      thinkingMs: 4000,
    });

    expect(frame).toContain("thought");
    expect(frame).toContain("4s");
  });
});

// ============================================================================
// STREAMING BULLET TESTS
// ============================================================================

describe("StreamingBullet E2E", () => {
  // --------------------------------------------------------------------------
  // 13. Renders bullet character
  // --------------------------------------------------------------------------
  test("renders bullet character", async () => {
    const frame = await renderStreamingBullet();

    // StreamingBullet toggles between ● (U+25CF) and · (U+00B7)
    const hasBullet = frame.includes("●") || frame.includes("·");
    expect(hasBullet).toBe(true);
  });
});
