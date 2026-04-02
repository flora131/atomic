/**
 * E2E tests for FooterStatus component.
 *
 * Tests the real rendering output of FooterStatus using OpenTUI's testRender
 * to verify that streaming hints, workflow hints, and background agent counts
 * are rendered correctly in the terminal.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import { FooterStatus } from "@/components/footer-status.tsx";
import type { FooterStatusComponentProps } from "@/components/footer-status.tsx";

// ============================================================================
// HELPERS
// ============================================================================

const RENDER_OPTIONS = { width: 120, height: 10 };

type TestSetup = Awaited<ReturnType<typeof testRender>>;

let testSetup: TestSetup;

function renderFooterStatus(props: FooterStatusComponentProps = {}) {
  return testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <FooterStatus {...props} />
    </ThemeProvider>,
    RENDER_OPTIONS,
  );
}

// ============================================================================
// CLEANUP
// ============================================================================

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

// ============================================================================
// TESTS
// ============================================================================

describe("FooterStatus E2E", () => {
  test("returns null when idle — no streaming, no workflow, no background agents", async () => {
    testSetup = await renderFooterStatus();
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // When idle, the component returns null — nothing should be rendered
    expect(frame.trim()).toBe("");
  });

  test("shows streaming hints when isStreaming is true", async () => {
    testSetup = await renderFooterStatus({ isStreaming: true });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("esc to interrupt");
  });

  test("shows workflow hints when workflowActive is true", async () => {
    testSetup = await renderFooterStatus({ workflowActive: true });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("workflow");
    expect(frame).toContain("esc to interrupt");
    expect(frame).toContain("ctrl+c twice to exit workflow");
  });

  test("shows background agent count for multiple agents", async () => {
    testSetup = await renderFooterStatus({ backgroundAgentCount: 3 });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("[3] local agents");
    expect(frame).not.toContain("ctrl+f");
  });

  test("shows singular 'agent' when backgroundAgentCount is 1", async () => {
    testSetup = await renderFooterStatus({ backgroundAgentCount: 1 });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("[1] local agent");
    // Must NOT contain the plural form — match exact singular boundary
    expect(frame).not.toContain("[1] local agents");
  });

  test("shows streaming hints AND background hints with separator when both active", async () => {
    testSetup = await renderFooterStatus({
      isStreaming: true,
      backgroundAgentCount: 2,
    });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // Streaming hints
    expect(frame).toContain("esc to interrupt");

    // Background hints
    expect(frame).toContain("[2] local agents");
    expect(frame).not.toContain("ctrl+f");
  });

  test("shows workflow hints AND background hints when both active", async () => {
    testSetup = await renderFooterStatus({
      workflowActive: true,
      backgroundAgentCount: 4,
    });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // Workflow hints
    expect(frame).toContain("workflow");
    expect(frame).toContain("esc to interrupt");
    expect(frame).toContain("ctrl+c twice to exit workflow");

    // Background hints
    expect(frame).toContain("[4] local agents");
    expect(frame).not.toContain("ctrl+f");
  });
});
