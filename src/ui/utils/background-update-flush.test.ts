import { describe, expect, test } from "bun:test";

import {
  shouldScheduleBackgroundUpdateFollowUpFlush,
  shouldStartBackgroundUpdateFlush,
} from "./background-update-flush.ts";

describe("shouldStartBackgroundUpdateFlush", () => {
  test("returns true when idle with pending updates", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isStreaming: false,
      pendingUpdateCount: 2,
    })).toBe(true);
  });

  test("returns false when a flush is already in flight", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: true,
      isStreaming: false,
      pendingUpdateCount: 2,
    })).toBe(false);
  });

  test("returns false while streaming", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isStreaming: true,
      pendingUpdateCount: 2,
    })).toBe(false);
  });

  test("returns false when queue is empty", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isStreaming: false,
      pendingUpdateCount: 0,
    })).toBe(false);
  });
});

describe("shouldScheduleBackgroundUpdateFollowUpFlush", () => {
  test("returns true after a successful send with remaining queued updates", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      sendSucceeded: true,
      isStreaming: false,
      pendingUpdateCount: 1,
    })).toBe(true);
  });

  test("returns false after failed send", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      sendSucceeded: false,
      isStreaming: false,
      pendingUpdateCount: 1,
    })).toBe(false);
  });

  test("returns false while streaming", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      sendSucceeded: true,
      isStreaming: true,
      pendingUpdateCount: 1,
    })).toBe(false);
  });

  test("returns false when no queued updates remain", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      sendSucceeded: true,
      isStreaming: false,
      pendingUpdateCount: 0,
    })).toBe(false);
  });
});
