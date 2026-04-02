/**
 * E2E Tests for UserQuestionDialog
 *
 * Tests the user-question-dialog component using OpenTUI's testRender
 * to verify rendering, keyboard interaction, and answer callbacks.
 *
 * Uses kittyKeyboard mode to avoid escape-sequence ambiguity in the
 * test renderer's input parser (bare \x1b requires a timeout to
 * distinguish ESC from the start of \x1b[... sequences).
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import { UserQuestionDialog } from "@/components/user-question-dialog.tsx";
import type { QuestionAnswer, UserQuestion } from "@/state/chat/shared/types/hitl.ts";

// ============================================================================
// HELPERS
// ============================================================================

const TEST_WIDTH = 80;
const TEST_HEIGHT = 40;

function makeQuestion(overrides: Partial<UserQuestion> = {}): UserQuestion {
  return {
    header: "Permission Request",
    question: "Do you want to allow this action?",
    options: [
      { label: "Allow once", value: "allow_once", description: "Allow for this session only" },
      { label: "Always allow", value: "always_allow" },
      { label: "Deny", value: "deny", description: "Block this action" },
    ],
    ...overrides,
  };
}

type TestSetup = Awaited<ReturnType<typeof testRender>>;

let testSetup: TestSetup | null = null;

async function renderDialog(
  onAnswer: (answer: QuestionAnswer) => void,
  question: UserQuestion = makeQuestion(),
  visible = true,
): Promise<TestSetup> {
  testSetup = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <UserQuestionDialog
        question={question}
        onAnswer={onAnswer}
        visible={visible}
      />
    </ThemeProvider>,
    { width: TEST_WIDTH, height: TEST_HEIGHT, kittyKeyboard: true },
  );
  // Two render passes: the first triggers layout; the second allows the
  // <markdown> element to finish its async tree-sitter parse and display
  // the question text content.
  await testSetup.renderOnce();
  await testSetup.renderOnce();
  return testSetup;
}

/**
 * Press a key inside act() so React flushes any resulting state updates
 * (e.g. setHighlightedIndex) before the next interaction.
 */
function pressKeyAct(setup: TestSetup, key: string): void {
  act(() => { setup.mockInput.pressKey(key); });
}

function pressArrowAct(setup: TestSetup, dir: "up" | "down" | "left" | "right"): void {
  act(() => { setup.mockInput.pressArrow(dir); });
}

function pressEnterAct(setup: TestSetup, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }): void {
  act(() => { setup.mockInput.pressEnter(modifiers); });
}

function pressEscapeAct(setup: TestSetup): void {
  act(() => { setup.mockInput.pressEscape(); });
}

/**
 * Extracts the QuestionAnswer from the first call to a mock onAnswer callback.
 * Uses double assertion (unknown → QuestionAnswer) to satisfy strict TS with noUncheckedIndexedAccess.
 */
function getFirstAnswer(onAnswer: ReturnType<typeof mock>): QuestionAnswer {
  const calls = onAnswer.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]![0] as unknown as QuestionAnswer;
}

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = null;
  }
});

// ============================================================================
// TESTS
// ============================================================================

describe("UserQuestionDialog E2E", () => {
  // --------------------------------------------------------------------------
  // 1. Renders dialog with options
  // --------------------------------------------------------------------------
  test("renders dialog with header, question text, and numbered options", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);
    const frame = setup.captureCharFrame();

    // Header badge should be visible
    expect(frame).toContain("Permission Request");

    // Note: Question text is rendered via OpenTUI's <markdown> element,
    // which does not produce visible chars in headless captureCharFrame()
    // (same limitation as <code> — see message-bubble E2E tests).

    // Numbered options
    expect(frame).toContain("1.");
    expect(frame).toContain("Allow once");
    expect(frame).toContain("2.");
    expect(frame).toContain("Always allow");
    expect(frame).toContain("3.");
    expect(frame).toContain("Deny");
  });

  // --------------------------------------------------------------------------
  // 2. Shows special options
  // --------------------------------------------------------------------------
  test("shows 'Type something.' and 'Chat about this' as special options at the bottom", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    // "Type something." should be visible in initial view
    const initialFrame = setup.captureCharFrame();
    expect(initialFrame).toContain("Type something.");

    // Navigate down to "Chat about this" (last option, index 4)
    // to scroll the scrollbox and reveal it
    for (let i = 0; i < 4; i++) {
      pressArrowAct(setup, "down");
      await setup.renderOnce();
    }
    const scrolledFrame = setup.captureCharFrame();
    expect(scrolledFrame).toContain("Chat about this");
  });

  // --------------------------------------------------------------------------
  // 3. Number key selection
  // --------------------------------------------------------------------------
  test("pressing '1' selects first option and calls onAnswer with responseMode 'option'", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    pressKeyAct(setup, "1");
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.selected).toBe("allow_once");
    expect(answer.cancelled).toBe(false);
    expect(answer.responseMode).toBe("option");
  });

  test("pressing '2' selects second option", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    pressKeyAct(setup, "2");
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.selected).toBe("always_allow");
    expect(answer.cancelled).toBe(false);
    expect(answer.responseMode).toBe("option");
  });

  test("pressing '3' selects third option", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    pressKeyAct(setup, "3");
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.selected).toBe("deny");
    expect(answer.cancelled).toBe(false);
    expect(answer.responseMode).toBe("option");
  });

  test("number key beyond regular option count does not call onAnswer", async () => {
    const onAnswer = mock(() => {});
    // 3 regular options, so pressing "4" targets "Type something." which is special
    // and "5" targets "Chat about this" — neither should trigger number-key direct select
    const setup = await renderDialog(onAnswer);

    pressKeyAct(setup, "4");
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(0);
  });

  // --------------------------------------------------------------------------
  // 4. Keyboard navigation
  // --------------------------------------------------------------------------
  test("Down arrow moves highlighted cursor down", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    // Capture initial frame — cursor indicator ❯ should be on first option
    const frameBefore = setup.captureCharFrame();
    expect(frameBefore).toContain("❯");

    // Press down arrow to move to second option
    pressArrowAct(setup, "down");
    await setup.renderOnce();

    // Confirm by pressing Enter — should submit the second option
    pressEnterAct(setup);
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.selected).toBe("always_allow");
    expect(answer.responseMode).toBe("option");
  });

  test("Up arrow wraps from first option to last option", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    // Press up from first option → wraps to last (Chat about this, idx 4)
    pressArrowAct(setup, "up");
    await setup.renderOnce();

    // Up again → "Type something." (idx 3)
    pressArrowAct(setup, "up");
    await setup.renderOnce();

    // Up again → "Deny" (idx 2)
    pressArrowAct(setup, "up");
    await setup.renderOnce();

    // Confirm by pressing Enter — should submit "Deny"
    pressEnterAct(setup);
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.selected).toBe("deny");
    expect(answer.responseMode).toBe("option");
  });

  test("Down arrow wraps from last option to first option", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({
      options: [{ label: "Only option", value: "only" }],
    });
    // With 1 regular option + 2 special = 3 total
    const setup = await renderDialog(onAnswer, question);

    // Press down 3 times to wrap around back to first
    pressArrowAct(setup, "down");
    await setup.renderOnce();
    pressArrowAct(setup, "down");
    await setup.renderOnce();
    pressArrowAct(setup, "down");
    await setup.renderOnce();

    // Should be back on "Only option" (index 0)
    pressEnterAct(setup);
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.selected).toBe("only");
    expect(answer.responseMode).toBe("option");
  });

  // --------------------------------------------------------------------------
  // 5. ESC dismissal
  // --------------------------------------------------------------------------
  test("pressing ESC calls onAnswer with cancelled true and responseMode declined", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    pressEscapeAct(setup);
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.cancelled).toBe(true);
    expect(answer.responseMode).toBe("declined");
    expect(answer.selected).toBe("");
  });

  // --------------------------------------------------------------------------
  // 6. Hidden when visible=false
  // --------------------------------------------------------------------------
  test("renders nothing when visible is false", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer, makeQuestion(), false);
    const frame = setup.captureCharFrame();

    // Should not contain any dialog content
    expect(frame).not.toContain("Permission Request");
    expect(frame).not.toContain("Do you want to allow this action?");
    expect(frame).not.toContain("Allow once");
    expect(frame).not.toContain("Type something.");
    expect(frame).not.toContain("Chat about this");
  });

  // --------------------------------------------------------------------------
  // 7. Multi-select mode
  // --------------------------------------------------------------------------
  test("in multi-select mode, number keys toggle selection without submitting", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({ multiSelect: true });
    const setup = await renderDialog(onAnswer, question);

    // Press "1" to toggle first option — should NOT call onAnswer
    pressKeyAct(setup, "1");
    await setup.renderOnce();
    expect(onAnswer).toHaveBeenCalledTimes(0);

    // Press "3" to toggle third option — still no submission
    pressKeyAct(setup, "3");
    await setup.renderOnce();
    expect(onAnswer).toHaveBeenCalledTimes(0);

    // Capture frame should show checkmarks for selected items
    const frame = setup.captureCharFrame();
    expect(frame).toContain("✓");
  });

  test("in multi-select mode, Ctrl+Enter submits selected options", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({ multiSelect: true });
    const setup = await renderDialog(onAnswer, question);

    // Toggle first and third options
    pressKeyAct(setup, "1");
    await setup.renderOnce();
    pressKeyAct(setup, "3");
    await setup.renderOnce();

    // Submit with Ctrl+Enter
    pressEnterAct(setup, { ctrl: true });
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.cancelled).toBe(false);
    expect(answer.responseMode).toBe("option");
    // In multi-select mode, selected should be an array
    expect(Array.isArray(answer.selected)).toBe(true);
    expect(answer.selected).toContain("allow_once");
    expect(answer.selected).toContain("deny");
  });

  test("in multi-select mode, pressing same number key twice deselects the option", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({ multiSelect: true });
    const setup = await renderDialog(onAnswer, question);

    // Toggle first option on
    pressKeyAct(setup, "1");
    await setup.renderOnce();

    // Toggle first option off
    pressKeyAct(setup, "1");
    await setup.renderOnce();

    // Only select second option
    pressKeyAct(setup, "2");
    await setup.renderOnce();

    // Submit
    pressEnterAct(setup, { ctrl: true });
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(Array.isArray(answer.selected)).toBe(true);
    expect(answer.selected).toEqual(["always_allow"]);
  });

  test("in multi-select mode, Ctrl+Enter with no selections does not call onAnswer", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({ multiSelect: true });
    const setup = await renderDialog(onAnswer, question);

    // Submit with no selections
    pressEnterAct(setup, { ctrl: true });
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(0);
  });

  // --------------------------------------------------------------------------
  // Additional interaction tests
  // --------------------------------------------------------------------------
  test("option descriptions render when present", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);
    const frame = setup.captureCharFrame();

    // First option has description "Allow for this session only"
    expect(frame).toContain("Allow for this session only");
    // Third option has description "Block this action"
    expect(frame).toContain("Block this action");
  });

  test("Enter on highlighted regular option submits in single-select mode", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    // Navigate to third option (Deny) — two down arrows
    pressArrowAct(setup, "down");
    await setup.renderOnce();
    pressArrowAct(setup, "down");
    await setup.renderOnce();

    // Press Enter to select it
    pressEnterAct(setup);
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.selected).toBe("deny");
    expect(answer.responseMode).toBe("option");
  });

  test("shows navigation hint text", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);
    const frame = setup.captureCharFrame();

    // Single-select mode hint
    expect(frame).toContain("Enter to select");
    expect(frame).toContain("Esc to cancel");
  });

  test("multi-select mode shows multi-select hint text", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({ multiSelect: true });
    const setup = await renderDialog(onAnswer, question);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Ctrl+Enter to submit");
    expect(frame).toContain("Enter/Space to toggle");
  });

  test("ESC in multi-select mode returns empty array for selected", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({ multiSelect: true });
    const setup = await renderDialog(onAnswer, question);

    pressEscapeAct(setup);
    await setup.renderOnce();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = getFirstAnswer(onAnswer);
    expect(answer.cancelled).toBe(true);
    expect(answer.responseMode).toBe("declined");
    expect(Array.isArray(answer.selected)).toBe(true);
    expect(answer.selected).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Markdown rendering & SyntaxStyle lifecycle
  // --------------------------------------------------------------------------
  test("question text rendered via <markdown> is not visible as plain text, while option labels rendered via <text> are visible", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({
      question: "Do you want to allow this action?",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    });
    const setup = await renderDialog(onAnswer, question);
    const frame = setup.captureCharFrame();

    // <markdown> element does not produce visible chars in headless captureCharFrame()
    // (documented OpenTUI limitation), so the question text should NOT appear
    expect(frame).not.toContain("Do you want to allow this action?");

    // Option labels are rendered via <text> elements and SHOULD be visible,
    // proving they are NOT rendered via <markdown>
    expect(frame).toContain("Yes");
    expect(frame).toContain("No");
  });

  test("handles empty question text gracefully", async () => {
    const onAnswer = mock(() => {});
    const question = makeQuestion({ question: "" });
    const setup = await renderDialog(onAnswer, question);
    const frame = setup.captureCharFrame();

    // Header and options should still render when question is empty
    expect(frame).toContain("Permission Request");
    expect(frame).toContain("Allow once");
    expect(frame).toContain("Always allow");
    expect(frame).toContain("Deny");
  });

  test("SyntaxStyle lifecycle: renderer.destroy() completes without errors", async () => {
    const onAnswer = mock(() => {});
    const setup = await renderDialog(onAnswer);

    // Verify the dialog rendered successfully
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
