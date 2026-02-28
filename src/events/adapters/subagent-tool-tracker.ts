/**
 * SubagentToolTracker
 *
 * Shared utility used by SDK stream adapters to track sub-agent tool usage
 * and emit `stream.agent.update` bus events. Each adapter is responsible for
 * mapping its SDK-specific parent correlation ID to a resolved agentId before
 * calling the tracker methods.
 *
 * Usage:
 * ```typescript
 * const tracker = new SubagentToolTracker(bus, sessionId, runId);
 * tracker.registerAgent("agent-123");
 * tracker.onToolStart("agent-123", "bash");     // emits stream.agent.update
 * tracker.onToolComplete("agent-123");           // emits stream.agent.update
 * tracker.removeAgent("agent-123");
 * tracker.reset();                               // clear all state
 * ```
 */

import type { EventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";

interface AgentToolState {
  toolCount: number;
  currentTool?: string;
}

export class SubagentToolTracker {
  private agents = new Map<string, AgentToolState>();
  private bus: EventBus;
  private sessionId: string;
  private runId: number;

  constructor(bus: EventBus, sessionId: string, runId: number) {
    this.bus = bus;
    this.sessionId = sessionId;
    this.runId = runId;
  }

  /**
   * Register a new sub-agent for tracking.
   */
  registerAgent(agentId: string): void {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, { toolCount: 0 });
    }
  }

  /**
   * Returns true if the given agentId is registered.
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Record a tool start for a sub-agent. Increments the tool count
   * and publishes a `stream.agent.update` event.
   */
  onToolStart(agentId: string, toolName: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.toolCount += 1;
    state.currentTool = toolName;
    this.publishUpdate(agentId, state);
  }

  /**
   * Record a tool completion for a sub-agent. Clears the current tool
   * and publishes a `stream.agent.update` event.
   */
  onToolComplete(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.currentTool = undefined;
    this.publishUpdate(agentId, state);
  }

  /**
   * Remove a sub-agent from tracking (e.g., on completion).
   */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * Clear all tracked agents and reset state.
   */
  reset(): void {
    this.agents.clear();
  }

  private publishUpdate(agentId: string, state: AgentToolState): void {
    const event: BusEvent<"stream.agent.update"> = {
      type: "stream.agent.update",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId,
        currentTool: state.currentTool,
        toolUses: state.toolCount,
      },
    };
    this.bus.publish(event);
  }
}
