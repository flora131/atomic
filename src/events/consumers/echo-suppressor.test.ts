/**
 * Unit tests for EchoSuppressor
 *
 * Tests the echo suppression logic that filters duplicate text echoed back
 * by SDKs when tool results are repeated in the text stream.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { EchoSuppressor } from "./echo-suppressor.ts";

describe("EchoSuppressor", () => {
  let suppressor: EchoSuppressor;

  beforeEach(() => {
    suppressor = new EchoSuppressor();
  });

  test("filterDelta() returns delta when no targets", () => {
    const delta = "Hello world";
    const result = suppressor.filterDelta(delta);

    expect(result).toBe("Hello world");
  });

  test("expectEcho() registers a target", () => {
    suppressor.expectEcho("Expected text");

    expect(suppressor.hasPendingTargets).toBe(true);
  });

  test("filterDelta() suppresses matching text", () => {
    suppressor.expectEcho("Tool result: success");

    // Send matching text in chunks
    expect(suppressor.filterDelta("Tool ")).toBe("");
    expect(suppressor.filterDelta("result: ")).toBe("");
    expect(suppressor.filterDelta("success")).toBe("");

    // After full match, no more pending targets
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("filterDelta() returns accumulated text when divergence detected", () => {
    suppressor.expectEcho("Expected text");

    // Start matching
    expect(suppressor.filterDelta("Expe")).toBe("");
    expect(suppressor.filterDelta("cted ")).toBe("");

    // Diverge
    const result = suppressor.filterDelta("something else");

    // Should return all accumulated text including the divergent part
    expect(result).toBe("Expected something else");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Multiple targets processed in FIFO order", () => {
    suppressor.expectEcho("First echo");
    suppressor.expectEcho("Second echo");

    // Process first echo
    expect(suppressor.filterDelta("First echo")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(true);

    // Process second echo
    expect(suppressor.filterDelta("Second echo")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("reset() clears all targets", () => {
    suppressor.expectEcho("Some text");
    expect(suppressor.hasPendingTargets).toBe(true);

    suppressor.reset();

    expect(suppressor.hasPendingTargets).toBe(false);

    // New deltas should pass through
    expect(suppressor.filterDelta("Any text")).toBe("Any text");
  });

  test("hasPendingTargets returns correct state", () => {
    expect(suppressor.hasPendingTargets).toBe(false);

    suppressor.expectEcho("Target text");
    expect(suppressor.hasPendingTargets).toBe(true);

    suppressor.filterDelta("Target text");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Partial match accumulates without returning", () => {
    suppressor.expectEcho("Complete match");

    // Partial matches - nothing returned
    expect(suppressor.filterDelta("Com")).toBe("");
    expect(suppressor.filterDelta("plete")).toBe("");
    expect(suppressor.filterDelta(" mat")).toBe("");

    // Still has pending target being matched
    expect(suppressor.hasPendingTargets).toBe(true);
  });

  test("Full match consumes target and moves to next", () => {
    suppressor.expectEcho("First");
    suppressor.expectEcho("Second");

    // Complete first match
    expect(suppressor.filterDelta("First")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(true);

    // Now processing second target
    expect(suppressor.filterDelta("Second")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Empty string delta returns empty string", () => {
    suppressor.expectEcho("Some target");

    expect(suppressor.filterDelta("")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(true);
  });

  test("Empty target is not registered", () => {
    suppressor.expectEcho("");
    expect(suppressor.hasPendingTargets).toBe(false);

    suppressor.expectEcho("   ");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Complex scenario: multiple targets with divergence", () => {
    suppressor.expectEcho("Echo one");
    suppressor.expectEcho("Echo two");

    // Match first target
    expect(suppressor.filterDelta("Echo one")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(true);

    // Start matching second target
    expect(suppressor.filterDelta("Echo ")).toBe("");

    // Diverge from second target
    const result = suppressor.filterDelta("three");
    expect(result).toBe("Echo three");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Single character deltas", () => {
    suppressor.expectEcho("abc");

    expect(suppressor.filterDelta("a")).toBe("");
    expect(suppressor.filterDelta("b")).toBe("");
    expect(suppressor.filterDelta("c")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Multi-line echo suppression", () => {
    const multilineResult = "Line 1\nLine 2\nLine 3";
    suppressor.expectEcho(multilineResult);

    // Send line by line
    expect(suppressor.filterDelta("Line 1\n")).toBe("");
    expect(suppressor.filterDelta("Line 2\n")).toBe("");
    expect(suppressor.filterDelta("Line 3")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Divergence with empty accumulator edge case", () => {
    suppressor.expectEcho("Expected");

    // Immediate divergence on first character
    const result = suppressor.filterDelta("Different");
    expect(result).toBe("Different");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Target consumed exactly - no overflow", () => {
    suppressor.expectEcho("exact");

    expect(suppressor.filterDelta("exact")).toBe("");
    expect(suppressor.hasPendingTargets).toBe(false);

    // Next delta should pass through (no active target)
    expect(suppressor.filterDelta(" more")).toBe(" more");
  });

  test("Multiple expectations with text between", () => {
    suppressor.expectEcho("First");

    // Match first
    expect(suppressor.filterDelta("First")).toBe("");

    // Add second target after first is consumed
    suppressor.expectEcho("Second");

    // Text that's not an echo
    expect(suppressor.filterDelta("Some other text ")).toBe("Some other text ");

    // No pending targets left after divergence
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Whitespace-only target is not registered", () => {
    suppressor.expectEcho("\t\n  ");
    expect(suppressor.hasPendingTargets).toBe(false);
  });

  test("Case-sensitive matching", () => {
    suppressor.expectEcho("Hello");

    const result = suppressor.filterDelta("hello");
    expect(result).toBe("hello");
    expect(suppressor.hasPendingTargets).toBe(false);
  });
});
