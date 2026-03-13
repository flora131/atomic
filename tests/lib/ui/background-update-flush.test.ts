import { describe, expect, test } from "bun:test";

import {
  shouldScheduleBackgroundUpdateFollowUpFlush,
  shouldStartBackgroundUpdateFlush,
} from "@/lib/ui/background-update-flush.ts";

describe("shouldStartBackgroundUpdateFlush", () => {
  test("returns true when idle with pending updates", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isAgentOnlyStream: false,
      isStreaming: false,
      pendingUpdateCount: 2,
    })).toBe(true);
  });

  test("returns false when a flush is already in flight", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: true,
      isAgentOnlyStream: false,
      isStreaming: false,
      pendingUpdateCount: 2,
    })).toBe(false);
  });

  test("returns false while streaming", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isAgentOnlyStream: false,
      isStreaming: true,
      pendingUpdateCount: 2,
    })).toBe(false);
  });

  test("returns false when queue is empty", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isAgentOnlyStream: false,
      isStreaming: false,
      pendingUpdateCount: 0,
    })).toBe(false);
  });

  test("returns true when streaming with isAgentOnlyStream bypass", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isAgentOnlyStream: true,
      isStreaming: true,
      pendingUpdateCount: 2,
    })).toBe(true);
  });

  test("returns false when isAgentOnlyStream bypass active but flush in flight", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: true,
      isAgentOnlyStream: true,
      isStreaming: true,
      pendingUpdateCount: 2,
    })).toBe(false);
  });

  test("returns true when isAgentOnlyStream is set but not streaming", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isAgentOnlyStream: true,
      isStreaming: false,
      pendingUpdateCount: 3,
    })).toBe(true);
  });

  test("returns false when isAgentOnlyStream bypass active but queue is empty", () => {
    expect(shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: false,
      isAgentOnlyStream: true,
      isStreaming: true,
      pendingUpdateCount: 0,
    })).toBe(false);
  });
});

describe("shouldScheduleBackgroundUpdateFollowUpFlush", () => {
  test("returns true after a successful send with remaining queued updates", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: false,
      sendSucceeded: true,
      isStreaming: false,
      pendingUpdateCount: 1,
    })).toBe(true);
  });

  test("returns false after failed send", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: false,
      sendSucceeded: false,
      isStreaming: false,
      pendingUpdateCount: 1,
    })).toBe(false);
  });

  test("returns false while streaming", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: false,
      sendSucceeded: true,
      isStreaming: true,
      pendingUpdateCount: 1,
    })).toBe(false);
  });

  test("returns false when no queued updates remain", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: false,
      sendSucceeded: true,
      isStreaming: false,
      pendingUpdateCount: 0,
    })).toBe(false);
  });

  test("returns true when streaming with isAgentOnlyStream bypass", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: true,
      sendSucceeded: true,
      isStreaming: true,
      pendingUpdateCount: 1,
    })).toBe(true);
  });

  test("returns false when isAgentOnlyStream bypass active but send failed", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: true,
      sendSucceeded: false,
      isStreaming: true,
      pendingUpdateCount: 1,
    })).toBe(false);
  });

  test("returns true when isAgentOnlyStream is set but not streaming", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: true,
      sendSucceeded: true,
      isStreaming: false,
      pendingUpdateCount: 2,
    })).toBe(true);
  });

  test("returns false when isAgentOnlyStream bypass active but queue is empty", () => {
    expect(shouldScheduleBackgroundUpdateFollowUpFlush({
      isAgentOnlyStream: true,
      sendSucceeded: true,
      isStreaming: true,
      pendingUpdateCount: 0,
    })).toBe(false);
  });
});
