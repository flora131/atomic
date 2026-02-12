/**
 * Tests for SDK Client Subagent Event Mappings
 *
 * Verifies Feature 5: All three backends (Claude, OpenCode, Copilot) correctly
 * emit subagent.start and subagent.complete events with proper field mappings.
 *
 * Tests cover:
 * - Claude client: hook-based subagent field mapping (agent_id -> subagentId, agent_type -> subagentType)
 * - OpenCode client: AgentPart -> subagent.start, StepFinishPart -> subagent.complete
 * - Copilot client: subagent.started/completed -> subagent.start/complete
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { ClaudeAgentClient } from "../claude-client.ts";
import { OpenCodeClient } from "../opencode-client.ts";
import { CopilotClient } from "../copilot-client.ts";
import type { AgentEvent, EventType } from "../types.ts";

// Helper type for accessing private hook callbacks
type HookCallback = (
  input: unknown,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<unknown>;

// ============================================================================
// CLAUDE CLIENT TESTS
// ============================================================================

describe("ClaudeAgentClient subagent event mapping", () => {
  let client: ClaudeAgentClient;

  beforeEach(() => {
    client = new ClaudeAgentClient();
  });

  test("on('subagent.start') registers a SubagentStart hook", () => {
    const handler = mock(() => {});
    client.on("subagent.start", handler);

    // Access the private registeredHooks to verify SubagentStart was registered
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hooks = (client as any).registeredHooks as Record<string, HookCallback[]>;
    expect(hooks.SubagentStart).toBeDefined();
    expect(hooks.SubagentStart!.length).toBe(1);
  });

  test("on('subagent.complete') registers a SubagentStop hook", () => {
    const handler = mock(() => {});
    client.on("subagent.complete", handler);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hooks = (client as any).registeredHooks as Record<string, HookCallback[]>;
    expect(hooks.SubagentStop).toBeDefined();
    expect(hooks.SubagentStop!.length).toBe(1);
  });

  test("SubagentStart hook maps agent_id and agent_type to subagentId and subagentType", async () => {
    const receivedEvents: AgentEvent<"subagent.start">[] = [];
    client.on("subagent.start", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.start">);
    });

    // Get the registered hook callback and invoke it with subagent hook input
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hooks = (client as any).registeredHooks as Record<string, HookCallback[]>;
    const hookCallback = hooks.SubagentStart![0]!;

    const mockHookInput = {
      session_id: "test-session-123",
      agent_id: "subagent-abc",
      agent_type: "explore",
    };

    const controller = new AbortController();
    await hookCallback(mockHookInput, undefined, { signal: controller.signal });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.type).toBe("subagent.start");
    expect(ev.sessionId).toBe("test-session-123");
    expect(ev.data.subagentId).toBe("subagent-abc");
    expect(ev.data.subagentType).toBe("explore");
  });

  test("SubagentStop hook maps agent_id to subagentId and sets success=true", async () => {
    const receivedEvents: AgentEvent<"subagent.complete">[] = [];
    client.on("subagent.complete", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.complete">);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hooks = (client as any).registeredHooks as Record<string, HookCallback[]>;
    const hookCallback = hooks.SubagentStop![0]!;

    const mockHookInput = {
      session_id: "test-session-456",
      agent_id: "subagent-def",
      agent_transcript_path: "/tmp/transcript.json",
    };

    const controller = new AbortController();
    await hookCallback(mockHookInput, undefined, { signal: controller.signal });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.type).toBe("subagent.complete");
    expect(ev.sessionId).toBe("test-session-456");
    expect(ev.data.subagentId).toBe("subagent-def");
    expect(ev.data.success).toBe(true);
  });

  test("SubagentStart hook returns { continue: true }", async () => {
    client.on("subagent.start", () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hooks = (client as any).registeredHooks as Record<string, HookCallback[]>;
    const hookCallback = hooks.SubagentStart![0]!;

    const controller = new AbortController();
    const result = await hookCallback(
      { session_id: "s", agent_id: "a", agent_type: "b" },
      undefined,
      { signal: controller.signal }
    );

    expect(result).toEqual({ continue: true });
  });

  test("unsubscribe removes the handler", () => {
    const handler = mock(() => {});
    const unsub = client.on("subagent.start", handler);

    // Verify handler was added
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (client as any).eventHandlers as Map<EventType, Set<unknown>>;
    expect(handlers.get("subagent.start")?.size).toBe(1);

    unsub();

    // Handler should be removed from eventHandlers
    expect(handlers.get("subagent.start")?.size).toBe(0);
  });
});

// ============================================================================
// OPENCODE CLIENT TESTS
// ============================================================================

describe("OpenCodeClient subagent event mapping", () => {
  let client: OpenCodeClient;

  beforeEach(() => {
    client = new OpenCodeClient({ directory: "/tmp/test" });
  });

  // Helper to call private handleSdkEvent
  function callHandleSdkEvent(c: OpenCodeClient, event: Record<string, unknown>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).handleSdkEvent(event);
  }

  test("AgentPart emits subagent.start with subagentId and subagentType", () => {
    const receivedEvents: AgentEvent<"subagent.start">[] = [];
    client.on("subagent.start", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.start">);
    });

    callHandleSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        sessionID: "oc-session-1",
        part: {
          type: "agent",
          id: "agent-123",
          name: "explore",
          sessionID: "oc-session-1",
          messageID: "msg-1",
        },
      },
    });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.type).toBe("subagent.start");
    expect(ev.sessionId).toBe("oc-session-1");
    expect(ev.data.subagentId).toBe("agent-123");
    expect(ev.data.subagentType).toBe("explore");
  });

  test("StepFinishPart with success emits subagent.complete with success=true", () => {
    const receivedEvents: AgentEvent<"subagent.complete">[] = [];
    client.on("subagent.complete", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.complete">);
    });

    callHandleSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        sessionID: "oc-session-2",
        part: {
          type: "step-finish",
          id: "agent-456",
          reason: "completed",
        },
      },
    });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.type).toBe("subagent.complete");
    expect(ev.sessionId).toBe("oc-session-2");
    expect(ev.data.subagentId).toBe("agent-456");
    expect(ev.data.success).toBe(true);
    expect(ev.data.result).toBe("completed");
  });

  test("StepFinishPart with error emits subagent.complete with success=false", () => {
    const receivedEvents: AgentEvent<"subagent.complete">[] = [];
    client.on("subagent.complete", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.complete">);
    });

    callHandleSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        sessionID: "oc-session-3",
        part: {
          type: "step-finish",
          id: "agent-789",
          reason: "error",
        },
      },
    });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.data.success).toBe(false);
    expect(ev.data.result).toBe("error");
  });

  test("AgentPart with missing fields uses empty string defaults", () => {
    const receivedEvents: AgentEvent<"subagent.start">[] = [];
    client.on("subagent.start", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.start">);
    });

    callHandleSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        sessionID: "oc-session-4",
        part: {
          type: "agent",
          // no id or name
        },
      },
    });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.data.subagentId).toBe("");
    expect(ev.data.subagentType).toBe("");
  });

  test("unsubscribe removes the handler for subagent events", () => {
    const receivedEvents: unknown[] = [];
    const unsub = client.on("subagent.start", (event) => {
      receivedEvents.push(event);
    });

    // Fire event - should be received
    callHandleSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        sessionID: "s",
        part: { type: "agent", id: "a1", name: "test" },
      },
    });
    expect(receivedEvents.length).toBe(1);

    // Unsubscribe
    unsub();

    // Fire again - should NOT be received
    callHandleSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        sessionID: "s",
        part: { type: "agent", id: "a2", name: "test" },
      },
    });
    expect(receivedEvents.length).toBe(1); // still 1, not 2
  });
});

// ============================================================================
// COPILOT CLIENT TESTS
// ============================================================================

describe("CopilotClient subagent event mapping", () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = new CopilotClient();
  });

  // Helper to call private handleSdkEvent(sessionId, event)
  function callHandleSdkEvent(c: CopilotClient, sessionId: string, event: Record<string, unknown>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).handleSdkEvent(sessionId, event);
  }

  test("subagent.started maps to subagent.start with subagentId and subagentType", () => {
    const receivedEvents: AgentEvent<"subagent.start">[] = [];
    client.on("subagent.start", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.start">);
    });

    callHandleSdkEvent(client, "copilot-session-1", {
      type: "subagent.started",
      data: {
        toolCallId: "copilot-agent-001",
        agentName: "code-review",
      },
    });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.type).toBe("subagent.start");
    expect(ev.sessionId).toBe("copilot-session-1");
    expect(ev.data.subagentId).toBe("copilot-agent-001");
    expect(ev.data.subagentType).toBe("code-review");
  });

  test("subagent.completed maps to subagent.complete with success=true", () => {
    const receivedEvents: AgentEvent<"subagent.complete">[] = [];
    client.on("subagent.complete", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.complete">);
    });

    callHandleSdkEvent(client, "copilot-session-2", {
      type: "subagent.completed",
      data: {
        toolCallId: "copilot-agent-002",
      },
    });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.type).toBe("subagent.complete");
    expect(ev.sessionId).toBe("copilot-session-2");
    expect(ev.data.subagentId).toBe("copilot-agent-002");
    expect(ev.data.success).toBe(true);
  });

  test("subagent.failed maps to subagent.complete with success=false", () => {
    const receivedEvents: AgentEvent<"subagent.complete">[] = [];
    client.on("subagent.complete", (event) => {
      receivedEvents.push(event as AgentEvent<"subagent.complete">);
    });

    callHandleSdkEvent(client, "copilot-session-3", {
      type: "subagent.failed",
      data: {
        toolCallId: "copilot-agent-003",
        error: "Subagent timed out",
      },
    });

    expect(receivedEvents.length).toBe(1);
    const ev = receivedEvents[0]!;
    expect(ev.type).toBe("subagent.complete");
    expect(ev.sessionId).toBe("copilot-session-3");
    expect(ev.data.subagentId).toBe("copilot-agent-003");
    expect(ev.data.success).toBe(false);
    expect(ev.data.error).toBe("Subagent timed out");
  });
});
