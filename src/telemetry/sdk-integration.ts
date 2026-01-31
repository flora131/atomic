/**
 * SDK Telemetry Integration
 *
 * Provides telemetry wrapping for CodingAgentClient to automatically
 * track SDK operations (session creation, message sending, tool usage).
 *
 * Reference: Feature 23 - Implement SDK telemetry integration with withTelemetry wrapper
 */

import type {
  CodingAgentClient,
  Session,
  SessionConfig,
  AgentMessage,
  EventType,
  EventHandler,
  ToolDefinition,
  ContextUsage,
} from "../sdk/types.ts";
import type {
  TelemetryCollector,
  SdkEventType,
  SdkEventProperties,
} from "./types.ts";
import { getGlobalCollector } from "./collector.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for SDK telemetry integration.
 */
export interface SdkTelemetryConfig {
  /** Custom telemetry collector (defaults to global collector) */
  collector?: TelemetryCollector;
  /** Whether to track message events */
  trackMessages?: boolean;
  /** Whether to track tool events */
  trackTools?: boolean;
  /** Additional properties to include in all events */
  additionalProperties?: SdkEventProperties;
}

/**
 * Telemetry-wrapped session with tracking capabilities.
 */
interface TelemetrySession extends Session {
  /** The underlying session being wrapped */
  readonly _wrapped: Session;
}

// ============================================================================
// EVENT TYPE MAPPING
// ============================================================================

/**
 * Map SDK EventType to telemetry SdkEventType.
 *
 * @param eventType - SDK event type
 * @returns Corresponding telemetry event type, or undefined if not mapped
 */
export function mapEventType(eventType: EventType): SdkEventType | undefined {
  const mapping: Record<string, SdkEventType> = {
    "session.start": "sdk.session.created",
    "session.idle": "sdk.session.created", // Map idle to created as fallback
    "session.error": "sdk.error",
    "message.delta": "sdk.message.received",
    "message.complete": "sdk.message.received",
    "tool.start": "sdk.tool.started",
    "tool.complete": "sdk.tool.completed",
    "subagent.start": "sdk.session.created",
    "subagent.complete": "sdk.session.destroyed",
  };

  return mapping[eventType];
}

/**
 * Determine if an SDK event type should be tracked.
 */
export function shouldTrackEvent(
  eventType: EventType,
  config: SdkTelemetryConfig
): boolean {
  // Always track session events
  if (eventType.startsWith("session.")) {
    return true;
  }

  // Track message events if enabled (default true)
  if (eventType.startsWith("message.") && config.trackMessages !== false) {
    return true;
  }

  // Track tool events if enabled (default true)
  if (eventType.startsWith("tool.") && config.trackTools !== false) {
    return true;
  }

  // Track subagent events
  if (eventType.startsWith("subagent.")) {
    return true;
  }

  return false;
}

// ============================================================================
// SESSION WRAPPER
// ============================================================================

/**
 * Wrap a session with telemetry tracking.
 *
 * @param session - The session to wrap
 * @param collector - Telemetry collector to use
 * @param agentType - Type of agent for properties
 * @param additionalProperties - Additional properties to include
 * @returns Wrapped session with telemetry tracking
 */
export function wrapSession(
  session: Session,
  collector: TelemetryCollector,
  agentType: string,
  additionalProperties?: SdkEventProperties
): TelemetrySession {
  const baseProperties: SdkEventProperties = {
    agentType,
    ...additionalProperties,
  };

  return {
    get id() {
      return session.id;
    },

    get _wrapped() {
      return session;
    },

    async send(message: string): Promise<AgentMessage> {
      const startTime = Date.now();

      try {
        const response = await session.send(message);

        collector.track(
          "sdk.message.sent",
          {
            ...baseProperties,
            success: true,
            durationMs: Date.now() - startTime,
          },
          { sessionId: session.id }
        );

        return response;
      } catch (error) {
        collector.track(
          "sdk.message.sent",
          {
            ...baseProperties,
            success: false,
            durationMs: Date.now() - startTime,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          { sessionId: session.id }
        );

        throw error;
      }
    },

    async *stream(message: string): AsyncIterable<AgentMessage> {
      const startTime = Date.now();
      let success = true;
      let errorMessage: string | undefined;

      try {
        for await (const chunk of session.stream(message)) {
          yield chunk;
        }
      } catch (error) {
        success = false;
        errorMessage = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        collector.track(
          "sdk.message.sent",
          {
            ...baseProperties,
            success,
            durationMs: Date.now() - startTime,
            errorMessage,
          },
          { sessionId: session.id }
        );
      }
    },

    async summarize(): Promise<void> {
      return session.summarize();
    },

    async getContextUsage(): Promise<ContextUsage> {
      return session.getContextUsage();
    },

    async destroy(): Promise<void> {
      collector.track(
        "sdk.session.destroyed",
        baseProperties,
        { sessionId: session.id }
      );

      return session.destroy();
    },
  };
}

// ============================================================================
// CLIENT WRAPPER
// ============================================================================

/**
 * Wrap a CodingAgentClient with telemetry tracking.
 *
 * This function returns a new client that automatically tracks:
 * - Session creation and resumption
 * - Message sending (via wrapped sessions)
 * - Session destruction
 * - SDK events via the `on` method
 *
 * @param client - The client to wrap
 * @param config - Telemetry configuration
 * @returns Wrapped client with telemetry tracking
 *
 * @example
 * ```typescript
 * const client = new ClaudeAgentClient();
 * const trackedClient = withTelemetry(client);
 *
 * // All operations are now tracked
 * const session = await trackedClient.createSession();
 * await session.send("Hello");
 * await session.destroy();
 * ```
 */
export function withTelemetry(
  client: CodingAgentClient,
  config: SdkTelemetryConfig = {}
): CodingAgentClient {
  const collector = config.collector ?? getGlobalCollector();
  const agentType = client.agentType;
  const baseProperties: SdkEventProperties = {
    agentType,
    ...config.additionalProperties,
  };

  return {
    get agentType() {
      return client.agentType;
    },

    async createSession(sessionConfig?: SessionConfig): Promise<Session> {
      const startTime = Date.now();

      try {
        const session = await client.createSession(sessionConfig);

        collector.track(
          "sdk.session.created",
          {
            ...baseProperties,
            model: sessionConfig?.model,
            success: true,
            durationMs: Date.now() - startTime,
          },
          { sessionId: session.id }
        );

        return wrapSession(session, collector, agentType, config.additionalProperties);
      } catch (error) {
        collector.track(
          "sdk.session.created",
          {
            ...baseProperties,
            model: sessionConfig?.model,
            success: false,
            durationMs: Date.now() - startTime,
            errorMessage: error instanceof Error ? error.message : String(error),
          }
        );

        throw error;
      }
    },

    async resumeSession(sessionId: string): Promise<Session | null> {
      const startTime = Date.now();

      try {
        const session = await client.resumeSession(sessionId);

        if (session) {
          collector.track(
            "sdk.session.resumed",
            {
              ...baseProperties,
              success: true,
              durationMs: Date.now() - startTime,
            },
            { sessionId: session.id }
          );

          return wrapSession(session, collector, agentType, config.additionalProperties);
        }

        collector.track(
          "sdk.session.resumed",
          {
            ...baseProperties,
            success: false,
            durationMs: Date.now() - startTime,
            errorMessage: "Session not found",
          },
          { sessionId }
        );

        return null;
      } catch (error) {
        collector.track(
          "sdk.session.resumed",
          {
            ...baseProperties,
            success: false,
            durationMs: Date.now() - startTime,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          { sessionId }
        );

        throw error;
      }
    },

    on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
      // Track event registration and forward events to telemetry
      const wrappedHandler: EventHandler<T> = (event) => {
        // Track the event if it should be tracked
        if (shouldTrackEvent(eventType, config)) {
          const telemetryEventType = mapEventType(eventType);
          if (telemetryEventType) {
            collector.track(
              telemetryEventType,
              {
                ...baseProperties,
                ...extractEventProperties(event),
              },
              { sessionId: event.sessionId }
            );
          }
        }

        // Call the original handler
        return handler(event);
      };

      return client.on(eventType, wrappedHandler);
    },

    registerTool(tool: ToolDefinition): void {
      client.registerTool(tool);
    },

    async start(): Promise<void> {
      return client.start();
    },

    async stop(): Promise<void> {
      // Flush telemetry before stopping
      await collector.flush();
      return client.stop();
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract relevant properties from an SDK event for telemetry.
 */
function extractEventProperties(event: {
  type: EventType;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}): Partial<SdkEventProperties> {
  const props: Partial<SdkEventProperties> = {};

  // Extract tool name if present
  if ("toolName" in event.data && typeof event.data.toolName === "string") {
    props.toolName = event.data.toolName;
  }

  // Extract error message if present
  if ("error" in event.data) {
    const error = event.data.error;
    props.errorMessage = error instanceof Error ? error.message : String(error);
  }

  // Extract success status if present
  if ("success" in event.data && typeof event.data.success === "boolean") {
    props.success = event.data.success;
  }

  return props;
}

/**
 * Create a telemetry-enabled client factory.
 *
 * @param factory - Original client factory
 * @param config - Telemetry configuration
 * @returns Factory that produces telemetry-wrapped clients
 */
export function withTelemetryFactory(
  factory: (agentType: string, options?: Record<string, unknown>) => CodingAgentClient,
  config: SdkTelemetryConfig = {}
): (agentType: string, options?: Record<string, unknown>) => CodingAgentClient {
  return (agentType: string, options?: Record<string, unknown>) => {
    const client = factory(agentType, options);
    return withTelemetry(client, config);
  };
}
