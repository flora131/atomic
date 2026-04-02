/**
 * E2E Tests for HitlResponseWidget
 *
 * Tests the hitl-response-widget component using OpenTUI's testRender
 * to verify rendering of the HITL response card, including header, question
 * (rendered via <markdown>), and answer display for various response modes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import { HitlResponseWidget } from "@/components/hitl-response-widget.tsx";
import type { HitlContext } from "@/state/chat/shared/types/index.ts";
import type { HitlResponseMode } from "@/lib/ui/hitl-response.ts";

// ============================================================================
// HELPERS
// ============================================================================

const TEST_WIDTH = 80;
const TEST_HEIGHT = 20;

function makeContext(overrides: Partial<HitlContext> = {}): HitlContext {
  return {
    header: "Permission Request",
    question: "Do you want to allow this action?",
    answer: "Allow once",
    cancelled: false,
    responseMode: "option" as HitlResponseMode,
    ...overrides,
  };
}

type TestSetup = Awaited<ReturnType<typeof testRender>>;

let testSetup: TestSetup | null = null;

async function renderWidget(
  context: HitlContext = makeContext(),
): Promise<TestSetup> {
  testSetup = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <HitlResponseWidget context={context} />
    </ThemeProvider>,
    { width: TEST_WIDTH, height: TEST_HEIGHT },
  );
  // Two render passes: the first triggers layout; the second allows the
  // <markdown> element to finish its async tree-sitter parse.
  await testSetup.renderOnce();
  await testSetup.renderOnce();
  return testSetup;
}

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = null;
  }
});

// ============================================================================
// RENDERING TESTS
// ============================================================================

describe("HitlResponseWidget", () => {
  test("renders header label", async () => {
    const setup = await renderWidget();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Permission Request");
  });

  test("renders custom header label", async () => {
    const setup = await renderWidget(makeContext({ header: "Custom Header" }));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Custom Header");
  });

  test("renders default 'Question' header when header is empty", async () => {
    const setup = await renderWidget(makeContext({ header: "" }));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Question");
  });

  test("renders answer text for option mode", async () => {
    const setup = await renderWidget(makeContext({ answer: "Always allow", responseMode: "option" }));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Always allow");
  });

  test("renders 'Declined' for declined mode", async () => {
    const setup = await renderWidget(makeContext({
      responseMode: "declined",
      answer: "some answer",
    }));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Declined");
  });

  test("renders 'Declined' when cancelled is true", async () => {
    const setup = await renderWidget(makeContext({
      cancelled: true,
      answer: "some answer",
    }));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Declined");
  });

  test("renders quoted answer for chat_about_this mode", async () => {
    const setup = await renderWidget(makeContext({
      responseMode: "chat_about_this",
      answer: "Tell me more",
    }));
    const frame = setup.captureCharFrame();
    // chat_about_this wraps answer in quotes
    expect(frame).toContain('"Tell me more"');
  });

  test("does not render question section when question is empty", async () => {
    const setup = await renderWidget(makeContext({ question: "" }));
    const frame = setup.captureCharFrame();
    // <markdown> element should not be rendered at all
    // Header and answer should still be present
    expect(frame).toContain("Permission Request");
    expect(frame).toContain("Allow once");
  });

  test("renders connector decorations", async () => {
    const setup = await renderWidget();
    const frame = setup.captureCharFrame();
    // The rounded connector characters (╭, ─, ╮) should be present
    expect(frame).toContain("╭");
    expect(frame).toContain("╮");
  });

  // --------------------------------------------------------------------------
  // Markdown rendering & SyntaxStyle lifecycle
  // --------------------------------------------------------------------------
  test("question text rendered via <markdown> is not visible as plain text in headless mode", async () => {
    const setup = await renderWidget(makeContext({
      question: "Do you want to allow this action?",
    }));
    const frame = setup.captureCharFrame();

    // <markdown> element does not produce visible chars in headless captureCharFrame()
    // (documented OpenTUI limitation). The question text should NOT appear as
    // plain text, confirming it is rendered via the <markdown> element.
    expect(frame).not.toContain("Do you want to allow this action?");

    // The header and answer (rendered via <text>) SHOULD be visible
    expect(frame).toContain("Permission Request");
    expect(frame).toContain("Allow once");
  });

  test("SyntaxStyle lifecycle: renderer.destroy() completes without errors", async () => {
    const setup = await renderWidget();

    // Verify the widget rendered successfully
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Permission Request");

    // Destroy the renderer — this triggers useEffect cleanup which calls
    // markdownSyntaxStyle.destroy(). If the SyntaxStyle lifecycle is broken
    // (e.g., destroy called during render instead of cleanup), this would throw.
    expect(() => {
      setup.renderer.destroy();
    }).not.toThrow();

    // Prevent afterEach from double-destroying
    testSetup = null;
  });
});
