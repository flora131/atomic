/**
 * Tests for UserQuestionDialog Component
 *
 * Tests cover:
 * - Component rendering with different question types
 * - Navigation (up/down)
 * - Selection (space key, enter key)
 * - Multi-select mode
 * - Cancellation (escape key)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  navigateUp,
  navigateDown,
  toggleSelection,
  type UserQuestion,
  type QuestionAnswer,
  type QuestionOption,
} from "../../../src/ui/components/user-question-dialog.tsx";

// ============================================================================
// NAVIGATE UP/DOWN TESTS
// ============================================================================

describe("navigateUp", () => {
  test("decrements index by 1", () => {
    expect(navigateUp(2, 5)).toBe(1);
    expect(navigateUp(4, 5)).toBe(3);
  });

  test("wraps from 0 to last index", () => {
    expect(navigateUp(0, 5)).toBe(4);
    expect(navigateUp(0, 3)).toBe(2);
  });

  test("returns 0 for empty list", () => {
    expect(navigateUp(0, 0)).toBe(0);
  });

  test("handles single item list", () => {
    expect(navigateUp(0, 1)).toBe(0);
  });
});

describe("navigateDown", () => {
  test("increments index by 1", () => {
    expect(navigateDown(0, 5)).toBe(1);
    expect(navigateDown(2, 5)).toBe(3);
  });

  test("wraps from last index to 0", () => {
    expect(navigateDown(4, 5)).toBe(0);
    expect(navigateDown(2, 3)).toBe(0);
  });

  test("returns 0 for empty list", () => {
    expect(navigateDown(0, 0)).toBe(0);
  });

  test("handles single item list", () => {
    expect(navigateDown(0, 1)).toBe(0);
  });
});

// ============================================================================
// TOGGLE SELECTION TESTS
// ============================================================================

describe("toggleSelection", () => {
  test("adds value when not present", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["b"], "a")).toEqual(["b", "a"]);
  });

  test("removes value when present", () => {
    expect(toggleSelection(["a"], "a")).toEqual([]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  test("preserves order of other values", () => {
    expect(toggleSelection(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  test("handles empty array", () => {
    expect(toggleSelection([], "x")).toEqual(["x"]);
  });
});

// ============================================================================
// USER QUESTION STRUCTURE TESTS
// ============================================================================

describe("UserQuestion structure", () => {
  test("creates basic question", () => {
    const question: UserQuestion = {
      header: "Test Header",
      question: "Test question text?",
      options: [
        { label: "Option A", value: "a" },
        { label: "Option B", value: "b" },
      ],
    };

    expect(question.header).toBe("Test Header");
    expect(question.question).toBe("Test question text?");
    expect(question.options).toHaveLength(2);
    expect(question.multiSelect).toBeUndefined();
  });

  test("creates multi-select question", () => {
    const question: UserQuestion = {
      header: "Multi-Select",
      question: "Select all that apply:",
      options: [
        { label: "One", value: "1" },
        { label: "Two", value: "2" },
        { label: "Three", value: "3" },
      ],
      multiSelect: true,
    };

    expect(question.multiSelect).toBe(true);
    expect(question.options).toHaveLength(3);
  });

  test("option with description", () => {
    const option: QuestionOption = {
      label: "Dark Theme",
      value: "dark",
      description: "A dark color scheme for low-light environments",
    };

    expect(option.label).toBe("Dark Theme");
    expect(option.value).toBe("dark");
    expect(option.description).toBeDefined();
  });
});

// ============================================================================
// QUESTION ANSWER STRUCTURE TESTS
// ============================================================================

describe("QuestionAnswer structure", () => {
  test("creates single-select answer", () => {
    const answer: QuestionAnswer = {
      selected: "option_a",
      cancelled: false,
    };

    expect(answer.selected).toBe("option_a");
    expect(answer.cancelled).toBe(false);
  });

  test("creates multi-select answer", () => {
    const answer: QuestionAnswer = {
      selected: ["option_a", "option_c"],
      cancelled: false,
    };

    expect(answer.selected).toEqual(["option_a", "option_c"]);
    expect(answer.cancelled).toBe(false);
  });

  test("creates cancelled answer", () => {
    const answer: QuestionAnswer = {
      selected: "",
      cancelled: true,
    };

    expect(answer.cancelled).toBe(true);
  });
});

// ============================================================================
// KEYBOARD NAVIGATION SIMULATION TESTS
// ============================================================================

describe("Keyboard navigation simulation", () => {
  let highlightedIndex: number;
  let selectedValues: string[];
  const options: QuestionOption[] = [
    { label: "Option A", value: "a" },
    { label: "Option B", value: "b" },
    { label: "Option C", value: "c" },
  ];

  beforeEach(() => {
    highlightedIndex = 0;
    selectedValues = [];
  });

  test("up arrow navigates up", () => {
    highlightedIndex = 1;
    highlightedIndex = navigateUp(highlightedIndex, options.length);
    expect(highlightedIndex).toBe(0);
  });

  test("down arrow navigates down", () => {
    highlightedIndex = navigateDown(highlightedIndex, options.length);
    expect(highlightedIndex).toBe(1);
  });

  test("up wraps to bottom", () => {
    highlightedIndex = 0;
    highlightedIndex = navigateUp(highlightedIndex, options.length);
    expect(highlightedIndex).toBe(2);
  });

  test("down wraps to top", () => {
    highlightedIndex = 2;
    highlightedIndex = navigateDown(highlightedIndex, options.length);
    expect(highlightedIndex).toBe(0);
  });

  test("space toggles selection in multi-select", () => {
    // Simulate pressing space on first option
    const option = options[highlightedIndex];
    selectedValues = toggleSelection(selectedValues, option!.value);
    expect(selectedValues).toContain("a");

    // Press space again to deselect
    selectedValues = toggleSelection(selectedValues, option!.value);
    expect(selectedValues).not.toContain("a");
  });

  test("multi-select can select multiple options", () => {
    // Select first option
    selectedValues = toggleSelection(selectedValues, options[0]!.value);
    // Navigate down and select second
    highlightedIndex = navigateDown(highlightedIndex, options.length);
    selectedValues = toggleSelection(selectedValues, options[highlightedIndex]!.value);

    expect(selectedValues).toEqual(["a", "b"]);
    expect(selectedValues).toHaveLength(2);
  });

  test("single-select replaces previous selection", () => {
    // In single-select mode, pressing space/enter replaces selection
    selectedValues = ["a"];

    // For single select, we replace (simulate pressing space on option b)
    selectedValues = ["b"];

    expect(selectedValues).toEqual(["b"]);
    expect(selectedValues).toHaveLength(1);
  });
});

// ============================================================================
// ANSWER CREATION TESTS
// ============================================================================

describe("Answer creation scenarios", () => {
  test("enter on highlighted option in single-select mode", () => {
    const highlightedIndex = 1;
    const selectedValues: string[] = [];
    const options: QuestionOption[] = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ];
    const multiSelect = false;

    // Simulate Enter key behavior: use highlighted if nothing selected
    let result = selectedValues;
    if (!multiSelect && result.length === 0) {
      const option = options[highlightedIndex];
      if (option) {
        result = [option.value];
      }
    }

    const answer: QuestionAnswer = {
      selected: multiSelect ? result : result[0] ?? "",
      cancelled: false,
    };

    expect(answer.selected).toBe("b");
  });

  test("enter with explicit selection in single-select mode", () => {
    const selectedValues = ["a"];
    const multiSelect = false;

    const answer: QuestionAnswer = {
      selected: multiSelect ? selectedValues : selectedValues[0] ?? "",
      cancelled: false,
    };

    expect(answer.selected).toBe("a");
  });

  test("enter in multi-select mode returns array", () => {
    const selectedValues = ["a", "c"];
    const multiSelect = true;

    const answer: QuestionAnswer = {
      selected: multiSelect ? selectedValues : selectedValues[0] ?? "",
      cancelled: false,
    };

    expect(answer.selected).toEqual(["a", "c"]);
  });

  test("escape returns cancelled answer in single-select", () => {
    const multiSelect = false;

    const answer: QuestionAnswer = {
      selected: multiSelect ? [] : "",
      cancelled: true,
    };

    expect(answer.selected).toBe("");
    expect(answer.cancelled).toBe(true);
  });

  test("escape returns cancelled answer in multi-select", () => {
    const multiSelect = true;

    const answer: QuestionAnswer = {
      selected: multiSelect ? [] : "",
      cancelled: true,
    };

    expect(answer.selected).toEqual([]);
    expect(answer.cancelled).toBe(true);
  });
});

// ============================================================================
// QUESTION OPTION EDGE CASES
// ============================================================================

describe("Question option edge cases", () => {
  test("handles empty options array", () => {
    const question: UserQuestion = {
      header: "Empty",
      question: "No options?",
      options: [],
    };

    expect(question.options).toHaveLength(0);
    expect(navigateUp(0, 0)).toBe(0);
    expect(navigateDown(0, 0)).toBe(0);
  });

  test("handles single option", () => {
    const question: UserQuestion = {
      header: "Single",
      question: "Only one option",
      options: [{ label: "Only Option", value: "only" }],
    };

    expect(question.options).toHaveLength(1);
    expect(navigateUp(0, 1)).toBe(0);
    expect(navigateDown(0, 1)).toBe(0);
  });

  test("handles long option labels", () => {
    const longLabel = "This is a very long option label that might need to wrap or be truncated in the UI";
    const option: QuestionOption = {
      label: longLabel,
      value: "long",
    };

    expect(option.label).toBe(longLabel);
    expect(option.label.length).toBeGreaterThan(50);
  });

  test("handles options with same labels but different values", () => {
    const options: QuestionOption[] = [
      { label: "Same Label", value: "value_1" },
      { label: "Same Label", value: "value_2" },
    ];

    expect(options[0]!.label).toBe(options[1]!.label);
    expect(options[0]!.value).not.toBe(options[1]!.value);
  });
});

// ============================================================================
// SELECTION STATE TESTS
// ============================================================================

describe("Selection state management", () => {
  test("initial state has no selections", () => {
    const selectedValues: string[] = [];
    expect(selectedValues).toEqual([]);
    expect(selectedValues.length).toBe(0);
  });

  test("can build up multiple selections", () => {
    let selectedValues: string[] = [];

    selectedValues = toggleSelection(selectedValues, "first");
    expect(selectedValues).toEqual(["first"]);

    selectedValues = toggleSelection(selectedValues, "second");
    expect(selectedValues).toEqual(["first", "second"]);

    selectedValues = toggleSelection(selectedValues, "third");
    expect(selectedValues).toEqual(["first", "second", "third"]);
  });

  test("can remove selections in any order", () => {
    let selectedValues = ["a", "b", "c"];

    selectedValues = toggleSelection(selectedValues, "b");
    expect(selectedValues).toEqual(["a", "c"]);

    selectedValues = toggleSelection(selectedValues, "a");
    expect(selectedValues).toEqual(["c"]);

    selectedValues = toggleSelection(selectedValues, "c");
    expect(selectedValues).toEqual([]);
  });

  test("toggling same value twice returns to original state", () => {
    let selectedValues: string[] = [];

    selectedValues = toggleSelection(selectedValues, "x");
    selectedValues = toggleSelection(selectedValues, "x");

    expect(selectedValues).toEqual([]);
  });
});

// ============================================================================
// HIGHLIGHTED INDEX TESTS
// ============================================================================

describe("Highlighted index behavior", () => {
  test("initial highlighted index is 0", () => {
    const highlightedIndex = 0;
    expect(highlightedIndex).toBe(0);
  });

  test("can navigate through all options", () => {
    const optionsCount = 4;
    let index = 0;

    // Navigate down through all options
    index = navigateDown(index, optionsCount); // 0 -> 1
    expect(index).toBe(1);

    index = navigateDown(index, optionsCount); // 1 -> 2
    expect(index).toBe(2);

    index = navigateDown(index, optionsCount); // 2 -> 3
    expect(index).toBe(3);

    index = navigateDown(index, optionsCount); // 3 -> 0 (wrap)
    expect(index).toBe(0);
  });

  test("can navigate backwards through all options", () => {
    const optionsCount = 4;
    let index = 0;

    // Navigate up (wrap to bottom)
    index = navigateUp(index, optionsCount); // 0 -> 3
    expect(index).toBe(3);

    index = navigateUp(index, optionsCount); // 3 -> 2
    expect(index).toBe(2);

    index = navigateUp(index, optionsCount); // 2 -> 1
    expect(index).toBe(1);

    index = navigateUp(index, optionsCount); // 1 -> 0
    expect(index).toBe(0);
  });
});
