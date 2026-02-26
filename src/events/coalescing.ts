import type { BusEvent, BusEventDataMap } from "./bus-events";

/**
 * Generate a coalescing key for an event. Events with the same key
 * within a batching window will be coalesced (only latest retained).
 * Returns undefined for events that must never be coalesced (e.g., text deltas).
 */
export function coalescingKey(event: BusEvent): string | undefined {
  switch (event.type) {
    // Text deltas are NEVER coalesced — each delta is additive
    case "stream.text.delta":
    case "stream.thinking.delta":
      return undefined;

    // Tool/agent state updates coalesce by entity ID
    case "stream.tool.start": {
      const data = event.data as BusEventDataMap["stream.tool.start"];
      return `tool.start:${data.toolId}`;
    }
    case "stream.tool.complete": {
      const data = event.data as BusEventDataMap["stream.tool.complete"];
      return `tool.complete:${data.toolId}`;
    }
    case "stream.agent.update": {
      const data = event.data as BusEventDataMap["stream.agent.update"];
      return `agent.update:${data.agentId}`;
    }
    case "stream.agent.start": {
      const data = event.data as BusEventDataMap["stream.agent.start"];
      return `agent.start:${data.agentId}`;
    }

    // Session status coalesces by session
    case "stream.session.start":
    case "stream.session.idle":
    case "stream.session.error":
      return `session:${event.sessionId}`;

    // Workflow task list coalesces per workflow
    case "workflow.task.update": {
      const data = event.data as BusEventDataMap["workflow.task.update"];
      return `workflow.tasks:${data.workflowId}`;
    }

    // Usage stats coalesce per session
    case "stream.usage":
      return `usage:${event.sessionId}`;

    default:
      return undefined;
  }
}
