/**
 * Stream Interrupt Behavior Tests
 *
 * Tests the three core behaviors for user input during streaming:
 * 1. Enter during streaming → interrupts stream and sends message as agent input
 * 2. Ctrl+D during streaming → queues message until streaming completes
 * 3. Enter during streaming with active sub-agents → defers interrupt until sub-agents finish
 */

import { describe, test, expect } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

// ============================================================================
// MOCK TYPES AND HELPERS
// ============================================================================

interface MockStreamState {
  isStreaming: boolean;
  streamingMessageId: string | null;
  wasInterrupted: boolean;
  pendingInterruptMessage: string | null;
  pendingInterruptSkipUser: boolean;
  parallelAgents: ParallelAgent[];
  queue: string[];
  sentMessages: string[];
  interruptCalled: boolean;
  streamFinalized: boolean;
}

function createMockStreamState(): MockStreamState {
  return {
    isStreaming: false,
    streamingMessageId: null,
    wasInterrupted: false,
    pendingInterruptMessage: null,
    pendingInterruptSkipUser: false,
    parallelAgents: [],
    queue: [],
    sentMessages: [],
    interruptCalled: false,
    streamFinalized: false,
  };
}

/**
 * Simulates the Enter key behavior during streaming (from handleSubmit in chat.tsx).
 * Mirrors the logic at lines 4257-4304 of chat.tsx.
 */
function simulateEnterDuringStreaming(state: MockStreamState, message: string): void {
  if (!state.isStreaming) {
    // Not streaming — send directly
    state.sentMessages.push(message);
    return;
  }

  // Check for active sub-agents
  const hasActiveSubagents = state.parallelAgents.some(
    (a) => a.status === "running" || a.status === "pending"
  );

  if (hasActiveSubagents) {
    // Defer interrupt — store message for later
    state.pendingInterruptMessage = message;
    state.pendingInterruptSkipUser = false;
    return;
  }

  // No sub-agents — interrupt immediately and send
  state.streamFinalized = true;
  state.isStreaming = false;
  state.interruptCalled = true;
  state.sentMessages.push(message);
}

/**
 * Simulates the Ctrl+D behavior during streaming (from keyboard handler in chat.tsx).
 * Mirrors the logic at lines 3358-3374 of chat.tsx.
 */
function simulateCtrlDDuringStreaming(state: MockStreamState, message: string): void {
  if (!state.isStreaming) return;
  if (!message.trim()) return;
  state.queue.push(message);
}

/**
 * Simulates stream completion — processes queued messages.
 * Mirrors handleComplete logic in chat.tsx.
 */
function simulateStreamCompletion(state: MockStreamState): void {
  state.isStreaming = false;
  state.streamFinalized = true;

  // Process first queued message
  if (state.queue.length > 0) {
    const next = state.queue.shift()!;
    state.sentMessages.push(next);
  }
}

/**
 * Simulates the parallelAgents effect that fires when sub-agents finish.
 * Mirrors the useEffect at lines 2118-2167 of chat.tsx.
 */
function simulateSubagentsComplete(state: MockStreamState): void {
  const hasActive = state.parallelAgents.some(
    (a) => a.status === "running" || a.status === "pending"
  );
  if (hasActive) return;

  if (state.pendingInterruptMessage !== null) {
    const deferredMessage = state.pendingInterruptMessage;
    state.pendingInterruptMessage = null;
    state.pendingInterruptSkipUser = false;

    // Perform the deferred interrupt
    state.streamFinalized = true;
    state.isStreaming = false;
    state.interruptCalled = true;
    state.sentMessages.push(deferredMessage);
  }
}

function createRunningAgent(name: string): ParallelAgent {
  return {
    id: `agent-${name}`,
    name,
    task: `Running ${name} task`,
    status: "running",
    startedAt: new Date().toISOString(),
  };
}

function completeAgent(agent: ParallelAgent): ParallelAgent {
  return {
    ...agent,
    status: "completed",
    durationMs: 1000,
  };
}

// ============================================================================
// BEHAVIOR 1: Enter during streaming interrupts and sends
// ============================================================================

describe("Enter during streaming interrupts stream and sends as input", () => {
  test("interrupts the stream immediately when no sub-agents are active", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";

    simulateEnterDuringStreaming(state, "follow-up question");

    expect(state.isStreaming).toBe(false);
    expect(state.interruptCalled).toBe(true);
    expect(state.streamFinalized).toBe(true);
    expect(state.sentMessages).toEqual(["follow-up question"]);
  });

  test("message is sent as new agent input, not queued", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";

    simulateEnterDuringStreaming(state, "new instruction");

    // Message should be in sentMessages (sent to agent), not in queue
    expect(state.sentMessages).toContain("new instruction");
    expect(state.queue).toHaveLength(0);
  });

  test("stops the current stream before sending the new message", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";

    simulateEnterDuringStreaming(state, "interrupt and send");

    expect(state.isStreaming).toBe(false);
    expect(state.streamFinalized).toBe(true);
  });

  test("sends directly when not streaming (normal flow)", () => {
    const state = createMockStreamState();
    state.isStreaming = false;

    simulateEnterDuringStreaming(state, "normal message");

    expect(state.sentMessages).toEqual(["normal message"]);
    expect(state.interruptCalled).toBe(false);
  });
});

// ============================================================================
// BEHAVIOR 2: Ctrl+D during streaming queues message
// ============================================================================

describe("Ctrl+D during streaming queues message until completion", () => {
  test("enqueues the message without interrupting the stream", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";

    simulateCtrlDDuringStreaming(state, "queued message");

    // Stream should still be running
    expect(state.isStreaming).toBe(true);
    expect(state.interruptCalled).toBe(false);
    // Message should be in queue, not sent
    expect(state.queue).toEqual(["queued message"]);
    expect(state.sentMessages).toHaveLength(0);
  });

  test("queued message is sent after stream completes", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";

    simulateCtrlDDuringStreaming(state, "deferred message");
    expect(state.sentMessages).toHaveLength(0);

    simulateStreamCompletion(state);

    expect(state.sentMessages).toEqual(["deferred message"]);
    expect(state.queue).toHaveLength(0);
  });

  test("multiple Ctrl+D messages are queued in order", () => {
    const state = createMockStreamState();
    state.isStreaming = true;

    simulateCtrlDDuringStreaming(state, "first");
    simulateCtrlDDuringStreaming(state, "second");
    simulateCtrlDDuringStreaming(state, "third");

    expect(state.queue).toEqual(["first", "second", "third"]);
    expect(state.isStreaming).toBe(true);
  });

  test("does nothing when not streaming", () => {
    const state = createMockStreamState();
    state.isStreaming = false;

    simulateCtrlDDuringStreaming(state, "should be ignored");

    expect(state.queue).toHaveLength(0);
  });

  test("ignores empty messages", () => {
    const state = createMockStreamState();
    state.isStreaming = true;

    simulateCtrlDDuringStreaming(state, "");
    simulateCtrlDDuringStreaming(state, "   ");

    expect(state.queue).toHaveLength(0);
  });
});

// ============================================================================
// BEHAVIOR 3: Enter with active sub-agents defers interrupt
// ============================================================================

describe("Enter with active sub-agents defers interrupt", () => {
  test("does not immediately stop the stream when sub-agents are running", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";
    state.parallelAgents = [createRunningAgent("task-agent")];

    simulateEnterDuringStreaming(state, "deferred message");

    // Stream should still be running
    expect(state.isStreaming).toBe(true);
    expect(state.interruptCalled).toBe(false);
    expect(state.streamFinalized).toBe(false);
    // Message should be stored for deferred interrupt, not sent
    expect(state.sentMessages).toHaveLength(0);
    expect(state.pendingInterruptMessage).toBe("deferred message");
  });

  test("fires the deferred interrupt when sub-agents complete", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";
    state.parallelAgents = [createRunningAgent("task-agent")];

    // User presses Enter — deferred
    simulateEnterDuringStreaming(state, "deferred message");
    expect(state.sentMessages).toHaveLength(0);

    // Sub-agent completes
    state.parallelAgents = [completeAgent(state.parallelAgents[0]!)];
    simulateSubagentsComplete(state);

    // Now the interrupt fires and message is sent
    expect(state.interruptCalled).toBe(true);
    expect(state.isStreaming).toBe(false);
    expect(state.sentMessages).toEqual(["deferred message"]);
    expect(state.pendingInterruptMessage).toBeNull();
  });

  test("waits for ALL sub-agents to finish before firing", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [
      createRunningAgent("agent-1"),
      createRunningAgent("agent-2"),
    ];

    simulateEnterDuringStreaming(state, "after both agents");

    // First agent completes but second is still running
    state.parallelAgents = [
      completeAgent(state.parallelAgents[0]!),
      state.parallelAgents[1]!, // still running
    ];
    simulateSubagentsComplete(state);

    // Should NOT have fired yet
    expect(state.sentMessages).toHaveLength(0);
    expect(state.isStreaming).toBe(true);

    // Second agent completes
    state.parallelAgents = state.parallelAgents.map(completeAgent);
    simulateSubagentsComplete(state);

    // Now it fires
    expect(state.sentMessages).toEqual(["after both agents"]);
    expect(state.isStreaming).toBe(false);
  });

  test("deferred interrupt clears pending state", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [createRunningAgent("agent")];

    simulateEnterDuringStreaming(state, "pending msg");
    expect(state.pendingInterruptMessage).toBe("pending msg");

    state.parallelAgents = [completeAgent(state.parallelAgents[0]!)];
    simulateSubagentsComplete(state);

    expect(state.pendingInterruptMessage).toBeNull();
    expect(state.pendingInterruptSkipUser).toBe(false);
  });

  test("pending agents include those with 'pending' status", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [{
      id: "agent-pending",
      name: "pending-agent",
      task: "Pending agent task",
      status: "pending",
      startedAt: new Date().toISOString(),
    }];

    simulateEnterDuringStreaming(state, "msg");

    // Should defer because agent is in "pending" status
    expect(state.isStreaming).toBe(true);
    expect(state.pendingInterruptMessage).toBe("msg");
    expect(state.sentMessages).toHaveLength(0);
  });
});

// ============================================================================
// COMBINED BEHAVIOR TESTS
// ============================================================================

describe("Combined Enter and Ctrl+D behavior during streaming", () => {
  test("Enter interrupts while Ctrl+D queues — different outcomes", () => {
    // Scenario: Two users interact differently during the same streaming state
    const stateEnter = createMockStreamState();
    stateEnter.isStreaming = true;
    stateEnter.streamingMessageId = "msg_1";

    const stateCtrlD = createMockStreamState();
    stateCtrlD.isStreaming = true;
    stateCtrlD.streamingMessageId = "msg_1";

    simulateEnterDuringStreaming(stateEnter, "interrupt me");
    simulateCtrlDDuringStreaming(stateCtrlD, "queue me");

    // Enter: stream stopped, message sent
    expect(stateEnter.isStreaming).toBe(false);
    expect(stateEnter.sentMessages).toEqual(["interrupt me"]);
    expect(stateEnter.queue).toHaveLength(0);

    // Ctrl+D: stream continues, message queued
    expect(stateCtrlD.isStreaming).toBe(true);
    expect(stateCtrlD.sentMessages).toHaveLength(0);
    expect(stateCtrlD.queue).toEqual(["queue me"]);
  });

  test("Ctrl+D queue is processed after Enter-triggered interrupt completes its new stream", () => {
    const state = createMockStreamState();
    state.isStreaming = true;

    // User queues a message with Ctrl+D
    simulateCtrlDDuringStreaming(state, "queued first");

    // Then user presses Enter — interrupts and sends immediately
    simulateEnterDuringStreaming(state, "interrupt now");

    expect(state.isStreaming).toBe(false);
    expect(state.sentMessages).toEqual(["interrupt now"]);
    // Queue still has the Ctrl+D message waiting for the next stream completion
    expect(state.queue).toEqual(["queued first"]);
  });

  test("Enter with sub-agents defers but Ctrl+D still queues independently", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [createRunningAgent("busy-agent")];

    // Ctrl+D queues a message
    simulateCtrlDDuringStreaming(state, "ctrl+d message");

    // Enter defers because sub-agents are active
    simulateEnterDuringStreaming(state, "enter message");

    expect(state.isStreaming).toBe(true);
    expect(state.queue).toEqual(["ctrl+d message"]);
    expect(state.pendingInterruptMessage).toBe("enter message");
    expect(state.sentMessages).toHaveLength(0);
  });
});
