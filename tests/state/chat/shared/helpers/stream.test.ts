import { describe, expect, test } from "bun:test";
import {
  isRuntimeEnvelopePartEvent,
  isWorkflowBypassEvent,
  shouldProcessStreamLifecycleEvent,
  shouldBindStreamSessionRun,
  shouldProcessStreamPartEvent,
  shouldFinalizeAgentOnlyStream,
  shouldDeferPostCompleteDeltaUntilDoneProjection,
  queueAgentTerminalBeforeDeferredDeltas,
} from "@/state/chat/shared/helpers/stream.ts";
import type { StreamPartEvent } from "@/state/parts/index.ts";
import type { AgentTerminalEvent } from "@/state/streaming/pipeline-types.ts";

// ---------------------------------------------------------------------------
// Helpers -- minimal StreamPartEvent factories
// ---------------------------------------------------------------------------

function makeEvent(type: StreamPartEvent["type"]): StreamPartEvent {
  switch (type) {
    case "text-delta":
      return { type, delta: "" };
    case "text-complete":
      return { type, fullText: "", messageId: "m1" };
    case "thinking-meta":
      return {
        type,
        thinkingSourceKey: "k",
        targetMessageId: "m1",
        streamGeneration: 0,
        thinkingText: "",
        thinkingMs: 0,
      };
    case "thinking-complete":
      return { type, sourceKey: "k", durationMs: 0 };
    case "tool-start":
      return { type, toolId: "t1", toolName: "run", input: {} };
    case "tool-complete":
      return { type, toolId: "t1", output: null, success: true };
    case "tool-partial-result":
      return { type, toolId: "t1", partialOutput: "" };
    case "tool-hitl-request":
      return {
        type,
        toolId: "t1",
        request: {
          requestId: "r1",
          header: "",
          question: "",
          options: [],
          multiSelect: false,
          respond: () => {},
        },
      };
    case "tool-hitl-response":
      return {
        type,
        toolId: "t1",
        response: {
          cancelled: false,
          responseMode: "option",
          answerText: "yes",
          displayText: "yes",
        },
      };
    case "parallel-agents":
      return { type, agents: [], isLastMessage: false };
    case "agent-terminal":
      return { type, agentId: "a1", status: "completed" };
    case "task-list-update":
      return { type, tasks: [] };
    case "task-result-upsert":
      return {
        type,
        envelope: {
          task_id: "t1",
          tool_name: "test-tool",
          title: "Test Task",
          status: "completed",
          output_text: "ok",
        },
      };
    case "workflow-step-start":
      return { type, workflowId: "w1", nodeId: "n1", indicator: "Running..." };
    case "workflow-step-complete":
      return {
        type,
        workflowId: "w1",
        nodeId: "n1",
        status: "completed",
        durationMs: 100,
      };
  }
}

/** Type-safe helper to extract AgentTerminalEvent from a captured StreamPartEvent. */
function asAgentTerminal(event: StreamPartEvent): AgentTerminalEvent {
  if (event.type !== "agent-terminal") {
    throw new Error(`Expected agent-terminal, got ${event.type}`);
  }
  return event;
}

// ---------------------------------------------------------------------------
// isRuntimeEnvelopePartEvent
// ---------------------------------------------------------------------------

describe("isRuntimeEnvelopePartEvent", () => {
  const RUNTIME_TYPES: StreamPartEvent["type"][] = [
    "task-list-update",
    "task-result-upsert",
    "workflow-step-start",
    "workflow-step-complete",
  ];

  const NON_RUNTIME_TYPES: StreamPartEvent["type"][] = [
    "text-delta",
    "text-complete",
    "thinking-meta",
    "thinking-complete",
    "tool-start",
    "tool-complete",
    "tool-partial-result",
    "tool-hitl-request",
    "tool-hitl-response",
    "parallel-agents",
    "agent-terminal",
  ];

  for (const type of RUNTIME_TYPES) {
    test(`returns true for "${type}"`, () => {
      expect(isRuntimeEnvelopePartEvent(makeEvent(type))).toBe(true);
    });
  }

  for (const type of NON_RUNTIME_TYPES) {
    test(`returns false for "${type}"`, () => {
      expect(isRuntimeEnvelopePartEvent(makeEvent(type))).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// isWorkflowBypassEvent
// ---------------------------------------------------------------------------

describe("isWorkflowBypassEvent", () => {
  const BYPASS_TYPES: StreamPartEvent["type"][] = [
    "workflow-step-start",
    "workflow-step-complete",
    "task-list-update",
  ];

  const NON_BYPASS_TYPES: StreamPartEvent["type"][] = [
    "text-delta",
    "text-complete",
    "thinking-meta",
    "thinking-complete",
    "tool-start",
    "tool-complete",
    "tool-partial-result",
    "tool-hitl-request",
    "tool-hitl-response",
    "parallel-agents",
    "agent-terminal",
    "task-result-upsert",
  ];

  for (const type of BYPASS_TYPES) {
    test(`returns true for "${type}"`, () => {
      expect(isWorkflowBypassEvent(makeEvent(type))).toBe(true);
    });
  }

  for (const type of NON_BYPASS_TYPES) {
    test(`returns false for "${type}"`, () => {
      expect(isWorkflowBypassEvent(makeEvent(type))).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// shouldProcessStreamLifecycleEvent
// ---------------------------------------------------------------------------

describe("shouldProcessStreamLifecycleEvent", () => {
  test("returns false when activeRunId is null", () => {
    expect(shouldProcessStreamLifecycleEvent(null, 1)).toBe(false);
  });

  test("returns false when activeRunId is null and eventRunId is 0", () => {
    expect(shouldProcessStreamLifecycleEvent(null, 0)).toBe(false);
  });

  test("returns true when activeRunId equals eventRunId", () => {
    expect(shouldProcessStreamLifecycleEvent(5, 5)).toBe(true);
  });

  test("returns true when both are 0", () => {
    expect(shouldProcessStreamLifecycleEvent(0, 0)).toBe(true);
  });

  test("returns false when activeRunId differs from eventRunId", () => {
    expect(shouldProcessStreamLifecycleEvent(5, 6)).toBe(false);
  });

  test("returns false when activeRunId is non-null but different from eventRunId", () => {
    expect(shouldProcessStreamLifecycleEvent(10, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldBindStreamSessionRun
// ---------------------------------------------------------------------------

describe("shouldBindStreamSessionRun", () => {
  test("returns false when not streaming", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: 1,
        isStreaming: false,
        nextRunIdFloor: null,
      }),
    ).toBe(false);
  });

  test("returns false when not streaming even if activeRunId matches eventRunId", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: 5,
        eventRunId: 5,
        isStreaming: false,
        nextRunIdFloor: null,
      }),
    ).toBe(false);
  });

  test("returns false when eventRunId is below nextRunIdFloor", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: 3,
        isStreaming: true,
        nextRunIdFloor: 5,
      }),
    ).toBe(false);
  });

  test("returns false when eventRunId equals nextRunIdFloor minus 1", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: 4,
        isStreaming: true,
        nextRunIdFloor: 5,
      }),
    ).toBe(false);
  });

  test("returns true when activeRunId is null and streaming, no floor constraint", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: 1,
        isStreaming: true,
        nextRunIdFloor: null,
      }),
    ).toBe(true);
  });

  test("returns true when activeRunId is null and eventRunId equals nextRunIdFloor", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: 5,
        isStreaming: true,
        nextRunIdFloor: 5,
      }),
    ).toBe(true);
  });

  test("returns true when activeRunId is null and eventRunId is above nextRunIdFloor", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: 10,
        isStreaming: true,
        nextRunIdFloor: 5,
      }),
    ).toBe(true);
  });

  test("returns true when activeRunId equals eventRunId", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: 7,
        eventRunId: 7,
        isStreaming: true,
        nextRunIdFloor: null,
      }),
    ).toBe(true);
  });

  test("returns false when activeRunId is set but does not match eventRunId", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: 7,
        eventRunId: 8,
        isStreaming: true,
        nextRunIdFloor: null,
      }),
    ).toBe(false);
  });

  test("returns true when activeRunId matches and eventRunId is above floor", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: 10,
        eventRunId: 10,
        isStreaming: true,
        nextRunIdFloor: 5,
      }),
    ).toBe(true);
  });

  test("returns false when activeRunId is set, mismatched, and eventRunId below floor", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: 10,
        eventRunId: 3,
        isStreaming: true,
        nextRunIdFloor: 5,
      }),
    ).toBe(false);
  });

  test("returns false when nextRunIdFloor is 0 and eventRunId is negative", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: -1,
        isStreaming: true,
        nextRunIdFloor: 0,
      }),
    ).toBe(false);
  });

  test("returns true when nextRunIdFloor is 0 and eventRunId is 0", () => {
    expect(
      shouldBindStreamSessionRun({
        activeRunId: null,
        eventRunId: 0,
        isStreaming: true,
        nextRunIdFloor: 0,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldProcessStreamPartEvent
// ---------------------------------------------------------------------------

describe("shouldProcessStreamPartEvent", () => {
  test("returns true when partRunId is undefined", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: 5,
        partRunId: undefined,
        isStreaming: true,
      }),
    ).toBe(true);
  });

  test("returns true when partRunId is undefined and activeRunId is null", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: null,
        partRunId: undefined,
        isStreaming: false,
      }),
    ).toBe(true);
  });

  test("returns true when partRunId is undefined and not streaming", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: null,
        partRunId: undefined,
        isStreaming: false,
      }),
    ).toBe(true);
  });

  test("returns false when activeRunId is null and isStreaming is true", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: null,
        partRunId: 1,
        isStreaming: true,
      }),
    ).toBe(false);
  });

  test("returns true when activeRunId is null and isStreaming is false", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: null,
        partRunId: 1,
        isStreaming: false,
      }),
    ).toBe(true);
  });

  test("returns true when partRunId matches activeRunId", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: 7,
        partRunId: 7,
        isStreaming: true,
      }),
    ).toBe(true);
  });

  test("returns false when partRunId does not match activeRunId", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: 7,
        partRunId: 8,
        isStreaming: true,
      }),
    ).toBe(false);
  });

  test("returns false when partRunId does not match activeRunId (not streaming)", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: 7,
        partRunId: 8,
        isStreaming: false,
      }),
    ).toBe(false);
  });

  test("returns true when partRunId matches activeRunId (not streaming)", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: 3,
        partRunId: 3,
        isStreaming: false,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldFinalizeAgentOnlyStream
// ---------------------------------------------------------------------------

describe("shouldFinalizeAgentOnlyStream", () => {
  test("returns true when all booleans are true and liveAgentCount > 0", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 2,
        messageAgentCount: 0,
      }),
    ).toBe(true);
  });

  test("returns true when all booleans are true and messageAgentCount > 0", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 0,
        messageAgentCount: 1,
      }),
    ).toBe(true);
  });

  test("returns true when all booleans are true and both counts > 0", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 3,
        messageAgentCount: 2,
      }),
    ).toBe(true);
  });

  test("returns false when hasStreamingMessage is false", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: false,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 1,
        messageAgentCount: 1,
      }),
    ).toBe(false);
  });

  test("returns false when isStreaming is false", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: false,
        isAgentOnlyStream: true,
        liveAgentCount: 1,
        messageAgentCount: 1,
      }),
    ).toBe(false);
  });

  test("returns false when isAgentOnlyStream is false", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: false,
        liveAgentCount: 1,
        messageAgentCount: 1,
      }),
    ).toBe(false);
  });

  test("returns false when both agent counts are 0", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 0,
        messageAgentCount: 0,
      }),
    ).toBe(false);
  });

  test("returns false when all flags are false and counts are 0", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: false,
        isStreaming: false,
        isAgentOnlyStream: false,
        liveAgentCount: 0,
        messageAgentCount: 0,
      }),
    ).toBe(false);
  });

  test("returns false when only one boolean is false (exhaustive)", () => {
    // isStreaming false
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: false,
        isAgentOnlyStream: true,
        liveAgentCount: 5,
        messageAgentCount: 5,
      }),
    ).toBe(false);

    // hasStreamingMessage false
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: false,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 5,
        messageAgentCount: 5,
      }),
    ).toBe(false);

    // isAgentOnlyStream false
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: false,
        liveAgentCount: 5,
        messageAgentCount: 5,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldDeferPostCompleteDeltaUntilDoneProjection
// ---------------------------------------------------------------------------

describe("shouldDeferPostCompleteDeltaUntilDoneProjection", () => {
  test("returns true when completionSequence is a number and doneProjected is false", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: 0,
        doneProjected: false,
      }),
    ).toBe(true);
  });

  test("returns true with a positive completionSequence and doneProjected false", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: 42,
        doneProjected: false,
      }),
    ).toBe(true);
  });

  test("returns false when completionSequence is a number but doneProjected is true", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: 1,
        doneProjected: true,
      }),
    ).toBe(false);
  });

  test("returns false when completionSequence is undefined and doneProjected is false", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: undefined,
        doneProjected: false,
      }),
    ).toBe(false);
  });

  test("returns false when completionSequence is undefined and doneProjected is true", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: undefined,
        doneProjected: true,
      }),
    ).toBe(false);
  });

  test("returns true with completionSequence of 0 (edge: falsy number)", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: 0,
        doneProjected: false,
      }),
    ).toBe(true);
  });

  test("returns false with completionSequence of 0 when doneProjected is true", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: 0,
        doneProjected: true,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// queueAgentTerminalBeforeDeferredDeltas
// ---------------------------------------------------------------------------

describe("queueAgentTerminalBeforeDeferredDeltas", () => {
  /** Capture calls to the two callback arguments. */
  function createCapture() {
    const calls: Array<{ messageId: string; update: StreamPartEvent }> = [];
    const flushCalls: string[] = [];
    return {
      calls,
      flushCalls,
      queueMessagePartUpdate: (mid: string, update: StreamPartEvent) => {
        calls.push({ messageId: mid, update });
      },
      flushDeferredPostCompleteDeltas: (agentId: string) => {
        flushCalls.push(agentId);
      },
    };
  }

  test("calls queueMessagePartUpdate with terminal event data", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "msg-1",
      terminal: {
        type: "agent-terminal",
        runId: 10,
        agentId: "agent-A",
        status: "completed",
        result: "done",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    expect(capture.calls).toHaveLength(1);
    const entry = capture.calls[0]!;
    expect(entry.messageId).toBe("msg-1");
    const update = asAgentTerminal(entry.update);
    expect(update.agentId).toBe("agent-A");
    expect(update.status).toBe("completed");
    expect(update.runId).toBe(10);
    expect(update.result).toBe("done");
  });

  test("calls flushDeferredPostCompleteDeltas when status is 'completed'", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "msg-1",
      terminal: {
        type: "agent-terminal",
        runId: 10,
        agentId: "agent-A",
        status: "completed",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    expect(capture.flushCalls).toHaveLength(1);
    expect(capture.flushCalls[0]).toBe("agent-A");
  });

  test("does NOT call flushDeferredPostCompleteDeltas when status is 'error'", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "msg-2",
      terminal: {
        type: "agent-terminal",
        runId: 5,
        agentId: "agent-B",
        status: "error",
        error: "something broke",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    expect(capture.flushCalls).toHaveLength(0);
  });

  test("includes result field in queued event when present", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "a1",
        status: "completed",
        result: "final-answer",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.result).toBe("final-answer");
  });

  test("excludes result field when not present on terminal", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "a1",
        status: "completed",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.result).toBeUndefined();
    expect("result" in update).toBe(false);
  });

  test("includes error field when present", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "a1",
        status: "error",
        error: "crash",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.error).toBe("crash");
  });

  test("excludes error field when not present", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "a1",
        status: "completed",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.error).toBeUndefined();
    expect("error" in update).toBe(false);
  });

  test("includes completedAt field when present", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "a1",
        status: "completed",
        completedAt: "2026-01-01T00:00:00Z",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.completedAt).toBe("2026-01-01T00:00:00Z");
  });

  test("excludes completedAt field when not present", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "a1",
        status: "completed",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.completedAt).toBeUndefined();
    expect("completedAt" in update).toBe(false);
  });

  test("calls queueMessagePartUpdate before flushDeferredPostCompleteDeltas", () => {
    const callOrder: string[] = [];

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "a1",
        status: "completed",
      },
      queueMessagePartUpdate: () => {
        callOrder.push("queue");
      },
      flushDeferredPostCompleteDeltas: () => {
        callOrder.push("flush");
      },
    });

    expect(callOrder).toEqual(["queue", "flush"]);
  });

  test("passes all optional fields when all are present", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m-full",
      terminal: {
        type: "agent-terminal",
        runId: 99,
        agentId: "agent-full",
        status: "completed",
        result: "complete-result",
        error: "some-warning",
        completedAt: "2026-03-25T12:00:00Z",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    expect(capture.calls).toHaveLength(1);
    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.type).toBe("agent-terminal");
    expect(update.runId).toBe(99);
    expect(update.agentId).toBe("agent-full");
    expect(update.status).toBe("completed");
    expect(update.result).toBe("complete-result");
    expect(update.error).toBe("some-warning");
    expect(update.completedAt).toBe("2026-03-25T12:00:00Z");
    expect(capture.flushCalls).toEqual(["agent-full"]);
  });

  test("handles terminal with no optional fields and error status", () => {
    const capture = createCapture();

    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "m-bare",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "bare-agent",
        status: "error",
      },
      queueMessagePartUpdate: capture.queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: capture.flushDeferredPostCompleteDeltas,
    });

    expect(capture.calls).toHaveLength(1);
    const update = asAgentTerminal(capture.calls[0]!.update);
    expect(update.type).toBe("agent-terminal");
    expect(update.agentId).toBe("bare-agent");
    expect(update.status).toBe("error");
    expect("result" in update).toBe(false);
    expect("error" in update).toBe(false);
    expect("completedAt" in update).toBe(false);
    // flush should NOT be called for error status
    expect(capture.flushCalls).toHaveLength(0);
  });
});
