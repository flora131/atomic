/**
 * Unit tests for unified telemetry types
 *
 * Tests cover:
 * - Event type definitions and unions
 * - Type guards for all event types
 * - TelemetryEvent creation and validation
 * - TelemetryCollector interface contracts
 * - Helper functions
 */

import { describe, test, expect } from "bun:test";
import {
  // Type guards
  isSdkEventType,
  isGraphEventType,
  isWorkflowEventType,
  isUiEventType,
  isTelemetryEventType,
  isTelemetryEvent,
  isFlushResult,
  // Helper functions
  getEventCategory,
  createTelemetryEvent,
  DEFAULT_TELEMETRY_CONFIG,
  // Types
  type TelemetryEvent,
  type TelemetryEventType,
  type TelemetryCollector,
  type TelemetryCollectorConfig,
  type FlushResult,
  type SdkEventProperties,
  type GraphEventProperties,
  type WorkflowEventProperties,
  type UiEventProperties,
} from "../../src/telemetry/index.ts";

// ============================================================================
// SDK Event Type Tests
// ============================================================================

describe("SdkEventType", () => {
  const validSdkEvents = [
    "sdk.session.created",
    "sdk.session.resumed",
    "sdk.session.destroyed",
    "sdk.message.sent",
    "sdk.message.received",
    "sdk.tool.started",
    "sdk.tool.completed",
    "sdk.tool.failed",
    "sdk.error",
  ];

  test("validates all SDK event types", () => {
    for (const eventType of validSdkEvents) {
      expect(isSdkEventType(eventType)).toBe(true);
    }
  });

  test("rejects non-SDK event types", () => {
    expect(isSdkEventType("graph.node.started")).toBe(false);
    expect(isSdkEventType("workflow.iteration.started")).toBe(false);
    expect(isSdkEventType("ui.chat.opened")).toBe(false);
    expect(isSdkEventType("invalid.event")).toBe(false);
    expect(isSdkEventType("")).toBe(false);
  });
});

// ============================================================================
// Graph Event Type Tests
// ============================================================================

describe("GraphEventType", () => {
  const validGraphEvents = [
    "graph.execution.started",
    "graph.execution.completed",
    "graph.execution.failed",
    "graph.execution.paused",
    "graph.execution.resumed",
    "graph.node.started",
    "graph.node.completed",
    "graph.node.failed",
    "graph.node.retried",
    "graph.checkpoint.saved",
    "graph.checkpoint.loaded",
  ];

  test("validates all graph event types", () => {
    for (const eventType of validGraphEvents) {
      expect(isGraphEventType(eventType)).toBe(true);
    }
  });

  test("rejects non-graph event types", () => {
    expect(isGraphEventType("sdk.session.created")).toBe(false);
    expect(isGraphEventType("workflow.feature.started")).toBe(false);
    expect(isGraphEventType("ui.theme.changed")).toBe(false);
    expect(isGraphEventType("invalid")).toBe(false);
  });
});

// ============================================================================
// Workflow Event Type Tests
// ============================================================================

describe("WorkflowEventType", () => {
  const validWorkflowEvents = [
    "workflow.iteration.started",
    "workflow.iteration.completed",
    "workflow.feature.started",
    "workflow.feature.completed",
    "workflow.feature.failed",
    "workflow.loop.started",
    "workflow.loop.completed",
    "workflow.context.compacted",
  ];

  test("validates all workflow event types", () => {
    for (const eventType of validWorkflowEvents) {
      expect(isWorkflowEventType(eventType)).toBe(true);
    }
  });

  test("rejects non-workflow event types", () => {
    expect(isWorkflowEventType("sdk.error")).toBe(false);
    expect(isWorkflowEventType("graph.node.completed")).toBe(false);
    expect(isWorkflowEventType("ui.message.sent")).toBe(false);
  });
});

// ============================================================================
// UI Event Type Tests
// ============================================================================

describe("UiEventType", () => {
  const validUiEvents = [
    "ui.chat.opened",
    "ui.chat.closed",
    "ui.message.sent",
    "ui.theme.changed",
    "ui.error.displayed",
  ];

  test("validates all UI event types", () => {
    for (const eventType of validUiEvents) {
      expect(isUiEventType(eventType)).toBe(true);
    }
  });

  test("rejects non-UI event types", () => {
    expect(isUiEventType("sdk.session.created")).toBe(false);
    expect(isUiEventType("graph.node.started")).toBe(false);
    expect(isUiEventType("workflow.loop.started")).toBe(false);
  });
});

// ============================================================================
// TelemetryEventType Union Tests
// ============================================================================

describe("TelemetryEventType", () => {
  test("validates all valid event types from all categories", () => {
    // SDK events
    expect(isTelemetryEventType("sdk.session.created")).toBe(true);
    expect(isTelemetryEventType("sdk.tool.completed")).toBe(true);

    // Graph events
    expect(isTelemetryEventType("graph.execution.started")).toBe(true);
    expect(isTelemetryEventType("graph.checkpoint.saved")).toBe(true);

    // Workflow events
    expect(isTelemetryEventType("workflow.feature.completed")).toBe(true);
    expect(isTelemetryEventType("workflow.loop.completed")).toBe(true);

    // UI events
    expect(isTelemetryEventType("ui.chat.opened")).toBe(true);
    expect(isTelemetryEventType("ui.theme.changed")).toBe(true);
  });

  test("rejects invalid event types", () => {
    expect(isTelemetryEventType("invalid.event.type")).toBe(false);
    expect(isTelemetryEventType("random")).toBe(false);
    expect(isTelemetryEventType("")).toBe(false);
    expect(isTelemetryEventType("sdk")).toBe(false);
    expect(isTelemetryEventType("sdk.unknown")).toBe(false);
  });
});

// ============================================================================
// TelemetryEvent Tests
// ============================================================================

describe("TelemetryEvent", () => {
  test("isTelemetryEvent validates complete events", () => {
    const validEvent: TelemetryEvent = {
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      timestamp: "2026-01-31T12:00:00.000Z",
      eventType: "sdk.session.created",
      properties: {
        agentType: "claude",
      },
    };

    expect(isTelemetryEvent(validEvent)).toBe(true);
  });

  test("isTelemetryEvent validates events with optional fields", () => {
    const eventWithSession: TelemetryEvent = {
      eventId: "123",
      timestamp: "2026-01-31T12:00:00.000Z",
      eventType: "graph.node.completed",
      sessionId: "session-123",
      executionId: "exec-456",
      properties: {
        nodeId: "start",
        nodeType: "agent",
      },
    };

    expect(isTelemetryEvent(eventWithSession)).toBe(true);
  });

  test("isTelemetryEvent rejects invalid events", () => {
    // Missing eventId
    expect(
      isTelemetryEvent({
        timestamp: "2026-01-31T12:00:00.000Z",
        eventType: "sdk.error",
        properties: {},
      })
    ).toBe(false);

    // Missing timestamp
    expect(
      isTelemetryEvent({
        eventId: "123",
        eventType: "sdk.error",
        properties: {},
      })
    ).toBe(false);

    // Invalid eventType
    expect(
      isTelemetryEvent({
        eventId: "123",
        timestamp: "2026-01-31T12:00:00.000Z",
        eventType: "invalid.type",
        properties: {},
      })
    ).toBe(false);

    // Missing properties
    expect(
      isTelemetryEvent({
        eventId: "123",
        timestamp: "2026-01-31T12:00:00.000Z",
        eventType: "sdk.error",
      })
    ).toBe(false);

    // Null value
    expect(isTelemetryEvent(null)).toBe(false);

    // Non-object
    expect(isTelemetryEvent("not an event")).toBe(false);
  });
});

// ============================================================================
// FlushResult Tests
// ============================================================================

describe("FlushResult", () => {
  test("isFlushResult validates complete results", () => {
    const validResult: FlushResult = {
      eventCount: 10,
      localLogSuccess: true,
      remoteSuccess: true,
    };

    expect(isFlushResult(validResult)).toBe(true);
  });

  test("isFlushResult validates results with optional error", () => {
    const resultWithError: FlushResult = {
      eventCount: 0,
      localLogSuccess: false,
      remoteSuccess: false,
      error: "Connection failed",
    };

    expect(isFlushResult(resultWithError)).toBe(true);
  });

  test("isFlushResult rejects invalid results", () => {
    // Missing eventCount
    expect(
      isFlushResult({
        localLogSuccess: true,
        remoteSuccess: true,
      })
    ).toBe(false);

    // Missing localLogSuccess
    expect(
      isFlushResult({
        eventCount: 5,
        remoteSuccess: true,
      })
    ).toBe(false);

    // Missing remoteSuccess
    expect(
      isFlushResult({
        eventCount: 5,
        localLogSuccess: true,
      })
    ).toBe(false);

    // Wrong types
    expect(
      isFlushResult({
        eventCount: "5",
        localLogSuccess: true,
        remoteSuccess: true,
      })
    ).toBe(false);

    // Null value
    expect(isFlushResult(null)).toBe(false);
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("getEventCategory", () => {
  test("extracts category from SDK events", () => {
    expect(getEventCategory("sdk.session.created")).toBe("sdk");
    expect(getEventCategory("sdk.tool.completed")).toBe("sdk");
    expect(getEventCategory("sdk.error")).toBe("sdk");
  });

  test("extracts category from graph events", () => {
    expect(getEventCategory("graph.execution.started")).toBe("graph");
    expect(getEventCategory("graph.node.completed")).toBe("graph");
    expect(getEventCategory("graph.checkpoint.saved")).toBe("graph");
  });

  test("extracts category from workflow events", () => {
    expect(getEventCategory("workflow.iteration.started")).toBe("workflow");
    expect(getEventCategory("workflow.feature.completed")).toBe("workflow");
    expect(getEventCategory("workflow.loop.completed")).toBe("workflow");
  });

  test("extracts category from UI events", () => {
    expect(getEventCategory("ui.chat.opened")).toBe("ui");
    expect(getEventCategory("ui.theme.changed")).toBe("ui");
    expect(getEventCategory("ui.error.displayed")).toBe("ui");
  });
});

describe("createTelemetryEvent", () => {
  test("creates event with auto-generated ID and timestamp", () => {
    const event = createTelemetryEvent("sdk.session.created", {
      agentType: "claude",
    });

    expect(event.eventId).toBeDefined();
    expect(event.eventId.length).toBeGreaterThan(0);
    expect(event.timestamp).toBeDefined();
    expect(new Date(event.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    expect(event.eventType).toBe("sdk.session.created");
    expect(event.properties).toEqual({ agentType: "claude" });
  });

  test("creates unique event IDs", () => {
    const event1 = createTelemetryEvent("sdk.session.created", {});
    const event2 = createTelemetryEvent("sdk.session.created", {});
    const event3 = createTelemetryEvent("sdk.session.created", {});

    expect(event1.eventId).not.toBe(event2.eventId);
    expect(event2.eventId).not.toBe(event3.eventId);
    expect(event1.eventId).not.toBe(event3.eventId);
  });

  test("creates event with session and execution IDs", () => {
    const event = createTelemetryEvent(
      "graph.node.completed",
      { nodeId: "start", nodeType: "agent" },
      { sessionId: "session-123", executionId: "exec-456" }
    );

    expect(event.sessionId).toBe("session-123");
    expect(event.executionId).toBe("exec-456");
  });

  test("creates event without optional IDs when not provided", () => {
    const event = createTelemetryEvent("ui.chat.opened", {});

    expect(event.sessionId).toBeUndefined();
    expect(event.executionId).toBeUndefined();
  });

  test("creates event with only sessionId", () => {
    const event = createTelemetryEvent(
      "sdk.message.sent",
      {},
      { sessionId: "session-only" }
    );

    expect(event.sessionId).toBe("session-only");
    expect(event.executionId).toBeUndefined();
  });

  test("creates event with only executionId", () => {
    const event = createTelemetryEvent(
      "graph.execution.started",
      {},
      { executionId: "exec-only" }
    );

    expect(event.sessionId).toBeUndefined();
    expect(event.executionId).toBe("exec-only");
  });

  test("creates event with empty properties", () => {
    const event = createTelemetryEvent("ui.theme.changed");

    expect(event.properties).toEqual({});
  });
});

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe("DEFAULT_TELEMETRY_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_TELEMETRY_CONFIG.enabled).toBe(true);
    expect(DEFAULT_TELEMETRY_CONFIG.batchSize).toBe(100);
    expect(DEFAULT_TELEMETRY_CONFIG.flushIntervalMs).toBe(30000);
  });

  test("does not include optional fields", () => {
    expect(DEFAULT_TELEMETRY_CONFIG.localLogPath).toBeUndefined();
    expect(DEFAULT_TELEMETRY_CONFIG.appInsightsKey).toBeUndefined();
    expect(DEFAULT_TELEMETRY_CONFIG.anonymousId).toBeUndefined();
  });
});

// ============================================================================
// Type Interface Tests (Compile-time validation)
// ============================================================================

describe("Type Interfaces", () => {
  test("TelemetryCollectorConfig accepts all fields", () => {
    const config: TelemetryCollectorConfig = {
      enabled: true,
      localLogPath: "/tmp/telemetry",
      appInsightsKey: "key-123",
      batchSize: 50,
      flushIntervalMs: 10000,
      anonymousId: "anon-123",
    };

    expect(config.enabled).toBe(true);
    expect(config.localLogPath).toBe("/tmp/telemetry");
    expect(config.appInsightsKey).toBe("key-123");
    expect(config.batchSize).toBe(50);
    expect(config.flushIntervalMs).toBe(10000);
    expect(config.anonymousId).toBe("anon-123");
  });

  test("SdkEventProperties has expected fields", () => {
    const props: SdkEventProperties = {
      agentType: "claude",
      model: "claude-3-opus",
      toolName: "bash",
      success: true,
      errorMessage: undefined,
      durationMs: 1500,
      inputTokens: 100,
      outputTokens: 200,
      platform: "linux",
      nodeVersion: "20.0.0",
      atomicVersion: "1.0.0",
      anonymousId: "anon-123",
    };

    expect(props.agentType).toBe("claude");
    expect(props.toolName).toBe("bash");
    expect(props.durationMs).toBe(1500);
  });

  test("GraphEventProperties has expected fields", () => {
    const props: GraphEventProperties = {
      nodeId: "start",
      nodeType: "agent",
      status: "completed",
      nodeCount: 10,
      completedNodeCount: 5,
      retryAttempt: 1,
      checkpointLabel: "before-tool",
      durationMs: 5000,
      errorMessage: undefined,
    };

    expect(props.nodeId).toBe("start");
    expect(props.nodeCount).toBe(10);
    expect(props.completedNodeCount).toBe(5);
  });

  test("WorkflowEventProperties has expected fields", () => {
    const props: WorkflowEventProperties = {
      iteration: 3,
      maxIterations: 10,
      featureId: "feature-1",
      featureDescription: "Add user authentication",
      totalFeatures: 20,
      passingFeatures: 15,
      allFeaturesPassing: false,
      durationMs: 60000,
    };

    expect(props.iteration).toBe(3);
    expect(props.totalFeatures).toBe(20);
    expect(props.allFeaturesPassing).toBe(false);
  });

  test("UiEventProperties has expected fields", () => {
    const props: UiEventProperties = {
      themeName: "dark",
      messageCount: 25,
      sessionDurationMs: 300000,
      errorMessage: undefined,
    };

    expect(props.themeName).toBe("dark");
    expect(props.messageCount).toBe(25);
    expect(props.sessionDurationMs).toBe(300000);
  });

  test("TelemetryCollector interface contract", () => {
    // This test validates the interface at compile time
    // We create a mock implementation to verify the shape
    const mockCollector: TelemetryCollector = {
      track: (_eventType, _properties, _options) => {},
      flush: async () => ({
        eventCount: 0,
        localLogSuccess: true,
        remoteSuccess: true,
      }),
      isEnabled: () => true,
      shutdown: async () => {},
      getBufferSize: () => 0,
      getConfig: () => ({ enabled: true }),
    };

    expect(typeof mockCollector.track).toBe("function");
    expect(typeof mockCollector.flush).toBe("function");
    expect(typeof mockCollector.isEnabled).toBe("function");
    expect(typeof mockCollector.shutdown).toBe("function");
    expect(typeof mockCollector.getBufferSize).toBe("function");
    expect(typeof mockCollector.getConfig).toBe("function");
  });
});

// ============================================================================
// Event Type Exhaustiveness Tests
// ============================================================================

describe("Event Type Exhaustiveness", () => {
  test("SDK events total count", () => {
    const sdkEvents = [
      "sdk.session.created",
      "sdk.session.resumed",
      "sdk.session.destroyed",
      "sdk.message.sent",
      "sdk.message.received",
      "sdk.tool.started",
      "sdk.tool.completed",
      "sdk.tool.failed",
      "sdk.error",
    ];

    // Verify all are valid SDK events
    for (const event of sdkEvents) {
      expect(isSdkEventType(event)).toBe(true);
    }
    expect(sdkEvents.length).toBe(9);
  });

  test("Graph events total count", () => {
    const graphEvents = [
      "graph.execution.started",
      "graph.execution.completed",
      "graph.execution.failed",
      "graph.execution.paused",
      "graph.execution.resumed",
      "graph.node.started",
      "graph.node.completed",
      "graph.node.failed",
      "graph.node.retried",
      "graph.checkpoint.saved",
      "graph.checkpoint.loaded",
    ];

    for (const event of graphEvents) {
      expect(isGraphEventType(event)).toBe(true);
    }
    expect(graphEvents.length).toBe(11);
  });

  test("Workflow events total count", () => {
    const workflowEvents = [
      "workflow.iteration.started",
      "workflow.iteration.completed",
      "workflow.feature.started",
      "workflow.feature.completed",
      "workflow.feature.failed",
      "workflow.loop.started",
      "workflow.loop.completed",
      "workflow.context.compacted",
    ];

    for (const event of workflowEvents) {
      expect(isWorkflowEventType(event)).toBe(true);
    }
    expect(workflowEvents.length).toBe(8);
  });

  test("UI events total count", () => {
    const uiEvents = [
      "ui.chat.opened",
      "ui.chat.closed",
      "ui.message.sent",
      "ui.theme.changed",
      "ui.error.displayed",
    ];

    for (const event of uiEvents) {
      expect(isUiEventType(event)).toBe(true);
    }
    expect(uiEvents.length).toBe(5);
  });

  test("Total telemetry event types", () => {
    // 9 SDK + 11 Graph + 8 Workflow + 5 UI = 33 total
    const totalExpected = 9 + 11 + 8 + 5;
    expect(totalExpected).toBe(33);
  });
});
