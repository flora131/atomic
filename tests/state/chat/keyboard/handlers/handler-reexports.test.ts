/**
 * Handler Re-export Tests
 *
 * Verifies that the thin re-export handler modules correctly re-export
 * all expected functions from their source modules with referential equality.
 */

import { describe, test, expect } from "bun:test";

// interrupt-handler re-exports
import {
  useChatInterruptControls,
  interruptForegroundAgents,
  interruptStreaming,
  useInterruptConfirmation,
} from "@/state/chat/keyboard/handlers/interrupt-handler.ts";

// Source modules for referential equality checks
import { useChatInterruptControls as sourceInterruptControls } from "@/state/chat/keyboard/use-interrupt-controls.ts";
import {
  interruptForegroundAgents as sourceInterruptForeground,
  interruptStreaming as sourceInterruptStreaming,
} from "@/state/chat/keyboard/interrupt-execution.ts";
import { useInterruptConfirmation as sourceInterruptConfirmation } from "@/state/chat/keyboard/use-interrupt-confirmation.ts";

// navigation-handler re-exports
import {
  handleNavigationKey,
  handleComposeShortcutKey,
  handleAutocompleteSelectionKey,
} from "@/state/chat/keyboard/handlers/navigation-handler.ts";
import {
  handleNavigationKey as sourceNavigationKey,
  handleComposeShortcutKey as sourceComposeShortcut,
  handleAutocompleteSelectionKey as sourceAutocompleteSelection,
} from "@/state/chat/keyboard/navigation.ts";

// submit-handler re-exports
import { handleComposerSubmit } from "@/state/chat/keyboard/handlers/submit-handler.ts";
import { handleComposerSubmit as sourceComposerSubmit } from "@/state/chat/composer/submit.ts";

describe("interrupt-handler re-exports", () => {
  test("useChatInterruptControls is a function", () => {
    expect(typeof useChatInterruptControls).toBe("function");
  });

  test("useChatInterruptControls is referentially equal to source", () => {
    expect(useChatInterruptControls).toBe(sourceInterruptControls);
  });

  test("interruptForegroundAgents is a function", () => {
    expect(typeof interruptForegroundAgents).toBe("function");
  });

  test("interruptForegroundAgents is referentially equal to source", () => {
    expect(interruptForegroundAgents).toBe(sourceInterruptForeground);
  });

  test("interruptStreaming is a function", () => {
    expect(typeof interruptStreaming).toBe("function");
  });

  test("interruptStreaming is referentially equal to source", () => {
    expect(interruptStreaming).toBe(sourceInterruptStreaming);
  });

  test("useInterruptConfirmation is a function", () => {
    expect(typeof useInterruptConfirmation).toBe("function");
  });

  test("useInterruptConfirmation is referentially equal to source", () => {
    expect(useInterruptConfirmation).toBe(sourceInterruptConfirmation);
  });
});

describe("navigation-handler re-exports", () => {
  test("handleNavigationKey is a function", () => {
    expect(typeof handleNavigationKey).toBe("function");
  });

  test("handleNavigationKey is referentially equal to source", () => {
    expect(handleNavigationKey).toBe(sourceNavigationKey);
  });

  test("handleComposeShortcutKey is a function", () => {
    expect(typeof handleComposeShortcutKey).toBe("function");
  });

  test("handleComposeShortcutKey is referentially equal to source", () => {
    expect(handleComposeShortcutKey).toBe(sourceComposeShortcut);
  });

  test("handleAutocompleteSelectionKey is a function", () => {
    expect(typeof handleAutocompleteSelectionKey).toBe("function");
  });

  test("handleAutocompleteSelectionKey is referentially equal to source", () => {
    expect(handleAutocompleteSelectionKey).toBe(sourceAutocompleteSelection);
  });
});

describe("submit-handler re-exports", () => {
  test("handleComposerSubmit is a function", () => {
    expect(typeof handleComposerSubmit).toBe("function");
  });

  test("handleComposerSubmit is referentially equal to source", () => {
    expect(handleComposerSubmit).toBe(sourceComposerSubmit);
  });
});
