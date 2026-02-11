/**
 * Unit tests for SDK telemetry integration
 *
 * Tests cover:
 * - withTelemetry wrapper
 * - Session wrapping
 * - Event type mapping
 * - Telemetry tracking for all SDK operations
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  withTelemetry,
  wrapSession,
  mapEventType,
  shouldTrackEvent,
  withTelemetryFactory,
  type SdkTelemetryConfig,
} from "../../src/telemetry/sdk-integration.ts";
import {
  createNoopCollector,
  setGlobalCollector,
  resetGlobalCollector,
} from "../../src/telemetry/collector.ts";
import type {
  CodingAgentClient,
  Session,
  SessionConfig,
  AgentMessage,
  EventType,
  EventHandler,
  ToolDefinition,
  ContextUsage,
  AgentEvent,
} from "../../src/sdk/types.ts";
import type { TelemetryCollector, SdkEventType } from "../../src/telemetry/types.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock session for testing.
 */
function createMockSession(id: string = "test-session"): Session {
  return {
    id,
    async send(message: string): Promise<AgentMessage> {
      return {
        type: "text",
        content: `Response to: ${message}`,
        role: "assistant",
      };
    },
    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: "Chunk 1", role: "assistant" };
      yield { type: "text", content: "Chunk 2", role: "assistant" };
    },
    async summarize(): Promise<void> {},
    async getContextUsage(): Promise<ContextUsage> {
      return {
        inputTokens: 100,
        outputTokens: 50,
        maxTokens: 100000,
        usagePercentage: 0.15,
      };
    },
    getSystemToolsTokens() { return 0; },
    async destroy(): Promise<void> {},
  };
}

/**
 * Create a mock client for testing.
 */
function createMockClient(): CodingAgentClient {
  const eventHandlers = new Map<EventType, EventHandler<EventType>[]>();

  return {
    agentType: "claude",
    async createSession(config?: SessionConfig): Promise<Session> {
      return createMockSession();
    },
    async resumeSession(sessionId: string): Promise<Session | null> {
      if (sessionId === "existing-session") {
        return createMockSession(sessionId);
      }
      return null;
    },
    on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
      const handlers = eventHandlers.get(eventType) || [];
      handlers.push(handler as EventHandler<EventType>);
      eventHandlers.set(eventType, handlers);
      return () => {
        const idx = handlers.indexOf(handler as EventHandler<EventType>);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    registerTool(tool: ToolDefinition): void {},
    async start(): Promise<void> {},
    async stop(): Promise<void> {},
    async getModelDisplayInfo() {
      return { model: "Mock", tier: "Test" };
    },
    getSystemToolsTokens() { return null; },
  };
}

interface TrackedEvent {
  eventType: string;
  properties: Record<string, unknown>;
  options?: { sessionId?: string };
}

/**
 * Create a mock collector that tracks events.
 */
function createTrackingCollector(): {
  collector: TelemetryCollector;
  events: TrackedEvent[];
  getEvent: (index: number) => TrackedEvent;
} {
  const events: TrackedEvent[] = [];

  const collector: TelemetryCollector = {
    track(eventType, properties = {}, options) {
      events.push({ eventType, properties: properties as Record<string, unknown>, options });
    },
    async flush() {
      return { eventCount: events.length, localLogSuccess: true, remoteSuccess: true };
    },
    isEnabled() {
      return true;
    },
    async shutdown() {},
    getBufferSize() {
      return events.length;
    },
    getConfig() {
      return { enabled: true };
    },
  };

  const getEvent = (index: number): TrackedEvent => {
    const event = events[index];
    if (!event) throw new Error(`No event at index ${index}`);
    return event;
  };

  return { collector, events, getEvent };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  resetGlobalCollector();
});

afterEach(() => {
  resetGlobalCollector();
});

// ============================================================================
// mapEventType Tests
// ============================================================================

describe("mapEventType", () => {
  test("maps session.start to sdk.session.created", () => {
    expect(mapEventType("session.start")).toBe("sdk.session.created");
  });

  test("maps session.error to sdk.error", () => {
    expect(mapEventType("session.error")).toBe("sdk.error");
  });

  test("maps message.delta to sdk.message.received", () => {
    expect(mapEventType("message.delta")).toBe("sdk.message.received");
  });

  test("maps message.complete to sdk.message.received", () => {
    expect(mapEventType("message.complete")).toBe("sdk.message.received");
  });

  test("maps tool.start to sdk.tool.started", () => {
    expect(mapEventType("tool.start")).toBe("sdk.tool.started");
  });

  test("maps tool.complete to sdk.tool.completed", () => {
    expect(mapEventType("tool.complete")).toBe("sdk.tool.completed");
  });

  test("maps subagent.start to sdk.session.created", () => {
    expect(mapEventType("subagent.start")).toBe("sdk.session.created");
  });

  test("maps subagent.complete to sdk.session.destroyed", () => {
    expect(mapEventType("subagent.complete")).toBe("sdk.session.destroyed");
  });
});

// ============================================================================
// shouldTrackEvent Tests
// ============================================================================

describe("shouldTrackEvent", () => {
  test("always tracks session events", () => {
    const config: SdkTelemetryConfig = {};
    expect(shouldTrackEvent("session.start", config)).toBe(true);
    expect(shouldTrackEvent("session.error", config)).toBe(true);
    expect(shouldTrackEvent("session.idle", config)).toBe(true);
  });

  test("tracks message events by default", () => {
    const config: SdkTelemetryConfig = {};
    expect(shouldTrackEvent("message.delta", config)).toBe(true);
    expect(shouldTrackEvent("message.complete", config)).toBe(true);
  });

  test("skips message events when trackMessages is false", () => {
    const config: SdkTelemetryConfig = { trackMessages: false };
    expect(shouldTrackEvent("message.delta", config)).toBe(false);
    expect(shouldTrackEvent("message.complete", config)).toBe(false);
  });

  test("tracks tool events by default", () => {
    const config: SdkTelemetryConfig = {};
    expect(shouldTrackEvent("tool.start", config)).toBe(true);
    expect(shouldTrackEvent("tool.complete", config)).toBe(true);
  });

  test("skips tool events when trackTools is false", () => {
    const config: SdkTelemetryConfig = { trackTools: false };
    expect(shouldTrackEvent("tool.start", config)).toBe(false);
    expect(shouldTrackEvent("tool.complete", config)).toBe(false);
  });

  test("tracks subagent events", () => {
    const config: SdkTelemetryConfig = {};
    expect(shouldTrackEvent("subagent.start", config)).toBe(true);
    expect(shouldTrackEvent("subagent.complete", config)).toBe(true);
  });
});

// ============================================================================
// wrapSession Tests
// ============================================================================

describe("wrapSession", () => {
  test("wraps session and preserves id", () => {
    const { collector } = createTrackingCollector();
    const session = createMockSession("my-session");

    const wrapped = wrapSession(session, collector, "claude");

    expect(wrapped.id).toBe("my-session");
    expect(wrapped._wrapped).toBe(session);
  });

  test("tracks send on success", async () => {
    const { collector, events } = createTrackingCollector();
    const session = createMockSession("session-1");

    const wrapped = wrapSession(session, collector, "claude");
    await wrapped.send("Hello");

    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.eventType).toBe("sdk.message.sent");
    expect(event.properties.agentType).toBe("claude");
    expect(event.properties.success).toBe(true);
    expect(event.properties.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.options?.sessionId).toBe("session-1");
  });

  test("tracks send on failure", async () => {
    const { collector, events } = createTrackingCollector();
    const session: Session = {
      ...createMockSession(),
      async send() {
        throw new Error("Network error");
      },
    };

    const wrapped = wrapSession(session, collector, "opencode");

    await expect(wrapped.send("Hello")).rejects.toThrow("Network error");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.message.sent");
    expect(events[0]!.properties.success).toBe(false);
    expect(events[0]!.properties.errorMessage).toBe("Network error");
  });

  test("tracks stream completion", async () => {
    const { collector, events } = createTrackingCollector();
    const session = createMockSession();

    const wrapped = wrapSession(session, collector, "copilot");

    const chunks: AgentMessage[] = [];
    for await (const chunk of wrapped.stream("Hello")) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.message.sent");
    expect(events[0]!.properties.success).toBe(true);
  });

  test("tracks destroy", async () => {
    const { collector, events } = createTrackingCollector();
    const session = createMockSession("destroy-session");

    const wrapped = wrapSession(session, collector, "claude");
    await wrapped.destroy();

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.session.destroyed");
    expect(events[0]!.options?.sessionId).toBe("destroy-session");
  });

  test("passes through summarize", async () => {
    const { collector } = createTrackingCollector();
    let summarizeCalled = false;
    const session: Session = {
      ...createMockSession(),
      async summarize() {
        summarizeCalled = true;
      },
    };

    const wrapped = wrapSession(session, collector, "claude");
    await wrapped.summarize();

    expect(summarizeCalled).toBe(true);
  });

  test("passes through getContextUsage", async () => {
    const { collector } = createTrackingCollector();
    const session = createMockSession();

    const wrapped = wrapSession(session, collector, "claude");
    const usage = await wrapped.getContextUsage();

    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
  });
});

// ============================================================================
// withTelemetry Tests
// ============================================================================

describe("withTelemetry", () => {
  test("wraps client and preserves agentType", () => {
    const { collector } = createTrackingCollector();
    const client = createMockClient();

    const wrapped = withTelemetry(client, { collector });

    expect(wrapped.agentType).toBe("claude");
  });

  test("tracks createSession on success", async () => {
    const { collector, events } = createTrackingCollector();
    const client = createMockClient();

    const wrapped = withTelemetry(client, { collector });
    const session = await wrapped.createSession({ model: "claude-3-opus" });

    expect(session).toBeDefined();
    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.session.created");
    expect(events[0]!.properties.model).toBe("claude-3-opus");
    expect(events[0]!.properties.success).toBe(true);
    expect(events[0]!.properties.agentType).toBe("claude");
  });

  test("tracks createSession on failure", async () => {
    const { collector, events } = createTrackingCollector();
    const client: CodingAgentClient = {
      ...createMockClient(),
      async createSession() {
        throw new Error("Failed to create session");
      },
    };

    const wrapped = withTelemetry(client, { collector });

    await expect(wrapped.createSession()).rejects.toThrow("Failed to create session");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.session.created");
    expect(events[0]!.properties.success).toBe(false);
    expect(events[0]!.properties.errorMessage).toBe("Failed to create session");
  });

  test("tracks resumeSession on success", async () => {
    const { collector, events } = createTrackingCollector();
    const client = createMockClient();

    const wrapped = withTelemetry(client, { collector });
    const session = await wrapped.resumeSession("existing-session");

    expect(session).not.toBeNull();
    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.session.resumed");
    expect(events[0]!.properties.success).toBe(true);
    expect(events[0]!.options?.sessionId).toBe("existing-session");
  });

  test("tracks resumeSession when not found", async () => {
    const { collector, events } = createTrackingCollector();
    const client = createMockClient();

    const wrapped = withTelemetry(client, { collector });
    const session = await wrapped.resumeSession("nonexistent");

    expect(session).toBeNull();
    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.session.resumed");
    expect(events[0]!.properties.success).toBe(false);
    expect(events[0]!.properties.errorMessage).toBe("Session not found");
  });

  test("returned sessions are wrapped", async () => {
    const { collector, events } = createTrackingCollector();
    const client = createMockClient();

    const wrapped = withTelemetry(client, { collector });
    const session = await wrapped.createSession();

    // Clear creation event
    events.length = 0;

    // Send a message through the wrapped session
    await session.send("Test message");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.message.sent");
  });

  test("passes through registerTool", () => {
    const { collector } = createTrackingCollector();
    let registeredTool: ToolDefinition | null = null;
    const client: CodingAgentClient = {
      ...createMockClient(),
      registerTool(tool) {
        registeredTool = tool;
      },
    };

    const wrapped = withTelemetry(client, { collector });
    wrapped.registerTool({
      name: "test-tool",
      description: "A test tool",
      inputSchema: {},
      handler: async () => "result",
    });

    expect(registeredTool).not.toBeNull();
    expect(registeredTool!.name).toBe("test-tool");
  });

  test("passes through start", async () => {
    const { collector } = createTrackingCollector();
    let startCalled = false;
    const client: CodingAgentClient = {
      ...createMockClient(),
      async start() {
        startCalled = true;
      },
    };

    const wrapped = withTelemetry(client, { collector });
    await wrapped.start();

    expect(startCalled).toBe(true);
  });

  test("flushes and stops on stop", async () => {
    const { collector, events } = createTrackingCollector();
    let flushCalled = false;
    let stopCalled = false;

    const trackingCollector: TelemetryCollector = {
      ...collector,
      async flush() {
        flushCalled = true;
        return { eventCount: 0, localLogSuccess: true, remoteSuccess: true };
      },
    };

    const client: CodingAgentClient = {
      ...createMockClient(),
      async stop() {
        stopCalled = true;
      },
    };

    const wrapped = withTelemetry(client, { collector: trackingCollector });
    await wrapped.stop();

    expect(flushCalled).toBe(true);
    expect(stopCalled).toBe(true);
  });

  test("uses global collector when not provided", async () => {
    const { collector, events } = createTrackingCollector();
    setGlobalCollector(collector);

    const client = createMockClient();
    const wrapped = withTelemetry(client);

    await wrapped.createSession();

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("sdk.session.created");
  });

  test("includes additional properties", async () => {
    const { collector, events } = createTrackingCollector();
    const client = createMockClient();

    const wrapped = withTelemetry(client, {
      collector,
      additionalProperties: {
        atomicVersion: "1.0.0",
      },
    });

    await wrapped.createSession();

    expect(events[0]!.properties.atomicVersion).toBe("1.0.0");
  });
});

// ============================================================================
// withTelemetryFactory Tests
// ============================================================================

describe("withTelemetryFactory", () => {
  test("wraps factory output with telemetry", async () => {
    const { collector, events } = createTrackingCollector();

    const factory = (agentType: string) => {
      const client = createMockClient();
      // Override agentType
      return {
        ...client,
        agentType: agentType as "claude" | "opencode" | "copilot",
      };
    };

    const wrappedFactory = withTelemetryFactory(factory, { collector });
    const client = wrappedFactory("opencode");

    expect(client.agentType).toBe("opencode");

    await client.createSession();

    expect(events.length).toBe(1);
    expect(events[0]!.properties.agentType).toBe("opencode");
  });
});

// ============================================================================
// Event Handler Wrapping Tests
// ============================================================================

describe("Event handler wrapping", () => {
  test("wraps on handlers and tracks events", () => {
    const { collector, events } = createTrackingCollector();
    const client = createMockClient();
    let handlerCalled = false;

    const wrapped = withTelemetry(client, { collector });

    const unsubscribe = wrapped.on("session.start", (event) => {
      handlerCalled = true;
    });

    expect(typeof unsubscribe).toBe("function");
  });

  test("unsubscribe works correctly", () => {
    const { collector } = createTrackingCollector();
    const client = createMockClient();

    const wrapped = withTelemetry(client, { collector });

    const unsubscribe = wrapped.on("session.start", () => {});
    
    // Should not throw
    unsubscribe();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
  test("handles stream errors correctly", async () => {
    const { collector, events } = createTrackingCollector();
    const session: Session = {
      ...createMockSession(),
      async *stream() {
        yield { type: "text", content: "First chunk", role: "assistant" };
        throw new Error("Stream interrupted");
      },
    };

    const wrapped = wrapSession(session, collector, "claude");

    const chunks: AgentMessage[] = [];
    try {
      for await (const chunk of wrapped.stream("Hello")) {
        chunks.push(chunk);
      }
    } catch (error) {
      // Expected
    }

    expect(chunks.length).toBe(1);
    expect(events.length).toBe(1);
    expect(events[0]!.properties.success).toBe(false);
    expect(events[0]!.properties.errorMessage).toBe("Stream interrupted");
  });

  test("handles non-Error throws", async () => {
    const { collector, events } = createTrackingCollector();
    const session: Session = {
      ...createMockSession(),
      async send() {
        throw "String error";
      },
    };

    const wrapped = wrapSession(session, collector, "claude");

    try {
      await wrapped.send("Hello");
    } catch {
      // Expected
    }

    expect(events[0]!.properties.errorMessage).toBe("String error");
  });
});
