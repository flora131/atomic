import { describe, it, expect, beforeEach } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeToolState } from "@/services/events/adapters/providers/claude/tool-state.ts";

function createToolState(): ClaudeToolState {
  const bus = new EventBus();
  return new ClaudeToolState(
    bus,
    "test-session",
    () => null,
    () => "",
  );
}

describe("ClaudeToolState", () => {
  let toolState: ClaudeToolState;

  beforeEach(() => {
    toolState = createToolState();
  });

  describe("hasActiveBackgroundAgents", () => {
    it("should return false when no agents are tracked", () => {
      expect(toolState.hasActiveBackgroundAgents()).toBe(false);
    });

    it("should return false when only foreground agents are active", () => {
      toolState.activeSubagentIds.add("agent-1");
      toolState.activeSubagentBackgroundById.set("agent-1", false);

      toolState.activeSubagentIds.add("agent-2");
      toolState.activeSubagentBackgroundById.set("agent-2", false);

      expect(toolState.hasActiveBackgroundAgents()).toBe(false);
    });

    it("should return true when a background agent is active", () => {
      toolState.activeSubagentIds.add("agent-1");
      toolState.activeSubagentBackgroundById.set("agent-1", true);

      expect(toolState.hasActiveBackgroundAgents()).toBe(true);
    });

    it("should return true when mixed foreground and background agents exist", () => {
      toolState.activeSubagentIds.add("fg-agent");
      toolState.activeSubagentBackgroundById.set("fg-agent", false);

      toolState.activeSubagentIds.add("bg-agent");
      toolState.activeSubagentBackgroundById.set("bg-agent", true);

      expect(toolState.hasActiveBackgroundAgents()).toBe(true);
    });

    it("should return false after reset clears all agents", () => {
      toolState.activeSubagentIds.add("bg-agent");
      toolState.activeSubagentBackgroundById.set("bg-agent", true);

      expect(toolState.hasActiveBackgroundAgents()).toBe(true);

      toolState.reset();

      expect(toolState.hasActiveBackgroundAgents()).toBe(false);
    });
  });
});
