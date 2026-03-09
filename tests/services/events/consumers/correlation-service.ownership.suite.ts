import { beforeEach, describe, expect, test } from "bun:test";
import { CorrelationService } from "@/services/events/consumers/correlation-service.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("CorrelationService", () => {
  let service: CorrelationService;

  beforeEach(() => {
    service = new CorrelationService();
  });

  test("startRun() sets activeRunId and ownedSessionIds", () => {
    service.startRun(42, "session-abc");
    expect(service.activeRunId).toBe(42);
  });

  test("startRun() resets previous state", () => {
    service.registerTool("tool-1", "agent-1");
    service.startRun(1, "session-1");

    const enriched = service.enrich({
      type: "stream.tool.complete",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: { toolId: "tool-1", toolName: "test", toolResult: "", success: true },
    } satisfies BusEvent<"stream.tool.complete">);
    expect(enriched.resolvedAgentId).toBeUndefined();
  });

  test("isOwnedEvent() returns true for matching runId", () => {
    service.startRun(5, "session-x");
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-other",
      runId: 5,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(true);
  });

  test("isOwnedEvent() returns true for owned sessionId", () => {
    service.startRun(5, "session-x");
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-x",
      runId: 999,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(true);
  });

  test("isOwnedEvent() returns false for unrelated event", () => {
    service.startRun(5, "session-x");
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-other",
      runId: 99,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(false);
  });

  test("activeRunId is null initially", () => {
    expect(service.activeRunId).toBeNull();
  });

  test("reset() clears run ownership state", () => {
    service.startRun(10, "session-owned");
    service.reset();
    expect(service.activeRunId).toBeNull();

    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-owned",
      runId: 10,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(false);
  });
});
