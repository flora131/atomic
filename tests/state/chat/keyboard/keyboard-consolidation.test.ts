/**
 * Keyboard Consolidation Tests
 *
 * Structural tests verifying that the keyboard system uses
 * `useKeyboardOwnership` and that dialog components delegate to
 * extracted handlers instead of duplicating keyboard logic inline.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(import.meta.dir, "../../../../src");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), "utf-8");
}

// ── Step 1: types.ts has UIMode and KeyboardOwnershipResult ──────────

describe("types.ts exports", () => {
  const typesSource = readSource("state/chat/keyboard/types.ts");

  it("exports UIMode type with all three modes", () => {
    expect(typesSource).toContain('export type UIMode = "chat" | "dialog" | "model-selector"');
  });

  it("exports KeyboardOwnershipResult interface", () => {
    expect(typesSource).toContain("export interface KeyboardOwnershipResult");
    expect(typesSource).toContain("ctrlCPressed: boolean");
  });
});

// ── Step 2: controller.ts uses useKeyboardOwnership ──────────────────

describe("controller.ts wiring", () => {
  const controllerSource = readSource("state/chat/controller/use-ui-controller-stack/controller.ts");

  it("imports useKeyboardOwnership instead of useChatKeyboard", () => {
    expect(controllerSource).toContain(
      'import { useKeyboardOwnership } from "@/state/chat/keyboard/use-keyboard-ownership.ts"'
    );
  });

  it("does not import useChatKeyboard", () => {
    expect(controllerSource).not.toContain("useChatKeyboard");
  });

  it("calls useKeyboardOwnership", () => {
    expect(controllerSource).toContain("useKeyboardOwnership(");
  });

  it("still destructures ctrlCPressed from keyboard result", () => {
    expect(controllerSource).toContain("keyboard.ctrlCPressed");
  });
});

// ── Step 3: barrel exports ──────────────────────────────────────────

describe("keyboard/index.ts barrel exports", () => {
  const indexSource = readSource("state/chat/keyboard/index.ts");

  it("exports useKeyboardOwnership", () => {
    expect(indexSource).toContain("useKeyboardOwnership");
  });

  it("exports UIMode type", () => {
    expect(indexSource).toContain("UIMode");
  });

  it("exports KeyboardOwnershipResult type", () => {
    expect(indexSource).toContain("KeyboardOwnershipResult");
  });

  it("does not export deprecated useChatKeyboard", () => {
    expect(indexSource).not.toContain("useChatKeyboard");
  });
});

// ── Step 4a: UserQuestionDialog delegates to handler ─────────────────

describe("UserQuestionDialog handler delegation", () => {
  const dialogSource = readSource("components/user-question-dialog.tsx");

  it("imports handleUserQuestionKey from dialog-handler", () => {
    expect(dialogSource).toContain(
      'import {\n  handleUserQuestionKey,'
    );
    expect(dialogSource).toContain(
      'from "@/state/chat/keyboard/handlers/dialog-handler.ts"'
    );
  });

  it("imports toggleSelection from dialog-handler (not defined locally)", () => {
    expect(dialogSource).toContain("toggleSelection,");
    // Should NOT have a local function definition
    expect(dialogSource).not.toMatch(/^export function toggleSelection/m);
  });

  it("imports isMultiSelectSubmitKey from dialog-handler (not defined locally)", () => {
    expect(dialogSource).toContain("isMultiSelectSubmitKey,");
    expect(dialogSource).not.toMatch(/^export function isMultiSelectSubmitKey/m);
  });

  it("imports CUSTOM_INPUT_VALUE from dialog-handler (not defined locally)", () => {
    expect(dialogSource).toContain("CUSTOM_INPUT_VALUE,");
    expect(dialogSource).not.toMatch(/^const CUSTOM_INPUT_VALUE/m);
  });

  it("imports CHAT_ABOUT_THIS_VALUE from dialog-handler (not defined locally)", () => {
    expect(dialogSource).toContain("CHAT_ABOUT_THIS_VALUE,");
    expect(dialogSource).not.toMatch(/^const CHAT_ABOUT_THIS_VALUE/m);
    expect(dialogSource).not.toMatch(/^export const CHAT_ABOUT_THIS_VALUE = /m);
  });

  it("re-exports utilities for backward compatibility", () => {
    expect(dialogSource).toContain(
      "export { toggleSelection, isMultiSelectSubmitKey, CHAT_ABOUT_THIS_VALUE }"
    );
  });

  it("calls handleUserQuestionKey inside useKeyboard callback", () => {
    expect(dialogSource).toContain("handleUserQuestionKey(event,");
  });

  it("does not contain inline switch/case keyboard logic", () => {
    // The old code had inline key === "up", key === "down" checks
    // with navigateUp/navigateDown calls inside useKeyboard.
    // Those should now only appear in handleMouseScroll, not in useKeyboard.
    const keyboardSection = dialogSource.split("useKeyboard(")[1]?.split(");")[0] ?? "";
    expect(keyboardSection).not.toContain("navigateUp");
    expect(keyboardSection).not.toContain("navigateDown");
  });
});

// ── Step 4b: ModelSelectorDialog delegates to handler ────────────────

describe("ModelSelectorDialog handler delegation", () => {
  const dialogSource = readSource("components/model-selector-dialog.tsx");

  it("imports handleModelSelectorKey from dialog-handler", () => {
    expect(dialogSource).toContain(
      'import { handleModelSelectorKey } from "@/state/chat/keyboard/handlers/dialog-handler.ts"'
    );
  });

  it("calls handleModelSelectorKey inside useKeyboard callback", () => {
    expect(dialogSource).toContain("handleModelSelectorKey(event,");
  });

  it("does not contain inline switch/case keyboard logic in useKeyboard", () => {
    const keyboardSection = dialogSource.split("useKeyboard(")[1]?.split(");")[0] ?? "";
    expect(keyboardSection).not.toContain("navigateUp");
    expect(keyboardSection).not.toContain("navigateDown");
    expect(keyboardSection).not.toContain('key === "escape"');
    expect(keyboardSection).not.toContain('key === "return"');
  });

  it("still has navigateUp/Down in handleMouseScroll (not in useKeyboard)", () => {
    // The mouse scroll handler should still use navigateUp/Down directly
    expect(dialogSource).toContain("navigateUp");
    expect(dialogSource).toContain("navigateDown");
  });
});

// ── Focus manager and UIMode ─────────────────────────────────────────

describe("focus-manager determineUIMode", () => {
  // Import the actual function for runtime verification
  const { determineUIMode } = require(
    path.join(SRC_ROOT, "state/chat/keyboard/focus-manager.ts")
  );

  it('returns "dialog" when activeQuestion is present', () => {
    expect(determineUIMode({ question: "test" }, false)).toBe("dialog");
  });

  it('returns "model-selector" when showModelSelector is true', () => {
    expect(determineUIMode(null, true)).toBe("model-selector");
  });

  it('returns "chat" when neither dialog nor model selector is active', () => {
    expect(determineUIMode(null, false)).toBe("chat");
  });

  it('prioritizes "dialog" over "model-selector"', () => {
    expect(determineUIMode({ question: "test" }, true)).toBe("dialog");
  });
});

// ── Dialog handler exports are intact ────────────────────────────────

describe("dialog-handler exports", () => {
  const handlerModule = require(
    path.join(SRC_ROOT, "state/chat/keyboard/handlers/dialog-handler.ts")
  );

  it("exports handleUserQuestionKey function", () => {
    expect(typeof handlerModule.handleUserQuestionKey).toBe("function");
  });

  it("exports handleModelSelectorKey function", () => {
    expect(typeof handlerModule.handleModelSelectorKey).toBe("function");
  });

  it("exports toggleSelection function", () => {
    expect(typeof handlerModule.toggleSelection).toBe("function");
  });

  it("exports isMultiSelectSubmitKey function", () => {
    expect(typeof handlerModule.isMultiSelectSubmitKey).toBe("function");
  });

  it("exports CUSTOM_INPUT_VALUE constant", () => {
    expect(handlerModule.CUSTOM_INPUT_VALUE).toBe("__custom_input__");
  });

  it("exports CHAT_ABOUT_THIS_VALUE constant", () => {
    expect(handlerModule.CHAT_ABOUT_THIS_VALUE).toBe("__chat_about_this__");
  });
});
