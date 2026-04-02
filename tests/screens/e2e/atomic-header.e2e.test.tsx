/**
 * E2E tests for AtomicHeader component.
 *
 * Tests the real rendering output of AtomicHeader using OpenTUI's testRender
 * to verify that version, model, tier, working directory, and the ASCII art
 * logo are rendered correctly in the terminal.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import { AtomicHeader, HEADER_MIN_WIDTH, HEADER_MIN_HEIGHT, HEADER_LOGO_MIN_WIDTH } from "@/components/chat-header.tsx";
import type { AtomicHeaderProps } from "@/state/chat/shared/types/presentation.ts";

// ============================================================================
// HELPERS
// ============================================================================

const RENDER_OPTIONS = { width: 120, height: 20 };

type TestSetup = Awaited<ReturnType<typeof testRender>>;

let testSetup: TestSetup;

function renderAtomicHeader(props: AtomicHeaderProps = {}) {
  return testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <AtomicHeader {...props} />
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

describe("AtomicHeader E2E", () => {
  test("renders with default props showing version", async () => {
    testSetup = await renderAtomicHeader();
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("0.1.0");
  });

  test("renders with custom version", async () => {
    testSetup = await renderAtomicHeader({ version: "2.5.3" });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("2.5.3");
  });

  test("renders model information", async () => {
    testSetup = await renderAtomicHeader({ model: "claude-sonnet-4" });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("claude-sonnet-4");
  });

  test("renders tier information", async () => {
    testSetup = await renderAtomicHeader({ tier: "standard" });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("standard");
  });

  test("renders working directory", async () => {
    testSetup = await renderAtomicHeader({ workingDir: "~/projects/my-app" });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("~/projects/my-app");
  });

  test("renders all props together", async () => {
    testSetup = await renderAtomicHeader({
      version: "1.2.0",
      model: "claude-sonnet-4",
      tier: "premium",
      workingDir: "~/Documents/code",
    });
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("1.2.0");
    expect(frame).toContain("claude-sonnet-4");
    expect(frame).toContain("premium");
    expect(frame).toContain("~/Documents/code");
  });

  test("hides entire header when terminal is too narrow", async () => {
    testSetup = await testRender(
      <ThemeProvider initialTheme={darkTheme}>
        <AtomicHeader version="1.0.0" model="claude-sonnet-4" workingDir="~/code" />
      </ThemeProvider>,
      { width: HEADER_MIN_WIDTH - 1, height: 30 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).not.toContain("1.0.0");
    expect(frame).not.toContain("claude-sonnet-4");
    expect(frame).not.toContain("█");
  });

  test("hides entire header when terminal is too short", async () => {
    testSetup = await testRender(
      <ThemeProvider initialTheme={darkTheme}>
        <AtomicHeader version="1.0.0" model="claude-sonnet-4" workingDir="~/code" />
      </ThemeProvider>,
      { width: 120, height: HEADER_MIN_HEIGHT - 1 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).not.toContain("1.0.0");
    expect(frame).not.toContain("claude-sonnet-4");
    expect(frame).not.toContain("█");
  });

  test("hides ASCII art logo in narrow terminal", async () => {
    testSetup = await testRender(
      <ThemeProvider initialTheme={darkTheme}>
        <AtomicHeader version="1.0.0" />
      </ThemeProvider>,
      { width: HEADER_LOGO_MIN_WIDTH - 1, height: 30 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // The logo contains block characters like "█▀▀█" — should NOT appear at narrow width
    expect(frame).not.toContain("█");
    // Version should still be visible
    expect(frame).toContain("1.0.0");
  });

  test("shows ASCII art logo in wide terminal", async () => {
    testSetup = await testRender(
      <ThemeProvider initialTheme={darkTheme}>
        <AtomicHeader version="1.0.0" />
      </ThemeProvider>,
      { width: HEADER_LOGO_MIN_WIDTH + 10, height: 30 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // The logo contains block characters — should appear at wide width
    expect(frame).toContain("█");
    // Version should still be visible
    expect(frame).toContain("1.0.0");
  });
});
