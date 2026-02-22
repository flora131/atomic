import { describe, expect, test } from "bun:test";

import { getNextKittyKeyboardDetectionState } from "./kitty-keyboard-detection.ts";
import {
  shouldApplyBackslashLineContinuation,
  shouldInsertNewlineFromKeyEvent,
  type NewlineKeyEventLike,
} from "./newline-strategies.ts";

interface SimulatedKeyEvent extends NewlineKeyEventLike {
  raw?: string;
}

interface InputHarness {
  value: string;
  submitted: string[];
  kittyKeyboardDetected: boolean;
  typeText: (text: string) => void;
  pressKey: (event: SimulatedKeyEvent) => void;
}

function createInputHarness(): InputHarness {
  const state = {
    value: "",
    submitted: [] as string[],
    kittyKeyboardDetected: false,
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

    if (shouldInsertNewlineFromKeyEvent(event)) {
      state.value += "\n";
      return;
    }

    if (event.name !== "return") {
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
  };

  return {
    get value() {
      return state.value;
    },
    get submitted() {
      return state.submitted;
    },
    get kittyKeyboardDetected() {
      return state.kittyKeyboardDetected;
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
});
