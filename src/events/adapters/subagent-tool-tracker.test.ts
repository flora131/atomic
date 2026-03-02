/**
 * Unit tests for SubagentToolTracker
 *
 * Tests verify that the tracker correctly:
 * 1. Registers and tracks sub-agents
 * 2. Publishes stream.agent.update on tool start/complete
 * 3. Increments tool counts correctly
 * 4. Handles unregistered agents gracefully
 * 5. Cleans up on removeAgent and reset
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { EventBus } from "../event-bus.ts";
import { SubagentToolTracker } from "./subagent-tool-tracker.ts";
import type { BusEvent, BusEventDataMap } from "../bus-events.ts";

describe("SubagentToolTracker", () => {
  let bus: EventBus;
  let tracker: SubagentToolTracker;
  let publishedEvents: BusEvent<"stream.agent.update">[];

  beforeEach(() => {
    bus = new EventBus();
    publishedEvents = [];
    bus.on("stream.agent.update", (event) => {
      publishedEvents.push(event);
    });
    tracker = new SubagentToolTracker(bus, "session-1", 1);
  });

  describe("registerAgent", () => {
    it("should register a new agent", () => {
      tracker.registerAgent("agent-1");
      expect(tracker.hasAgent("agent-1")).toBe(true);
    });

    it("should not overwrite existing agent state on re-register", () => {
      tracker.registerAgent("agent-1");
      tracker.onToolStart("agent-1", "bash");
      tracker.registerAgent("agent-1"); // re-register
      tracker.onToolStart("agent-1", "read");

      // Should have tool count of 2, not reset to 1
      expect(publishedEvents).toHaveLength(2);
      expect(publishedEvents[1]!.data.toolUses).toBe(2);
    });
  });

  describe("hasAgent", () => {
    it("should return false for unregistered agents", () => {
      expect(tracker.hasAgent("unknown")).toBe(false);
    });

    it("should return true for registered agents", () => {
      tracker.registerAgent("agent-1");
      expect(tracker.hasAgent("agent-1")).toBe(true);
    });
  });

  describe("onToolStart", () => {
    it("should publish stream.agent.update with tool name and count", () => {
      tracker.registerAgent("agent-1");
      tracker.onToolStart("agent-1", "bash");

      expect(publishedEvents).toHaveLength(1);
      const event = publishedEvents[0]!;
      expect(event.type).toBe("stream.agent.update");
      expect(event.sessionId).toBe("session-1");
      expect(event.runId).toBe(1);
      expect(event.data.agentId).toBe("agent-1");
      expect(event.data.currentTool).toBe("bash");
      expect(event.data.toolUses).toBe(1);
    });

    it("should increment tool count across multiple calls", () => {
      tracker.registerAgent("agent-1");
      tracker.onToolStart("agent-1", "bash");
      tracker.onToolStart("agent-1", "read");
      tracker.onToolStart("agent-1", "grep");

      expect(publishedEvents).toHaveLength(3);
      expect(publishedEvents[0]!.data.toolUses).toBe(1);
      expect(publishedEvents[1]!.data.toolUses).toBe(2);
      expect(publishedEvents[2]!.data.toolUses).toBe(3);
      expect(publishedEvents[2]!.data.currentTool).toBe("grep");
    });

    it("should not publish for unregistered agents", () => {
      tracker.onToolStart("unknown", "bash");
      expect(publishedEvents).toHaveLength(0);
    });
  });

  describe("onToolComplete", () => {
    it("should clear currentTool and publish update", () => {
      tracker.registerAgent("agent-1");
      tracker.onToolStart("agent-1", "bash");
      tracker.onToolComplete("agent-1");

      expect(publishedEvents).toHaveLength(2);
      const completeEvent = publishedEvents[1]!;
      expect(completeEvent.data.currentTool).toBeUndefined();
      expect(completeEvent.data.toolUses).toBe(1); // count stays the same
    });

    it("should not publish for unregistered agents", () => {
      tracker.onToolComplete("unknown");
      expect(publishedEvents).toHaveLength(0);
    });
  });

  describe("removeAgent", () => {
    it("should remove agent from tracking", () => {
      tracker.registerAgent("agent-1");
      tracker.removeAgent("agent-1");
      expect(tracker.hasAgent("agent-1")).toBe(false);
    });

    it("should stop publishing events for removed agent", () => {
      tracker.registerAgent("agent-1");
      tracker.removeAgent("agent-1");
      tracker.onToolStart("agent-1", "bash");
      expect(publishedEvents).toHaveLength(0);
    });
  });

  describe("reset", () => {
    it("should clear all tracked agents", () => {
      tracker.registerAgent("agent-1");
      tracker.registerAgent("agent-2");
      tracker.reset();
      expect(tracker.hasAgent("agent-1")).toBe(false);
      expect(tracker.hasAgent("agent-2")).toBe(false);
    });
  });

  describe("multi-agent tracking", () => {
    it("should track tool counts independently per agent", () => {
      tracker.registerAgent("agent-1");
      tracker.registerAgent("agent-2");

      tracker.onToolStart("agent-1", "bash");
      tracker.onToolStart("agent-2", "read");
      tracker.onToolStart("agent-1", "write");

      // agent-1 events: 2 tool starts
      const agent1Events = publishedEvents.filter(
        (e) => e.data.agentId === "agent-1",
      );
      expect(agent1Events).toHaveLength(2);
      expect(agent1Events[0]!.data.toolUses).toBe(1);
      expect(agent1Events[1]!.data.toolUses).toBe(2);

      // agent-2 events: 1 tool start
      const agent2Events = publishedEvents.filter(
        (e) => e.data.agentId === "agent-2",
      );
      expect(agent2Events).toHaveLength(1);
      expect(agent2Events[0]!.data.toolUses).toBe(1);
    });
  });
});
