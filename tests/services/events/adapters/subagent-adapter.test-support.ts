import { EventBus } from "@/services/events/event-bus.ts";
import { SubagentStreamAdapter } from "@/services/events/adapters/subagent-adapter.ts";
import type { BusEvent, BusEventType } from "@/services/events/bus-events.ts";
import type { AgentMessage } from "@/services/agents/types.ts";

export const SESSION_ID = "parent-session-123";
export const AGENT_ID = "worker-1";
export const RUN_ID = 42;

export async function* mockStream(
  chunks: AgentMessage[],
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export async function* errorStream(
  chunks: AgentMessage[],
  error: Error,
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
  throw error;
}

function collectEvents(bus: EventBus): BusEvent[] {
  const events: BusEvent[] = [];
  bus.onAll((event) => events.push(event));
  return events;
}

export function filterByType<T extends BusEventType>(
  events: BusEvent[],
  type: T,
): BusEvent<T>[] {
  return events.filter((e) => e.type === type) as BusEvent<T>[];
}

export function createHarness() {
  const bus = new EventBus();
  const events = collectEvents(bus);

  function createAdapter(overrides?: {
    parentAgentId?: string;
  }): SubagentStreamAdapter {
    return new SubagentStreamAdapter({
      bus,
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
      runId: RUN_ID,
      parentAgentId: overrides?.parentAgentId,
    });
  }

  function createAdapterWithAgentType(overrides?: {
    parentAgentId?: string;
    agentType?: string;
    task?: string;
    isBackground?: boolean;
  }): SubagentStreamAdapter {
    return new SubagentStreamAdapter({
      bus,
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
      runId: RUN_ID,
      parentAgentId: overrides?.parentAgentId,
      agentType: overrides?.agentType,
      task: overrides?.task,
      isBackground: overrides?.isBackground,
    });
  }

  return {
    bus,
    events,
    createAdapter,
    createAdapterWithAgentType,
  };
}
