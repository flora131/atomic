/**
 * E2E Tests for ModelSelectorDialog
 *
 * Tests the model-selector-dialog component using OpenTUI's testRender
 * to verify rendering, keyboard interaction, provider grouping,
 * reasoning effort sub-selector, and selection/cancel callbacks.
 *
 * Uses kittyKeyboard mode to avoid escape-sequence ambiguity in the
 * test renderer's input parser (bare \x1b requires a timeout to
 * distinguish ESC from the start of \x1b[... sequences).
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { act } from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import {
  ModelSelectorDialog,
  type ModelSelectorDialogProps,
} from "@/components/model-selector-dialog.tsx";
import type { Model } from "@/services/models/model-transform.ts";

// ============================================================================
// HELPERS
// ============================================================================

const TEST_WIDTH = 120;
const TEST_HEIGHT = 40;

/**
 * Factory to create a Model with sensible defaults.
 * Pass overrides for any fields you need to customize.
 */
function createModel(overrides: Partial<Model> = {}): Model {
  const modelID = overrides.modelID ?? "test-model";
  const providerID = overrides.providerID ?? "test-provider";
  return {
    id: `${providerID}/${modelID}`,
    providerID,
    providerName: overrides.providerName ?? providerID,
    modelID,
    name: overrides.name ?? modelID,
    status: "active" as const,
    capabilities: {
      reasoning: false,
      attachment: false,
      temperature: false,
      toolCall: true,
    },
    limits: {
      context: 128_000,
      output: 4096,
    },
    options: {},
    ...overrides,
  };
}

/** A set of test models from 2 providers, one with reasoning support. */
const testModels: Model[] = [
  createModel({
    providerID: "anthropic",
    providerName: "Anthropic",
    modelID: "claude-sonnet-4",
    name: "Claude Sonnet 4",
  }),
  createModel({
    providerID: "anthropic",
    providerName: "Anthropic",
    modelID: "claude-opus-4",
    name: "Claude Opus 4",
    capabilities: { reasoning: true, attachment: false, temperature: false, toolCall: true },
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
  }),
  createModel({
    providerID: "openai",
    providerName: "OpenAI",
    modelID: "gpt-4o",
    name: "GPT-4o",
  }),
];

type TestSetup = Awaited<ReturnType<typeof testRender>>;

let testSetup: TestSetup | null = null;

async function renderDialog(
  props: Partial<ModelSelectorDialogProps> = {},
): Promise<TestSetup> {
  const defaultProps: ModelSelectorDialogProps = {
    models: testModels,
    onSelect: mock(() => {}),
    onCancel: mock(() => {}),
    visible: true,
    ...props,
  };

  testSetup = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <ModelSelectorDialog {...defaultProps} />
    </ThemeProvider>,
    { width: TEST_WIDTH, height: TEST_HEIGHT, kittyKeyboard: true },
  );
  await testSetup.renderOnce();
  return testSetup;
}

/**
 * Press a key inside act() so React flushes any resulting state updates
 * before the next interaction.
 */
function pressKeyAct(setup: TestSetup, key: string): void {
  act(() => { setup.mockInput.pressKey(key); });
}

function pressArrowAct(setup: TestSetup, dir: "up" | "down" | "left" | "right"): void {
  act(() => { setup.mockInput.pressArrow(dir); });
}

function pressEnterAct(setup: TestSetup): void {
  act(() => { setup.mockInput.pressEnter(); });
}

function pressEscapeAct(setup: TestSetup): void {
  act(() => { setup.mockInput.pressEscape(); });
}

/**
 * Extracts the first call arguments from a mock, safely handling strict
 * noUncheckedIndexedAccess by double-casting through unknown.
 */
function getFirstCallArgs(fn: ReturnType<typeof mock>): unknown[] {
  const calls = fn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0] as unknown as unknown[];
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

describe("ModelSelectorDialog E2E", () => {
  // --------------------------------------------------------------------------
  // 1. renders nothing when visible is false
  // --------------------------------------------------------------------------
  test("renders nothing when visible is false", async () => {
    const setup = await renderDialog({ visible: false });
    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("Select Model");
    expect(frame).not.toContain("claude-sonnet-4");
    expect(frame).not.toContain("gpt-4o");
  });

  // --------------------------------------------------------------------------
  // 2. renders Select Model header and model names
  // --------------------------------------------------------------------------
  test("renders Select Model header and model names", async () => {
    const setup = await renderDialog();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Select Model");
    expect(frame).toContain("claude-sonnet-4");
    expect(frame).toContain("claude-opus-4");

    // gpt-4o may be below the scroll viewport — navigate down to reveal it
    pressArrowAct(setup, "down");
    await setup.renderOnce();
    pressArrowAct(setup, "down");
    await setup.renderOnce();

    const scrolledFrame = setup.captureCharFrame();
    expect(scrolledFrame).toContain("gpt-4o");
  });

  // --------------------------------------------------------------------------
  // 3. shows models grouped by provider with provider headers
  // --------------------------------------------------------------------------
  test("shows models grouped by provider with provider headers", async () => {
    const setup = await renderDialog();
    const frame = setup.captureCharFrame();

    // Provider display names should appear as group headers
    expect(frame).toContain("Anthropic");
    expect(frame).toContain("OpenAI");
  });

  // --------------------------------------------------------------------------
  // 4. shows navigation hint text in footer
  // --------------------------------------------------------------------------
  test("shows navigation hint text in footer", async () => {
    const setup = await renderDialog();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("j/k navigate");
    expect(frame).toContain("enter select");
    expect(frame).toContain("esc cancel");
  });

  // --------------------------------------------------------------------------
  // 5. shows (current) badge next to currentModel
  // --------------------------------------------------------------------------
  test("shows (current) badge next to currentModel", async () => {
    const setup = await renderDialog({
      currentModel: "anthropic/claude-sonnet-4",
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("(current)");
  });

  // --------------------------------------------------------------------------
  // 6. Down arrow moves selection down
  // --------------------------------------------------------------------------
  test("Down arrow moves selection down", async () => {
    const onSelect = mock(() => {});
    const setup = await renderDialog({ onSelect });

    // Move down once (from index 0 to index 1)
    pressArrowAct(setup, "down");
    await setup.renderOnce();

    // Press Enter to confirm selection
    pressEnterAct(setup);
    await setup.renderOnce();

    // claude-opus-4 has reasoning efforts, so it enters reasoning phase
    // instead of calling onSelect directly. The reasoning selector should appear.
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Select Effort Level");
    expect(frame).toContain("claude-opus-4");
  });

  // --------------------------------------------------------------------------
  // 7. Up arrow wraps from first to last
  // --------------------------------------------------------------------------
  test("Up arrow wraps from first to last", async () => {
    const onSelect = mock(() => {});
    const setup = await renderDialog({ onSelect });

    // Press up from first item → wraps to last (gpt-4o, index 2)
    pressArrowAct(setup, "up");
    await setup.renderOnce();

    // Press Enter to confirm
    pressEnterAct(setup);
    await setup.renderOnce();

    // gpt-4o has no reasoning efforts, so onSelect should be called directly
    expect(onSelect).toHaveBeenCalledTimes(1);
    const args = getFirstCallArgs(onSelect);
    const calledModel = args[0] as Model;
    expect(calledModel.modelID).toBe("gpt-4o");
  });

  // --------------------------------------------------------------------------
  // 8. number key selects model directly
  // --------------------------------------------------------------------------
  test("number key selects model directly", async () => {
    const onSelect = mock(() => {});
    const setup = await renderDialog({ onSelect });

    // Press "1" to select first model (claude-sonnet-4)
    pressKeyAct(setup, "1");
    await setup.renderOnce();

    // claude-sonnet-4 has no reasoning efforts → direct onSelect
    expect(onSelect).toHaveBeenCalledTimes(1);
    const args = getFirstCallArgs(onSelect);
    const calledModel = args[0] as Model;
    expect(calledModel.modelID).toBe("claude-sonnet-4");
  });

  // --------------------------------------------------------------------------
  // 9. ESC calls onCancel
  // --------------------------------------------------------------------------
  test("ESC calls onCancel", async () => {
    const onCancel = mock(() => {});
    const setup = await renderDialog({ onCancel });

    pressEscapeAct(setup);
    await setup.renderOnce();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // 10. reasoning model shows effort selector after selection
  // --------------------------------------------------------------------------
  test("reasoning model shows effort selector after selection", async () => {
    const onSelect = mock(() => {});
    const setup = await renderDialog({ onSelect });

    // Press "2" to select claude-opus-4 (which has reasoning efforts)
    pressKeyAct(setup, "2");
    await setup.renderOnce();

    // Should NOT have called onSelect yet — reasoning selector should be shown
    expect(onSelect).toHaveBeenCalledTimes(0);

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Select Effort Level");
    expect(frame).toContain("claude-opus-4");
    expect(frame).toContain("low");
    expect(frame).toContain("medium");
    expect(frame).toContain("high");
    // "medium" is the default, so "(default)" should appear
    expect(frame).toContain("(default)");
  });

  // --------------------------------------------------------------------------
  // 11. ESC in reasoning selector returns to model list
  // --------------------------------------------------------------------------
  test("ESC in reasoning selector returns to model list", async () => {
    const onSelect = mock(() => {});
    const onCancel = mock(() => {});
    const setup = await renderDialog({ onSelect, onCancel });

    // Enter reasoning selector by selecting claude-opus-4
    pressKeyAct(setup, "2");
    await setup.renderOnce();

    // Verify we're in reasoning phase
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Select Effort Level");

    // Press ESC to go back to model list
    pressEscapeAct(setup);
    await setup.renderOnce();

    // Should be back to model list, not dismissed
    frame = setup.captureCharFrame();
    expect(frame).toContain("Select Model");
    expect(frame).toContain("claude-sonnet-4");
    expect(frame).toContain("claude-opus-4");

    // onSelect should not have been called
    expect(onSelect).toHaveBeenCalledTimes(0);
    // onCancel should not have been called (ESC in reasoning goes back, not cancel)
    expect(onCancel).toHaveBeenCalledTimes(0);
  });

  // --------------------------------------------------------------------------
  // 12. Enter in reasoning selector calls onSelect with effort
  // --------------------------------------------------------------------------
  test("Enter in reasoning selector calls onSelect with effort", async () => {
    const onSelect = mock(() => {});
    const setup = await renderDialog({ onSelect });

    // Enter reasoning selector by selecting claude-opus-4
    pressKeyAct(setup, "2");
    await setup.renderOnce();

    // Default reasoning index should be "medium" (index 1, the default)
    // Navigate down to "high" (index 2)
    pressArrowAct(setup, "down");
    await setup.renderOnce();

    // Press Enter to confirm reasoning effort
    pressEnterAct(setup);
    await setup.renderOnce();

    expect(onSelect).toHaveBeenCalledTimes(1);
    const args = getFirstCallArgs(onSelect);
    const calledModel = args[0] as Model;
    const calledEffort = args[1] as string;
    expect(calledModel.modelID).toBe("claude-opus-4");
    expect(calledEffort).toBe("high");
  });

  // --------------------------------------------------------------------------
  // Additional: j/k navigation works
  // --------------------------------------------------------------------------
  test("j key moves selection down and k key moves selection up", async () => {
    const onSelect = mock(() => {});
    const setup = await renderDialog({ onSelect });

    // Press "j" to move down (index 0 → 1)
    pressKeyAct(setup, "j");
    await setup.renderOnce();

    // Press "j" again to move down (index 1 → 2)
    pressKeyAct(setup, "j");
    await setup.renderOnce();

    // Press "k" to move back up (index 2 → 1)
    pressKeyAct(setup, "k");
    await setup.renderOnce();

    // Confirm with Enter — should be on index 1 (claude-opus-4, which has reasoning)
    pressEnterAct(setup);
    await setup.renderOnce();

    // Should show reasoning selector for claude-opus-4
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Select Effort Level");
    expect(frame).toContain("claude-opus-4");
  });

  // --------------------------------------------------------------------------
  // Additional: number key in reasoning selector confirms directly
  // --------------------------------------------------------------------------
  test("number key in reasoning selector calls onSelect with chosen effort", async () => {
    const onSelect = mock(() => {});
    const setup = await renderDialog({ onSelect });

    // Enter reasoning selector
    pressKeyAct(setup, "2");
    await setup.renderOnce();

    // Press "3" to directly select "high" (the 3rd effort option)
    pressKeyAct(setup, "3");
    await setup.renderOnce();

    expect(onSelect).toHaveBeenCalledTimes(1);
    const args = getFirstCallArgs(onSelect);
    const calledModel = args[0] as Model;
    const calledEffort = args[1] as string;
    expect(calledModel.modelID).toBe("claude-opus-4");
    expect(calledEffort).toBe("high");
  });

  // --------------------------------------------------------------------------
  // Additional: shows current reasoning effort next to current model
  // --------------------------------------------------------------------------
  test("shows current reasoning effort next to current model", async () => {
    const setup = await renderDialog({
      currentModel: "anthropic/claude-opus-4",
      currentReasoningEffort: "high",
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("(current)");
    expect(frame).toContain("(high)");
  });
});
