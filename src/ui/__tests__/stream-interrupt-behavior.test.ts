/**
 * Stream Interrupt Behavior Tests
 *
 * Core rules covered:
 * 1) Enter during streaming interrupts immediately (unless sub-agents are active)
 * 2) Ctrl+D always queues without interrupting (including when a tool is running)
 * 3) With active sub-agents, Enter also queues and waits for stream completion
 */

import { describe, test, expect } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

interface MockStreamState {
  isStreaming: boolean;
  streamingMessageId: string | null;
  parallelAgents: ParallelAgent[];
  queue: string[];
  sentMessages: string[];
  interruptCalled: boolean;
  streamFinalized: boolean;
  hasRunningTool: boolean;
}

function createMockStreamState(): MockStreamState {
  return {
    isStreaming: false,
    streamingMessageId: null,
    parallelAgents: [],
    queue: [],
    sentMessages: [],
    interruptCalled: false,
    streamFinalized: false,
    hasRunningTool: false,
  };
}

function hasActiveSubagents(parallelAgents: ParallelAgent[]): boolean {
  return parallelAgents.some((a) => a.status === "running" || a.status === "pending");
}

function simulateEnterDuringStreaming(state: MockStreamState, message: string): void {
  if (!state.isStreaming) {
    state.sentMessages.push(message);
    return;
  }

  if (hasActiveSubagents(state.parallelAgents)) {
    state.queue.push(message);
    return;
  }

  state.streamFinalized = true;
  state.isStreaming = false;
  state.interruptCalled = true;
  state.sentMessages.push(message);
}

function simulateCtrlDDuringStreaming(state: MockStreamState, message: string): void {
  if (!state.isStreaming) return;
  if (!message.trim()) return;
  state.queue.push(message);
}

function simulateSubagentsComplete(state: MockStreamState): void {
  if (hasActiveSubagents(state.parallelAgents)) return;
  // Queue processing is driven by stream completion, not agent completion.
}

function simulateStreamCompletion(state: MockStreamState): void {
  state.isStreaming = false;
  state.streamFinalized = true;
  if (state.queue.length > 0) {
    state.sentMessages.push(state.queue.shift()!);
  }
}

function createRunningAgent(name: string): ParallelAgent {
  return {
    id: `agent-${name}`,
    name,
    task: `Task for ${name}`,
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

describe("Enter during streaming interrupts when no sub-agents are active", () => {
  test("interrupts stream immediately and sends message", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.streamingMessageId = "msg_1";

    simulateEnterDuringStreaming(state, "follow-up question");

    expect(state.isStreaming).toBe(false);
    expect(state.interruptCalled).toBe(true);
    expect(state.streamFinalized).toBe(true);
    expect(state.sentMessages).toEqual(["follow-up question"]);
    expect(state.queue).toEqual([]);
  });
});

describe("Ctrl+D during streaming always queues", () => {
  test("queues without interrupting", () => {
    const state = createMockStreamState();
    state.isStreaming = true;

    simulateCtrlDDuringStreaming(state, "queued message");

    expect(state.isStreaming).toBe(true);
    expect(state.interruptCalled).toBe(false);
    expect(state.queue).toEqual(["queued message"]);
    expect(state.sentMessages).toEqual([]);
  });

  test("still queues when a tool is running", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.hasRunningTool = true;

    simulateCtrlDDuringStreaming(state, "tool-time queued");

    expect(state.queue).toEqual(["tool-time queued"]);
    expect(state.sentMessages).toEqual([]);
    expect(state.interruptCalled).toBe(false);
  });

  test("dequeues on stream completion", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    simulateCtrlDDuringStreaming(state, "deferred message");

    simulateStreamCompletion(state);

    expect(state.sentMessages).toEqual(["deferred message"]);
    expect(state.queue).toEqual([]);
  });
});

describe("Active sub-agent behavior", () => {
  test("Enter queues (does not interrupt) while sub-agents are active", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [createRunningAgent("task-agent")];

    simulateEnterDuringStreaming(state, "queue this");

    expect(state.isStreaming).toBe(true);
    expect(state.interruptCalled).toBe(false);
    expect(state.streamFinalized).toBe(false);
    expect(state.queue).toEqual(["queue this"]);
    expect(state.sentMessages).toEqual([]);
  });

  test("queue waits for stream completion even after sub-agents finish", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [createRunningAgent("task-agent")];

    simulateEnterDuringStreaming(state, "after sub-agents");
    state.parallelAgents = [completeAgent(state.parallelAgents[0]!)];
    simulateSubagentsComplete(state);

    expect(state.queue).toEqual(["after sub-agents"]);
    expect(state.sentMessages).toEqual([]);
    expect(state.isStreaming).toBe(true);

    simulateStreamCompletion(state);

    expect(state.sentMessages).toEqual(["after sub-agents"]);
    expect(state.queue).toEqual([]);
  });

  test("pending status counts as active sub-agent work", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [{
      id: "agent-pending",
      name: "pending-agent",
      task: "Pending task",
      status: "pending",
      startedAt: new Date().toISOString(),
    }];

    simulateEnterDuringStreaming(state, "queued while pending");

    expect(state.interruptCalled).toBe(false);
    expect(state.queue).toEqual(["queued while pending"]);
    expect(state.sentMessages).toEqual([]);
  });
});

describe("Combined Enter + Ctrl+D scenarios", () => {
  test("Enter interrupts while Ctrl+D queues when no active sub-agents", () => {
    const enterState = createMockStreamState();
    enterState.isStreaming = true;
    const ctrlDState = createMockStreamState();
    ctrlDState.isStreaming = true;

    simulateEnterDuringStreaming(enterState, "interrupt me");
    simulateCtrlDDuringStreaming(ctrlDState, "queue me");

    expect(enterState.sentMessages).toEqual(["interrupt me"]);
    expect(enterState.queue).toEqual([]);
    expect(ctrlDState.sentMessages).toEqual([]);
    expect(ctrlDState.queue).toEqual(["queue me"]);
  });

  test("with active sub-agents, both Enter and Ctrl+D queue", () => {
    const state = createMockStreamState();
    state.isStreaming = true;
    state.parallelAgents = [createRunningAgent("busy-agent")];

    simulateCtrlDDuringStreaming(state, "ctrl+d message");
    simulateEnterDuringStreaming(state, "enter message");

    expect(state.interruptCalled).toBe(false);
    expect(state.queue).toEqual(["ctrl+d message", "enter message"]);
    expect(state.sentMessages).toEqual([]);
  });
});
