// @ts-nocheck
import { mock } from "bun:test";
import type {
  AgentEvent,
  AgentMessage,
  CodingAgentClient,
  EventType,
  Session,
} from "@/services/agents/types.ts";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { EventBus } from "@/services/events/event-bus.ts";

export type MockCodingAgentClient = CodingAgentClient & {
  emit: (type: EventType, event: AgentEvent) => void;
};

export async function* mockAsyncStream(
  chunks: AgentMessage[],
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export function createMockClient(): MockCodingAgentClient {
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
  } as MockCodingAgentClient;

  return client;
}

export function createMockSession(
  stream: AsyncGenerator<AgentMessage>,
  client?: Partial<CodingAgentClient>,
): Session {
  return {
    id: "test-session-123",
    stream: mock(() => stream),
    __client: client ?? createMockClient(),
  } as unknown as Session;
}

export function createIntegrationBusHarness(): {
  bus: EventBus;
  dispatcher: BatchDispatcher;
} {
  const bus = new EventBus();
  const dispatcher = new BatchDispatcher(bus);
  return { bus, dispatcher };
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function waitForBatchFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
