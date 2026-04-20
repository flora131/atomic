import { test, expect, describe } from "bun:test";
import { shouldForward, QUIET_MS } from "../../../src/sdk/runtime/cc-debounce.ts";

describe("shouldForward", () => {
  test("forwards the first press (last=0, no prior state)", () => {
    expect(shouldForward(1_000_000, 0)).toBe(true);
  });

  test("swallows a second press inside the quiet window", () => {
    const now = 1_000_000;
    expect(shouldForward(now, now - 100)).toBe(false);
    expect(shouldForward(now, now - (QUIET_MS - 1))).toBe(false);
  });

  test("swallows a press exactly at the window boundary (>, not >=)", () => {
    const now = 1_000_000;
    expect(shouldForward(now, now - QUIET_MS)).toBe(false);
  });

  test("forwards a press one ms past the quiet window", () => {
    const now = 1_000_000;
    expect(shouldForward(now, now - QUIET_MS - 1)).toBe(true);
  });

  test("accepts a custom quiet window", () => {
    expect(shouldForward(500, 0, 300)).toBe(true);
    expect(shouldForward(200, 0, 300)).toBe(false);
  });

  test("sustained spam: rapid presses keep swallowing", () => {
    // Simulate 20 presses spaced 80ms apart — only the first forwards
    // because the state file is bumped on every press (emulated here by
    // walking `last` forward on each iteration, forwarded or not).
    const BASE = 1_700_000_000_000; // realistic wall-clock ms
    let last = 0; // empty state file on the very first press
    let forwards = 0;
    for (let i = 0; i < 20; i++) {
      const now = BASE + i * 80;
      if (shouldForward(now, last)) forwards++;
      last = now; // caller always writes the new timestamp
    }
    expect(forwards).toBe(1);
  });

  test("quiet-then-press: one forward per burst", () => {
    const BASE = 1_700_000_000_000;
    let last = 0;
    let forwards = 0;
    // Burst 1 — 5 rapid presses.
    for (let i = 0; i < 5; i++) {
      const now = BASE + i * 80;
      if (shouldForward(now, last)) forwards++;
      last = now;
    }
    // 2 seconds of quiet, then another burst.
    for (let i = 0; i < 5; i++) {
      const now = BASE + 2_500 + i * 80;
      if (shouldForward(now, last)) forwards++;
      last = now;
    }
    expect(forwards).toBe(2);
  });
});
