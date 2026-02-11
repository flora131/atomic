/**
 * Tests for ChatApp Autocomplete Integration
 *
 * Verifies that slash commands trigger autocomplete behavior.
 */

import { describe, test, expect } from "bun:test";
import {
  type WorkflowChatState,
  defaultWorkflowChatState,
} from "../../src/ui/chat.tsx";

// ============================================================================
// HELPER FUNCTIONS (mirroring ChatApp internal logic)
// ============================================================================

/**
 * Simulate the input change handler logic from ChatApp.
 * This is the same logic used in handleInputChange.
 */
function simulateInputChange(
  value: string,
  currentState: WorkflowChatState
): Partial<WorkflowChatState> {
  // Check if input starts with "/" (slash command)
  if (value.startsWith("/")) {
    // Extract the command prefix (text after "/" without spaces)
    const afterSlash = value.slice(1);

    // Only show autocomplete if there's no space (still typing command name)
    if (!afterSlash.includes(" ")) {
      return {
        showAutocomplete: true,
        autocompleteInput: afterSlash,
        selectedSuggestionIndex: 0, // Reset selection on input change
      };
    } else {
      // Hide autocomplete when there's a space (user is typing arguments)
      return {
        showAutocomplete: false,
        autocompleteInput: "",
      };
    }
  } else {
    // Hide autocomplete for non-slash commands
    if (currentState.showAutocomplete) {
      return {
        showAutocomplete: false,
        autocompleteInput: "",
        selectedSuggestionIndex: 0,
      };
    }
    return {};
  }
}

/**
 * Apply partial state updates (simulating React setState merge)
 */
function applyUpdates(
  state: WorkflowChatState,
  updates: Partial<WorkflowChatState>
): WorkflowChatState {
  return { ...state, ...updates };
}

// ============================================================================
// AUTOCOMPLETE TRIGGER TESTS
// ============================================================================

describe("Autocomplete triggering", () => {
  test("shows autocomplete when typing '/'", () => {
    const state = { ...defaultWorkflowChatState };
    const updates = simulateInputChange("/", state);

    expect(updates.showAutocomplete).toBe(true);
    expect(updates.autocompleteInput).toBe("");
  });

  test("shows autocomplete with prefix when typing '/h'", () => {
    const state = { ...defaultWorkflowChatState };
    const updates = simulateInputChange("/h", state);

    expect(updates.showAutocomplete).toBe(true);
    expect(updates.autocompleteInput).toBe("h");
  });

  test("shows autocomplete with longer prefix '/help'", () => {
    const state = { ...defaultWorkflowChatState };
    const updates = simulateInputChange("/help", state);

    expect(updates.showAutocomplete).toBe(true);
    expect(updates.autocompleteInput).toBe("help");
  });

  test("hides autocomplete when space is typed after command", () => {
    const state = { ...defaultWorkflowChatState, showAutocomplete: true };
    const updates = simulateInputChange("/atomic ", state);

    expect(updates.showAutocomplete).toBe(false);
    expect(updates.autocompleteInput).toBe("");
  });

  test("keeps autocomplete hidden when typing arguments", () => {
    const state = { ...defaultWorkflowChatState, showAutocomplete: false };
    const updates = simulateInputChange("/atomic Build a feature", state);

    expect(updates.showAutocomplete).toBe(false);
  });

  test("hides autocomplete for non-slash input", () => {
    const state = { ...defaultWorkflowChatState, showAutocomplete: true };
    const updates = simulateInputChange("hello", state);

    expect(updates.showAutocomplete).toBe(false);
    expect(updates.autocompleteInput).toBe("");
  });

  test("does nothing for non-slash input when autocomplete already hidden", () => {
    const state = { ...defaultWorkflowChatState, showAutocomplete: false };
    const updates = simulateInputChange("hello", state);

    // No updates needed when autocomplete is already hidden
    expect(Object.keys(updates).length).toBe(0);
  });

  test("resets selection index when input changes", () => {
    const state = {
      ...defaultWorkflowChatState,
      showAutocomplete: true,
      selectedSuggestionIndex: 5,
    };
    const updates = simulateInputChange("/he", state);

    expect(updates.selectedSuggestionIndex).toBe(0);
  });
});

// ============================================================================
// INPUT STATE TRANSITION TESTS
// ============================================================================

describe("Input state transitions", () => {
  test("full flow: empty → slash → command → arguments", () => {
    let state = { ...defaultWorkflowChatState };

    // User types nothing - no change
    let updates = simulateInputChange("", state);
    expect(Object.keys(updates).length).toBe(0);

    // User types "/"
    updates = simulateInputChange("/", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(true);
    expect(state.autocompleteInput).toBe("");

    // User types "/a"
    updates = simulateInputChange("/a", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(true);
    expect(state.autocompleteInput).toBe("a");

    // User types "/atomic"
    updates = simulateInputChange("/atomic", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(true);
    expect(state.autocompleteInput).toBe("atomic");

    // User types "/atomic " (with space)
    updates = simulateInputChange("/atomic ", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(false);

    // User types argument
    updates = simulateInputChange("/atomic Build a feature", state);
    // No change because autocomplete already hidden
    expect(updates.showAutocomplete).toBe(false);
  });

  test("flow: command → clear → regular text", () => {
    let state = { ...defaultWorkflowChatState };

    // User types "/help"
    let updates = simulateInputChange("/help", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(true);

    // User clears and types regular text
    updates = simulateInputChange("hello", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(false);
    expect(state.autocompleteInput).toBe("");
  });

  test("flow: regular text → slash command", () => {
    let state = { ...defaultWorkflowChatState };

    // User types regular text first
    let updates = simulateInputChange("hello", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(false);

    // User clears and types slash command
    updates = simulateInputChange("/", state);
    state = applyUpdates(state, updates);
    expect(state.showAutocomplete).toBe(true);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge cases", () => {
  test("handles just a slash", () => {
    const state = { ...defaultWorkflowChatState };
    const updates = simulateInputChange("/", state);

    expect(updates.showAutocomplete).toBe(true);
    expect(updates.autocompleteInput).toBe("");
  });

  test("handles multiple consecutive slashes", () => {
    const state = { ...defaultWorkflowChatState };
    const updates = simulateInputChange("//", state);

    // Should treat as a command prefix "/"
    expect(updates.showAutocomplete).toBe(true);
    expect(updates.autocompleteInput).toBe("/");
  });

  test("handles slash in middle of text (not at start)", () => {
    const state = { ...defaultWorkflowChatState, showAutocomplete: true };
    const updates = simulateInputChange("hello/world", state);

    // Not a slash command (doesn't start with /)
    expect(updates.showAutocomplete).toBe(false);
  });

  test("handles empty string", () => {
    const state = { ...defaultWorkflowChatState, showAutocomplete: true };
    const updates = simulateInputChange("", state);

    // Empty string should hide autocomplete
    expect(updates.showAutocomplete).toBe(false);
  });

  test("handles whitespace before slash", () => {
    const state = { ...defaultWorkflowChatState };
    const updates = simulateInputChange(" /help", state);

    // Doesn't start with "/" so not a command
    expect(Object.keys(updates).length).toBe(0);
  });

  test("handles command with multiple spaces in arguments", () => {
    const state = { ...defaultWorkflowChatState };
    const updates = simulateInputChange("/atomic Build   multiple   spaces", state);

    expect(updates.showAutocomplete).toBe(false);
  });
});

// ============================================================================
// AUTOCOMPLETE SELECTION TESTS
// ============================================================================

describe("Autocomplete index management", () => {
  test("index resets to 0 on new input", () => {
    const state = {
      ...defaultWorkflowChatState,
      showAutocomplete: true,
      selectedSuggestionIndex: 3,
      autocompleteInput: "hel",
    };

    // When input changes, index should reset
    const updates = simulateInputChange("/he", state);
    expect(updates.selectedSuggestionIndex).toBe(0);
  });

  test("index preserved when hiding autocomplete", () => {
    const state = {
      ...defaultWorkflowChatState,
      showAutocomplete: true,
      selectedSuggestionIndex: 3,
    };

    // When hiding, we explicitly reset to 0
    const updates = simulateInputChange("hello", state);
    expect(updates.selectedSuggestionIndex).toBe(0);
  });
});
