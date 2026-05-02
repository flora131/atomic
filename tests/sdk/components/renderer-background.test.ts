import { test, expect, describe } from "bun:test";
import {
  terminalBackgroundColorSequence,
  wrapForTmuxIfNeeded,
} from "../../../src/sdk/components/renderer-background.ts";

describe("terminalBackgroundColorSequence", () => {
  test("formats OSC 11 background sync for hex colors", () => {
    expect(terminalBackgroundColorSequence("#1e1e2e")).toBe("\x1b]11;rgb:1e/1e/2e\x07");
  });

  test("accepts hex colors without a leading hash", () => {
    expect(terminalBackgroundColorSequence("eff1f5")).toBe("\x1b]11;rgb:ef/f1/f5\x07");
  });

  test("rejects non-hex colors", () => {
    expect(() => terminalBackgroundColorSequence("transparent")).toThrow("Cannot sync terminal background");
  });
});

describe("wrapForTmuxIfNeeded", () => {
  test("returns raw sequence outside tmux", () => {
    const previousTmux = process.env.TMUX;
    delete process.env.TMUX;
    try {
      expect(wrapForTmuxIfNeeded("\x1b]11;rgb:1e/1e/2e\x07")).toBe("\x1b]11;rgb:1e/1e/2e\x07");
    } finally {
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
    }
  });

  test("wraps OSC sequences for tmux passthrough", () => {
    const previousTmux = process.env.TMUX;
    process.env.TMUX = "/tmp/tmux-test";
    try {
      expect(wrapForTmuxIfNeeded("\x1b]11;rgb:1e/1e/2e\x07")).toBe("\x1bPtmux;\x1b\x1b]11;rgb:1e/1e/2e\x07\x1b\\");
    } finally {
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
    }
  });
});
