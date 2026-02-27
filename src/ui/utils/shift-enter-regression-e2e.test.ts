import { describe, expect, test } from "bun:test";

import { getNextKittyKeyboardDetectionState } from "./kitty-keyboard-detection.ts";
import {
  shouldApplyBackslashLineContinuation,
  shouldEnqueueMessageFromKeyEvent,
  shouldInsertNewlineFallbackFromKeyEvent,
  shouldInsertNewlineFromKeyEvent,
  type NewlineKeyEventLike,
} from "./newline-strategies.ts";

interface SimulatedKeyEvent extends NewlineKeyEventLike {
  raw?: string;
}

interface InputHarness {
  value: string;
  submitted: string[];
  enqueued: string[];
  executedCommands: string[];
  kittyKeyboardDetected: boolean;
  autocompleteVisible: boolean;
  isStreaming: boolean;
  typeText: (text: string) => void;
  pressKey: (event: SimulatedKeyEvent) => void;
}

interface InputHarnessOptions {
  platform?: NodeJS.Platform | string;
  isStreaming?: boolean;
}

function createInputHarness(options: InputHarnessOptions = {}): InputHarness {
  const state = {
    platform: options.platform ?? "linux",
    value: "",
    submitted: [] as string[],
    enqueued: [] as string[],
    executedCommands: [] as string[],
    kittyKeyboardDetected: false,
    autocompleteVisible: false,
    isStreaming: options.isStreaming ?? false,
  };

  const pressKey = (event: SimulatedKeyEvent): void => {
    state.kittyKeyboardDetected = getNextKittyKeyboardDetectionState(
      state.kittyKeyboardDetected,
      event.raw,
    );

    if (event.name === "backspace") {
      if (state.value.length > 0) {
        state.value = state.value.slice(0, -1);
      }
      return;
    }

    if (shouldEnqueueMessageFromKeyEvent(event, state.platform)) {
      const trimmed = state.value.trim();
      if (trimmed) {
        state.enqueued.push(trimmed);
      }
      state.value = "";
      return;
    }

    // Terminal-specific fallback newline detection (global hook tier).
    if (shouldInsertNewlineFallbackFromKeyEvent(event)) {
      state.value += "\n";
      return;
    }

    // Standard newline detection (OpenTUI textarea keyBindings tier).
    // In the real app, shift+enter / meta+enter / Ctrl+J are handled by the
    // textarea's keyBindings prop rather than the global hook.
    if (shouldInsertNewlineFromKeyEvent(event)) {
      state.value += "\n";
      return;
    }

    if (event.name !== "return") {
      return;
    }

    // Model autocomplete Enter handler: execute command if autocomplete is
    // visible UNLESS backslash line continuation applies (mirrors chat.tsx).
    if (
      !event.shift && !event.meta
      && state.autocompleteVisible
      && !shouldApplyBackslashLineContinuation(state.value, state.kittyKeyboardDetected)
    ) {
      state.executedCommands.push(state.value);
      state.value = "";
      state.autocompleteVisible = false;
      return;
    }

    if (shouldApplyBackslashLineContinuation(state.value, state.kittyKeyboardDetected)) {
      state.value = state.value.slice(0, -1) + "\n";
      return;
    }

    if (!state.value.trim()) {
      return;
    }

    state.submitted.push(state.value);
    state.value = "";
  };

  const typeText = (text: string): void => {
    state.value += text;
    // Simulate autocomplete showing when typing a slash or @ command prefix
    const trimmed = state.value.trimStart();
    state.autocompleteVisible = trimmed.startsWith("/") || trimmed.includes("@");
  };

  return {
    get value() {
      return state.value;
    },
    get submitted() {
      return state.submitted;
    },
    get enqueued() {
      return state.enqueued;
    },
    get executedCommands() {
      return state.executedCommands;
    },
    get kittyKeyboardDetected() {
      return state.kittyKeyboardDetected;
    },
    get autocompleteVisible() {
      return state.autocompleteVisible;
    },
    get isStreaming() {
      return state.isStreaming;
    },
    typeText,
    pressKey,
  };
}

describe("Shift+Enter repeated newline regression E2E", () => {
  test("Shift+Enter fallback still inserts newline after backspace, and Enter submits", () => {
    const input = createInputHarness();

    input.typeText("first line");

    input.typeText("\\");
    input.pressKey({ name: "return", raw: "\r" });
    expect(input.value).toBe("first line\n");
    expect(input.submitted).toHaveLength(0);

    input.pressKey({ name: "backspace", raw: "\x1b[127u" });
    expect(input.value).toBe("first line");
    expect(input.kittyKeyboardDetected).toBe(false);

    input.typeText("\\");
    input.pressKey({ name: "return", raw: "\r" });
    expect(input.value).toBe("first line\n");
    expect(input.submitted).toHaveLength(0);

    input.typeText("second line");
    input.pressKey({ name: "return", raw: "\r" });
    expect(input.submitted).toEqual(["first line\nsecond line"]);
    expect(input.value).toBe("");

    input.typeText("ctrl-j");
    input.pressKey({ name: "linefeed", ctrl: false, shift: false, meta: false, raw: "\n" });
    expect(input.value).toBe("ctrl-j\n");
    expect(input.submitted).toEqual(["first line\nsecond line"]);
  });

  test("Shift+Enter inserts newline for slash command without trailing space (non-Kitty)", () => {
    const input = createInputHarness();

    // Type a slash command without a trailing space — autocomplete is visible
    input.typeText("/help");
    expect(input.autocompleteVisible).toBe(true);

    // Shift+Enter in non-Kitty terminal: "\" then "\r"
    input.typeText("\\");
    input.pressKey({ name: "return", raw: "\r" });

    // Should insert newline, NOT execute the autocomplete command
    expect(input.executedCommands).toHaveLength(0);
    expect(input.submitted).toHaveLength(0);
    expect(input.value).toBe("/help\n");
  });

  test("Shift+Enter inserts newline for @mention without trailing space (non-Kitty)", () => {
    const input = createInputHarness();

    // Type an @mention without a trailing space — autocomplete is visible
    input.typeText("tell me about @file.ts");
    expect(input.autocompleteVisible).toBe(true);

    // Shift+Enter in non-Kitty terminal: "\" then "\r"
    input.typeText("\\");
    input.pressKey({ name: "return", raw: "\r" });

    // Should insert newline, NOT execute the autocomplete command
    expect(input.executedCommands).toHaveLength(0);
    expect(input.submitted).toHaveLength(0);
    expect(input.value).toBe("tell me about @file.ts\n");
  });

  test("Enter without backslash still executes autocomplete command", () => {
    const input = createInputHarness();

    // Type a slash command — autocomplete is visible
    input.typeText("/help");
    expect(input.autocompleteVisible).toBe(true);

    // Plain Enter should execute autocomplete (no backslash present)
    input.pressKey({ name: "return", raw: "\r" });

    expect(input.executedCommands).toEqual(["/help"]);
    expect(input.submitted).toHaveLength(0);
    expect(input.value).toBe("");
  });

  test("Cmd+Shift+Enter enqueues while streaming on macOS", () => {
    const input = createInputHarness({ platform: "darwin", isStreaming: true });

    input.typeText("queued from mac");
    input.pressKey({ name: "return", shift: true, meta: true, raw: "\r" });

    expect(input.enqueued).toEqual(["queued from mac"]);
    expect(input.submitted).toHaveLength(0);
    expect(input.value).toBe("");
  });

  test("Ctrl+Shift+Enter enqueues while streaming on Linux/Windows", () => {
    const input = createInputHarness({ platform: "linux", isStreaming: true });

    input.typeText("queued from ctrl");
    input.pressKey({ name: "return", shift: true, ctrl: true, raw: "\r" });

    expect(input.enqueued).toEqual(["queued from ctrl"]);
    expect(input.submitted).toHaveLength(0);
    expect(input.value).toBe("");
  });

  test("Cmd/Ctrl+Shift+Enter enqueues even when not streaming", () => {
    const macInput = createInputHarness({ platform: "darwin", isStreaming: false });
    macInput.typeText("mac line");
    macInput.pressKey({ name: "return", shift: true, meta: true, raw: "\r" });
    expect(macInput.enqueued).toEqual(["mac line"]);
    expect(macInput.value).toBe("");

    const linuxInput = createInputHarness({ platform: "linux", isStreaming: false });
    linuxInput.typeText("linux line");
    linuxInput.pressKey({ name: "return", shift: true, ctrl: true, raw: "\r" });
    expect(linuxInput.enqueued).toEqual(["linux line"]);
    expect(linuxInput.value).toBe("");
  });
});
