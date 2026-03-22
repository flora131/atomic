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

import type { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import { toolDebug } from "@/services/events/adapters/providers/claude/tool-debug-log.ts";

interface AgentToolState {
  toolCount: number;
  currentTool?: string;
  isBackground: boolean;
}

export interface RegisterAgentOptions {
  isBackground?: boolean;
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
  registerAgent(agentId: string, options?: RegisterAgentOptions): void {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        toolCount: 0,
        isBackground: options?.isBackground ?? false,
      });
    }
  }

  /**
   * Returns true if the given agentId is registered.
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Returns true if the given agent is tracked and marked as a background agent.
   */
  isAgentBackground(agentId: string): boolean {
    return this.agents.get(agentId)?.isBackground ?? false;
  }

  /**
   * Returns true if any currently tracked agent is marked as a background agent.
   */
  hasActiveBackgroundAgents(): boolean {
    for (const state of this.agents.values()) {
      if (state.isBackground) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the number of currently tracked agents marked as background agents.
   */
  getActiveBackgroundAgentCount(): number {
    let count = 0;
    for (const state of this.agents.values()) {
      if (state.isBackground) {
        count += 1;
      }
    }
    return count;
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
    toolDebug("tracker:onToolStart", { agentId, toolName, newCount: state.toolCount });
    this.publishUpdate(agentId, state);
  }

  /**
   * Record a tool completion for a sub-agent. Clears the current tool
   * and publishes a `stream.agent.update` event.
   */
  onToolComplete(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    toolDebug("tracker:onToolComplete", { agentId, toolCount: state.toolCount });
    state.currentTool = undefined;
    this.publishUpdate(agentId, state);
  }

  /**
   * Record in-flight progress for the current tool without incrementing
   * the tool count. Useful for streaming partial tool output.
   */
  onToolProgress(agentId: string, toolName?: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    if (toolName) {
      state.currentTool = toolName;
    }
    this.publishUpdate(agentId, state);
  }

  /**
   * Remove a sub-agent from tracking (e.g., on completion).
   */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * Move tracked progress from one agent ID to another.
   * Useful when a synthetic foreground placeholder is replaced by the
   * SDK's real sub-agent ID mid-stream.
   */
  transferAgent(fromAgentId: string, toAgentId: string): void {
    if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) {
      return;
    }

    const fromState = this.agents.get(fromAgentId);
    if (!fromState) {
      return;
    }

    const toState = this.agents.get(toAgentId);
    const mergedState: AgentToolState = {
      toolCount: Math.max(fromState.toolCount, toState?.toolCount ?? 0),
      currentTool: fromState.currentTool ?? toState?.currentTool,
      isBackground: fromState.isBackground || (toState?.isBackground ?? false),
    };

    toolDebug("tracker:transferAgent", {
      fromAgentId,
      toAgentId,
      fromToolCount: fromState.toolCount,
      toToolCount: toState?.toolCount ?? 0,
      mergedToolCount: mergedState.toolCount,
    });

    this.agents.set(toAgentId, mergedState);
    this.agents.delete(fromAgentId);
    this.publishUpdate(toAgentId, mergedState);
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
