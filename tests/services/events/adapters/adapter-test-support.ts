// @ts-nocheck

import { mock } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import type {
  Session,
  AgentMessage,
  AgentEvent,
  EventType,
  CodingAgentClient,
} from "@/services/agents/types.ts";

export async function* mockAsyncStream(
  chunks: AgentMessage[],
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export function createMockSession(
  stream: AsyncGenerator<AgentMessage>,
  client?: Partial<CodingAgentClient>,
): Session {
  const session = {
    id: "test-session-123",
    stream: mock(() => stream),
    __client: client ?? createMockClient(),
  } as unknown as Session;
  return session;
}

export function createMockClient(): CodingAgentClient {
  const handlers = new Map<EventType, Set<(event: AgentEvent) => void>>();
  const providerHandlers = new Set<(event: AgentEvent & { provider: string }) => void>();

  const client = {
    on: mock((type: EventType, handler: (event: AgentEvent) => void) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    }),
    onProviderEvent: mock((handler: (event: AgentEvent & { provider: string }) => void) => {
      providerHandlers.add(handler);
      return () => {
        providerHandlers.delete(handler);
      };
    }),
    emit: (type: EventType, event: AgentEvent) => {
      const set = handlers.get(type);
      if (set) {
        for (const handler of set) {
          handler(event);
        }
      }

      const providerEvent = {
        provider: "mock",
        ...event,
        type,
      };
      for (const handler of providerHandlers) {
        handler(providerEvent);
      }
    },
  } as unknown as CodingAgentClient;

  return client;
}

export function collectEvents(bus: EventBus): BusEvent[] {
  const events: BusEvent[] = [];
  bus.onAll((event) => {
    events.push(event);
  });
  return events;
}
