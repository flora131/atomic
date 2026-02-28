/**
 * Workflow Event Adapter
 *
 * Producer-side adapter that bridges workflow execution events to the event bus.
 * Unlike SDK adapters (which consume streams), this adapter provides methods that
 * workflow executors call to publish events.
 *
 * Key responsibilities:
 * - Publish workflow step lifecycle events (start, complete)
 * - Publish workflow task list updates
 * - Publish sub-agent lifecycle events (start, update)
 * - Create properly typed BusEvent instances with metadata
 *
 * Usage:
 * ```typescript
 * const adapter = new WorkflowEventAdapter(eventBus, sessionId, runId);
 * adapter.publishStepStart(workflowId, "analyze-code", 1);
 * adapter.publishStepComplete(workflowId, "analyze-code", 1, { status: "success" });
 * ```
 */

import type { EventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";

/**
 * Workflow Event Adapter for publishing workflow execution events to the event bus.
 *
 * This is a producer-side adapter — workflows call these methods to publish events
 * onto the bus, which can then be consumed by UI components and other subscribers.
 */
export class WorkflowEventAdapter {
  private bus: EventBus;
  private sessionId: string;
  private runId: number;

  /**
   * Create a new workflow event adapter.
   *
   * @param bus - The event bus to publish events to
   * @param sessionId - Session ID for this workflow execution
   * @param runId - Run ID for staleness detection
   */
  constructor(bus: EventBus, sessionId: string, runId: number) {
    this.bus = bus;
    this.sessionId = sessionId;
    this.runId = runId;
  }

  /**
   * Publish a workflow step start event.
   *
   * @param workflowId - Workflow instance ID
   * @param stepName - Human-readable step/node name
   * @param nodeId - Node ID within the workflow graph
   */
  publishStepStart(workflowId: string, stepName: string, nodeId: string): void {
    const event: BusEvent<"workflow.step.start"> = {
      type: "workflow.step.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        workflowId,
        nodeId,
        nodeName: stepName,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a workflow step complete event.
   *
   * @param workflowId - Workflow instance ID
   * @param stepName - Human-readable step/node name (currently unused in event data, but kept for API consistency)
   * @param nodeId - Node ID that completed
   * @param status - Completion status
   * @param result - Optional result data from the step
   */
  publishStepComplete(
    workflowId: string,
    stepName: string,
    nodeId: string,
    status: "success" | "error" | "skipped" = "success",
    result?: unknown,
  ): void {
    const event: BusEvent<"workflow.step.complete"> = {
      type: "workflow.step.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        workflowId,
        nodeId,
        status,
        result,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a workflow task list update event.
   *
   * @param workflowId - Workflow instance ID
   * @param tasks - Updated task list with id/title/status and optional dependencies
   */
  publishTaskUpdate(
    workflowId: string,
    tasks: Array<{ id: string; title: string; status: string; blockedBy?: string[] }>,
  ): void {
    const event: BusEvent<"workflow.task.update"> = {
      type: "workflow.task.update",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        workflowId,
        tasks,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a sub-agent start event.
   *
   * @param agentId - Unique agent ID
   * @param agentType - Type of agent (e.g., "explore", "task", "general-purpose")
   * @param task - Task description given to the agent
   * @param isBackground - Whether the agent is running in background mode
   */
  publishAgentStart(
    agentId: string,
    agentType: string,
    task: string,
    isBackground: boolean = false,
  ): void {
    const event: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId,
        agentType,
        task,
        isBackground,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a sub-agent status update event.
   *
   * @param agentId - Agent ID being updated
   * @param currentTool - Current tool being used by the agent (optional)
   * @param toolUses - Number of tool uses so far (optional)
   */
  publishAgentUpdate(
    agentId: string,
    currentTool?: string,
    toolUses?: number,
  ): void {
    const event: BusEvent<"stream.agent.update"> = {
      type: "stream.agent.update",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId,
        currentTool,
        toolUses,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a sub-agent complete event.
   *
   * @param agentId - Agent ID that completed
   * @param success - Whether the agent succeeded
   * @param result - Result summary returned by the agent (optional)
   * @param error - Error message if agent execution failed (optional)
   */
  publishAgentComplete(
    agentId: string,
    success: boolean,
    result?: string,
    error?: string,
  ): void {
    const event: BusEvent<"stream.agent.complete"> = {
      type: "stream.agent.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId,
        success,
        result,
        error,
      },
    };

    this.bus.publish(event);
  }
}
