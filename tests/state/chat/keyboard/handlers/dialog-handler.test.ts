/**
 * Unit tests for the dialog handler pure functions.
 *
 * These functions are fully pure — no React dependencies — and can be
 * tested by direct invocation. Tests cover:
 * - toggleSelection list manipulation
 * - isMultiSelectSubmitKey key detection
 * - handleUserQuestionKey full keyboard logic
 * - handleModelSelectorKey full keyboard logic
 * - Exported constants (CUSTOM_INPUT_VALUE, CHAT_ABOUT_THIS_VALUE)
 */

import { describe, test, expect } from "bun:test";
import {
  toggleSelection,
  isMultiSelectSubmitKey,
  handleUserQuestionKey,
  handleModelSelectorKey,
  CUSTOM_INPUT_VALUE,
  CHAT_ABOUT_THIS_VALUE,
  type UserQuestionHandlerState,
  type UserQuestionHandlerActions,
  type ModelSelectorHandlerState,
  type ModelSelectorHandlerActions,
} from "@/state/chat/keyboard/handlers/dialog-handler.ts";

// ============================================================================
// Helpers
// ============================================================================

function createKeyEvent(
  name: string,
  opts: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {},
) {
  let propagationStopped = false;
  return {
    name,
    ctrl: opts.ctrl ?? false,
    meta: opts.meta ?? false,
    shift: opts.shift ?? false,
    stopPropagation: () => {
      propagationStopped = true;
    },
    get propagationStopped() {
      return propagationStopped;
    },
  };
}

function createMockUserQuestionState(
  overrides: Partial<UserQuestionHandlerState> = {},
): UserQuestionHandlerState {
  return {
    visible: true,
    isEditingCustom: false,
    isChatAboutThis: false,
    optionsCount: 3,
    regularOptionsCount: 3,
    highlightedIndex: 0,
    selectedValues: [],
    question: {
      id: "q1",
      message: "test?",
      options: [
        { label: "Option A", value: "a" },
        { label: "Option B", value: "b" },
        { label: "Option C", value: "c" },
      ],
      multiSelect: false,
    } as any,
    allOptions: [
      { label: "Option A", value: "a" },
      { label: "Option B", value: "b" },
      { label: "Option C", value: "c" },
    ],
    ...overrides,
  };
}

function createMockUserQuestionActions(): UserQuestionHandlerActions & {
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const track =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] = args;
    };
  return {
    setHighlightedIndex: track("setHighlightedIndex") as any,
    setSelectedValues: track("setSelectedValues") as any,
    setIsEditingCustom: track("setIsEditingCustom"),
    setIsChatAboutThis: track("setIsChatAboutThis"),
    submitAnswer: track("submitAnswer") as any,
    cancelDialog: track("cancelDialog") as any,
    submitCustomText: track("submitCustomText") as any,
    calls,
  };
}

function createMockModelSelectorState(
  overrides: Partial<ModelSelectorHandlerState> = {},
): ModelSelectorHandlerState {
  return {
    visible: true,
    selectedIndex: 0,
    reasoningModel: null,
    reasoningIndex: 0,
    reasoningOptions: [],
    flatModels: [
      { id: "model-1", name: "Model 1" },
      { id: "model-2", name: "Model 2" },
      { id: "model-3", name: "Model 3" },
    ] as any,
    ...overrides,
  };
}

function createMockModelSelectorActions(): ModelSelectorHandlerActions & {
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const track =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] = args;
    };
  return {
    setSelectedIndex: track("setSelectedIndex") as any,
    setReasoningModel: track("setReasoningModel"),
    setReasoningIndex: track("setReasoningIndex") as any,
    onSelect: track("onSelect") as any,
    onCancel: track("onCancel") as any,
    confirmModel: track("confirmModel") as any,
    calls,
  };
}

// ============================================================================
// Tests: Constants
// ============================================================================

describe("exported constants", () => {
  test("CUSTOM_INPUT_VALUE has expected value", () => {
    expect(CUSTOM_INPUT_VALUE).toBe("__custom_input__");
  });

  test("CHAT_ABOUT_THIS_VALUE has expected value", () => {
    expect(CHAT_ABOUT_THIS_VALUE).toBe("__chat_about_this__");
  });
});

// ============================================================================
// Tests: toggleSelection
// ============================================================================

describe("toggleSelection", () => {
  test("adds value when not present in empty array", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
  });

  test("adds value when not present in non-empty array", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  test("removes value when already present", () => {
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  test("removes value from single-element array", () => {
    expect(toggleSelection(["a"], "a")).toEqual([]);
  });

  test("preserves order of remaining elements after removal", () => {
    expect(toggleSelection(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  test("does not mutate original array when adding", () => {
    const original = ["a"];
    const result = toggleSelection(original, "b");
    expect(original).toEqual(["a"]);
    expect(result).toEqual(["a", "b"]);
    expect(result).not.toBe(original);
  });

  test("does not mutate original array when removing", () => {
    const original = ["a", "b"];
    const result = toggleSelection(original, "a");
    expect(original).toEqual(["a", "b"]);
    expect(result).toEqual(["b"]);
    expect(result).not.toBe(original);
  });
});

// ============================================================================
// Tests: isMultiSelectSubmitKey
// ============================================================================

describe("isMultiSelectSubmitKey", () => {
  test("returns true for ctrl+return", () => {
    expect(isMultiSelectSubmitKey("return", true, false)).toBe(true);
  });

  test("returns true for meta+return", () => {
    expect(isMultiSelectSubmitKey("return", false, true)).toBe(true);
  });

  test("returns true for ctrl+meta+return", () => {
    expect(isMultiSelectSubmitKey("return", true, true)).toBe(true);
  });

  test("returns true for ctrl+linefeed", () => {
    expect(isMultiSelectSubmitKey("linefeed", true, false)).toBe(true);
  });

  test("returns true for meta+linefeed", () => {
    expect(isMultiSelectSubmitKey("linefeed", false, true)).toBe(true);
  });

  test("returns false for plain return (no modifier)", () => {
    expect(isMultiSelectSubmitKey("return", false, false)).toBe(false);
  });

  test("returns false for plain linefeed (no modifier)", () => {
    expect(isMultiSelectSubmitKey("linefeed", false, false)).toBe(false);
  });

  test("returns false for non-return key even with ctrl", () => {
    expect(isMultiSelectSubmitKey("a", true, false)).toBe(false);
  });

  test("returns false for non-return key even with meta", () => {
    expect(isMultiSelectSubmitKey("escape", false, true)).toBe(false);
  });
});

// ============================================================================
// Tests: handleUserQuestionKey
// ============================================================================

describe("handleUserQuestionKey", () => {
  // --- Visibility gate ---

  test("returns false when not visible", () => {
    const state = createMockUserQuestionState({ visible: false });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(false);
    // No actions should have been called
    expect(Object.keys(actions.calls)).toHaveLength(0);
  });

  // --- Custom input editing mode ---

  test("escape in custom editing mode exits editing", () => {
    const state = createMockUserQuestionState({ isEditingCustom: true });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("escape") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setIsEditingCustom).toEqual([false]);
    expect(actions.calls.setIsChatAboutThis).toEqual([false]);
  });

  test("return in custom editing mode submits custom text", () => {
    const state = createMockUserQuestionState({ isEditingCustom: true });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.submitCustomText).toBeDefined();
  });

  test("other keys in editing mode return false (let textarea handle)", () => {
    const state = createMockUserQuestionState({ isEditingCustom: true });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("a") as any, state, actions);
    expect(result).toBe(false);
  });

  test("escape in chat-about-this mode exits editing", () => {
    const state = createMockUserQuestionState({ isChatAboutThis: true });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("escape") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setIsEditingCustom).toEqual([false]);
    expect(actions.calls.setIsChatAboutThis).toEqual([false]);
  });

  // --- Number key selection ---

  test("number key 1 selects first option in single-select mode", () => {
    const state = createMockUserQuestionState();
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("1") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.submitAnswer).toEqual([["a"]]);
  });

  test("number key 2 selects second option in single-select mode", () => {
    const state = createMockUserQuestionState();
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("2") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.submitAnswer).toEqual([["b"]]);
  });

  test("number key beyond range is ignored gracefully", () => {
    const state = createMockUserQuestionState({ regularOptionsCount: 2 });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("5") as any, state, actions);
    expect(result).toBe(true);
    // submitAnswer should NOT be called
    expect(actions.calls.submitAnswer).toBeUndefined();
  });

  test("number key in multi-select mode toggles selection", () => {
    const state = createMockUserQuestionState({
      question: {
        id: "q1",
        message: "test?",
        options: [
          { label: "a", value: "a" },
          { label: "b", value: "b" },
        ],
        multiSelect: true,
      } as any,
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("1") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedValues).toBeDefined();
    expect(actions.calls.setHighlightedIndex).toBeDefined();
  });

  // --- Navigation ---

  test("up key calls setHighlightedIndex", () => {
    const state = createMockUserQuestionState({ highlightedIndex: 1 });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("up") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setHighlightedIndex).toBeDefined();
  });

  test("down key calls setHighlightedIndex", () => {
    const state = createMockUserQuestionState({ highlightedIndex: 0 });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("down") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setHighlightedIndex).toBeDefined();
  });

  test("ctrl+p navigates up", () => {
    const state = createMockUserQuestionState({ highlightedIndex: 1 });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(
      createKeyEvent("p", { ctrl: true }) as any,
      state,
      actions,
    );
    expect(result).toBe(true);
    expect(actions.calls.setHighlightedIndex).toBeDefined();
  });

  test("ctrl+n navigates down", () => {
    const state = createMockUserQuestionState();
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(
      createKeyEvent("n", { ctrl: true }) as any,
      state,
      actions,
    );
    expect(result).toBe(true);
    expect(actions.calls.setHighlightedIndex).toBeDefined();
  });

  test("k key navigates up", () => {
    const state = createMockUserQuestionState({ highlightedIndex: 2 });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("k") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setHighlightedIndex).toBeDefined();
  });

  test("j key navigates down", () => {
    const state = createMockUserQuestionState();
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("j") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setHighlightedIndex).toBeDefined();
  });

  // --- Space in multi-select ---

  test("space toggles selection in multi-select mode", () => {
    const state = createMockUserQuestionState({
      highlightedIndex: 0,
      question: {
        id: "q1",
        message: "test?",
        options: [{ label: "a", value: "a" }],
        multiSelect: true,
      } as any,
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("space") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedValues).toBeDefined();
  });

  test("space on CUSTOM_INPUT_VALUE option does not toggle", () => {
    const state = createMockUserQuestionState({
      highlightedIndex: 0,
      allOptions: [{ label: "Custom", value: CUSTOM_INPUT_VALUE }],
      question: {
        id: "q1",
        message: "test?",
        options: [{ label: "Custom", value: CUSTOM_INPUT_VALUE }],
        multiSelect: true,
      } as any,
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("space") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedValues).toBeUndefined();
  });

  test("space on CHAT_ABOUT_THIS_VALUE option does not toggle", () => {
    const state = createMockUserQuestionState({
      highlightedIndex: 0,
      allOptions: [{ label: "Chat", value: CHAT_ABOUT_THIS_VALUE }],
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("space") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedValues).toBeUndefined();
  });

  // --- Enter to select/submit ---

  test("return submits answer in single-select mode", () => {
    const state = createMockUserQuestionState({ highlightedIndex: 0 });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.submitAnswer).toEqual([["a"]]);
  });

  test("return on CUSTOM_INPUT_VALUE enters editing mode", () => {
    const state = createMockUserQuestionState({
      highlightedIndex: 0,
      allOptions: [{ label: "Custom Input", value: CUSTOM_INPUT_VALUE }],
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setIsEditingCustom).toEqual([true]);
  });

  test("return on CHAT_ABOUT_THIS_VALUE enters chat-about-this mode", () => {
    const state = createMockUserQuestionState({
      highlightedIndex: 0,
      allOptions: [{ label: "Chat About This", value: CHAT_ABOUT_THIS_VALUE }],
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setIsChatAboutThis).toEqual([true]);
  });

  test("return in multi-select mode toggles selection", () => {
    const state = createMockUserQuestionState({
      highlightedIndex: 0,
      question: {
        id: "q1",
        message: "test?",
        options: [{ label: "a", value: "a" }],
        multiSelect: true,
      } as any,
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedValues).toBeDefined();
  });

  // --- Multi-select submit ---

  test("ctrl+return submits in multi-select mode with selections", () => {
    const state = createMockUserQuestionState({
      selectedValues: ["a"],
      question: {
        id: "q1",
        message: "test?",
        options: [{ label: "a", value: "a" }],
        multiSelect: true,
      } as any,
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(
      createKeyEvent("return", { ctrl: true }) as any,
      state,
      actions,
    );
    expect(result).toBe(true);
    expect(actions.calls.submitAnswer).toEqual([["a"]]);
  });

  test("ctrl+return does not submit with empty selections", () => {
    const state = createMockUserQuestionState({
      selectedValues: [],
      question: {
        id: "q1",
        message: "test?",
        options: [{ label: "a", value: "a" }],
        multiSelect: true,
      } as any,
    });
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(
      createKeyEvent("return", { ctrl: true }) as any,
      state,
      actions,
    );
    expect(result).toBe(true);
    expect(actions.calls.submitAnswer).toBeUndefined();
  });

  // --- Escape ---

  test("escape cancels dialog", () => {
    const state = createMockUserQuestionState();
    const actions = createMockUserQuestionActions();
    const result = handleUserQuestionKey(createKeyEvent("escape") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.cancelDialog).toBeDefined();
  });

  // --- Propagation ---

  test("stops propagation for consumed keys", () => {
    const state = createMockUserQuestionState();
    const actions = createMockUserQuestionActions();
    const event = createKeyEvent("return");
    handleUserQuestionKey(event as any, state, actions);
    expect(event.propagationStopped).toBe(true);
  });
});

// ============================================================================
// Tests: handleModelSelectorKey
// ============================================================================

describe("handleModelSelectorKey", () => {
  // --- Visibility gate ---

  test("returns false when not visible", () => {
    const state = createMockModelSelectorState({ visible: false });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(false);
    expect(Object.keys(actions.calls)).toHaveLength(0);
  });

  // --- Model selection phase ---

  test("escape cancels model selector", () => {
    const state = createMockModelSelectorState();
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("escape") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.onCancel).toBeDefined();
  });

  test("up key navigates up in model list", () => {
    const state = createMockModelSelectorState({ selectedIndex: 1 });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("up") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedIndex).toBeDefined();
  });

  test("down key navigates down in model list", () => {
    const state = createMockModelSelectorState({ selectedIndex: 0 });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("down") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedIndex).toBeDefined();
  });

  test("k key navigates up in model list", () => {
    const state = createMockModelSelectorState({ selectedIndex: 1 });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("k") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedIndex).toBeDefined();
  });

  test("j key navigates down in model list", () => {
    const state = createMockModelSelectorState({ selectedIndex: 0 });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("j") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedIndex).toBeDefined();
  });

  test("number key selects and confirms model", () => {
    const state = createMockModelSelectorState();
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("1") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setSelectedIndex).toBeDefined();
    expect(actions.calls.confirmModel).toBeDefined();
  });

  test("number key beyond range sets index but does not confirm", () => {
    const state = createMockModelSelectorState({
      flatModels: [{ id: "m1", name: "M1" }] as any,
    });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("5") as any, state, actions);
    expect(result).toBe(true);
    // confirmModel should NOT be called because index 4 is out of range
    expect(actions.calls.confirmModel).toBeUndefined();
  });

  test("return confirms currently selected model", () => {
    const state = createMockModelSelectorState({ selectedIndex: 1 });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.confirmModel).toBeDefined();
  });

  test("linefeed confirms currently selected model", () => {
    const state = createMockModelSelectorState({ selectedIndex: 0 });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("linefeed") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.confirmModel).toBeDefined();
  });

  // --- Reasoning level selection phase ---

  test("escape in reasoning phase clears reasoning model", () => {
    const state = createMockModelSelectorState({
      reasoningModel: { id: "m1", name: "M1" } as any,
      reasoningOptions: [{ level: "low", isDefault: false }, { level: "high", isDefault: true }],
    });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("escape") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setReasoningModel).toEqual([null]);
  });

  test("up key navigates reasoning options", () => {
    const state = createMockModelSelectorState({
      reasoningModel: { id: "m1", name: "M1" } as any,
      reasoningIndex: 1,
      reasoningOptions: [{ level: "low", isDefault: false }, { level: "high", isDefault: true }],
    });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("up") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setReasoningIndex).toBeDefined();
  });

  test("down key navigates reasoning options", () => {
    const state = createMockModelSelectorState({
      reasoningModel: { id: "m1", name: "M1" } as any,
      reasoningIndex: 0,
      reasoningOptions: [{ level: "low", isDefault: false }, { level: "high", isDefault: true }],
    });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("down") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setReasoningIndex).toBeDefined();
  });

  test("return in reasoning phase selects reasoning level", () => {
    const state = createMockModelSelectorState({
      reasoningModel: { id: "m1", name: "M1" } as any,
      reasoningIndex: 0,
      reasoningOptions: [{ level: "low", isDefault: false }, { level: "high", isDefault: true }],
    });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("return") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.onSelect).toBeDefined();
    expect(actions.calls.onSelect![0]).toBe(state.reasoningModel);
    expect(actions.calls.onSelect![1]).toBe("low");
  });

  test("number key in reasoning phase selects that reasoning level", () => {
    const state = createMockModelSelectorState({
      reasoningModel: { id: "m1", name: "M1" } as any,
      reasoningIndex: 0,
      reasoningOptions: [
        { level: "low", isDefault: false },
        { level: "medium", isDefault: false },
        { level: "high", isDefault: true },
      ],
    });
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("2") as any, state, actions);
    expect(result).toBe(true);
    expect(actions.calls.setReasoningIndex).toBeDefined();
    expect(actions.calls.onSelect).toBeDefined();
    expect(actions.calls.onSelect![1]).toBe("medium");
  });

  // --- Propagation ---

  test("stops propagation for consumed keys", () => {
    const state = createMockModelSelectorState();
    const actions = createMockModelSelectorActions();
    const event = createKeyEvent("escape");
    handleModelSelectorKey(event as any, state, actions);
    expect(event.propagationStopped).toBe(true);
  });

  test("unrecognized key in model phase returns false", () => {
    const state = createMockModelSelectorState();
    const actions = createMockModelSelectorActions();
    const result = handleModelSelectorKey(createKeyEvent("x") as any, state, actions);
    expect(result).toBe(false);
  });
});
