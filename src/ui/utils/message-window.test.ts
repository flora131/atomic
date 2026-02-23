import { describe, expect, test } from "bun:test";
import { shouldCollapseMessage } from "./message-window.ts";

describe("shouldCollapseMessage", () => {
  test("last N messages are expanded, earlier ones collapsed", () => {
    // 10 messages, expandedCount=4 → indices 0-5 collapsed, 6-9 expanded
    expect(shouldCollapseMessage(0, 10, 4, false)).toBe(true);
    expect(shouldCollapseMessage(5, 10, 4, false)).toBe(true);
    expect(shouldCollapseMessage(6, 10, 4, false)).toBe(false);
    expect(shouldCollapseMessage(9, 10, 4, false)).toBe(false);
  });

  test("fewer messages than expanded count means all expanded", () => {
    expect(shouldCollapseMessage(0, 3, 4, false)).toBe(false);
    expect(shouldCollapseMessage(1, 3, 4, false)).toBe(false);
    expect(shouldCollapseMessage(2, 3, 4, false)).toBe(false);
  });

  test("exactly equal to expanded count means all expanded", () => {
    expect(shouldCollapseMessage(0, 4, 4, false)).toBe(false);
    expect(shouldCollapseMessage(3, 4, 4, false)).toBe(false);
  });

  test("live messages are never collapsed regardless of position", () => {
    expect(shouldCollapseMessage(0, 10, 4, true)).toBe(false);
    expect(shouldCollapseMessage(1, 10, 4, true)).toBe(false);
  });

  test("zero messages edge case", () => {
    expect(shouldCollapseMessage(0, 0, 4, false)).toBe(false);
  });

  test("single message over expanded count is collapsed", () => {
    // 5 messages, expandedCount=4 → index 0 collapsed, 1-4 expanded
    expect(shouldCollapseMessage(0, 5, 4, false)).toBe(true);
    expect(shouldCollapseMessage(1, 5, 4, false)).toBe(false);
  });

  test("expandedCount=1 collapses all but the last", () => {
    expect(shouldCollapseMessage(0, 5, 1, false)).toBe(true);
    expect(shouldCollapseMessage(3, 5, 1, false)).toBe(true);
    expect(shouldCollapseMessage(4, 5, 1, false)).toBe(false);
  });
});
