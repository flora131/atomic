/**
 * Tests for applyWorkflowStepCompleteByNodeScan.
 *
 * Validates that workflow-step-complete events are routed to the correct
 * message by scanning for the matching WorkflowStepPart, rather than
 * relying on a potentially stale streamingMessageIdRef.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import type { SetStateAction } from "react";
import { applyWorkflowStepCompleteByNodeScan } from "@/state/chat/stream/part-batch.ts";
import { upsertWorkflowStepStart } from "@/state/streaming/pipeline-workflow.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import type { ChatMessage } from "@/types/chat.ts";
import type { Part, WorkflowStepPart } from "@/state/parts/types.ts";
import type { WorkflowStepCompleteEvent } from "@/state/streaming/pipeline-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let messageCounter = 0;

function createMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  messageCounter += 1;
  return {
    id: `msg-${messageCounter}`,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    parts: [],
    ...overrides,
  } as ChatMessage;
}

function addRunningStep(parts: Part[], nodeId: string, workflowId = "ralph"): Part[] {
  return upsertWorkflowStepStart(parts, {
    type: "workflow-step-start",
    workflowId,
    nodeId,
    indicator: `⌕ ${nodeId.toUpperCase()}`,
  });
}

function completeEvent(nodeId: string, workflowId = "ralph"): WorkflowStepCompleteEvent {
  return {
    type: "workflow-step-complete",
    workflowId,
    nodeId,
    status: "completed",
    durationMs: 5000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyWorkflowStepCompleteByNodeScan", () => {
  beforeEach(() => {
    _resetPartCounter();
    messageCounter = 0;
  });

  test("completes a step in the correct message when multiple messages exist", () => {
    // Simulate the race: planner step is in msg-1, but streamingMessageIdRef
    // would now point to msg-2 (the orchestrator's message).
    const plannerParts = addRunningStep([], "planner");
    const plannerMessage = createMessage({ parts: plannerParts });

    const orchestratorParts = addRunningStep([], "orchestrator");
    const orchestratorMessage = createMessage({ parts: orchestratorParts });

    let messages = [plannerMessage, orchestratorMessage];

    // Apply workflow-step-complete for planner via node scan
    const setMessages = (action: SetStateAction<ChatMessage[]>) => {
      const updater = typeof action === "function" ? action : () => action;
      messages = updater(messages);
    };
    applyWorkflowStepCompleteByNodeScan(completeEvent("planner"), setMessages);

    // Planner message should be updated to "completed"
    const plannerStep = messages[0]!.parts![0] as WorkflowStepPart;
    expect(plannerStep.nodeId).toBe("planner");
    expect(plannerStep.status).toBe("completed");
    expect(plannerStep.durationMs).toBe(5000);

    // Orchestrator message should remain "running"
    const orchStep = messages[1]!.parts![0] as WorkflowStepPart;
    expect(orchStep.nodeId).toBe("orchestrator");
    expect(orchStep.status).toBe("running");
  });

  test("does not modify messages that lack a matching WorkflowStepPart", () => {
    const textMessage = createMessage({
      content: "Hello world",
      parts: [{
        id: "text-1" as Part["id"],
        type: "text",
        content: "Hello world",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      }],
    });
    const plannerParts = addRunningStep([], "planner");
    const plannerMessage = createMessage({ parts: plannerParts });

    let messages = [textMessage, plannerMessage];

    const setMessages = (action: SetStateAction<ChatMessage[]>) => {
      const updater = typeof action === "function" ? action : () => action;
      messages = updater(messages);
    };
    applyWorkflowStepCompleteByNodeScan(completeEvent("planner"), setMessages);

    // Text message untouched (same reference)
    expect(messages[0]).toBe(textMessage);

    // Planner message updated
    const step = messages[1]!.parts![0] as WorkflowStepPart;
    expect(step.status).toBe("completed");
  });

  test("matches by both nodeId and workflowId", () => {
    // Two different workflows with the same nodeId
    const wf1Parts = addRunningStep([], "planner", "workflow-a");
    const wf1Message = createMessage({ parts: wf1Parts });

    const wf2Parts = addRunningStep([], "planner", "workflow-b");
    const wf2Message = createMessage({ parts: wf2Parts });

    let messages = [wf1Message, wf2Message];

    const setMessages = (action: SetStateAction<ChatMessage[]>) => {
      const updater = typeof action === "function" ? action : () => action;
      messages = updater(messages);
    };
    applyWorkflowStepCompleteByNodeScan(completeEvent("planner", "workflow-b"), setMessages);

    // workflow-a's planner should remain running
    const wf1Step = messages[0]!.parts![0] as WorkflowStepPart;
    expect(wf1Step.status).toBe("running");

    // workflow-b's planner should be completed
    const wf2Step = messages[1]!.parts![0] as WorkflowStepPart;
    expect(wf2Step.status).toBe("completed");
  });

  test("no-ops gracefully when no message contains the target step", () => {
    const textMessage = createMessage({
      parts: [{
        id: "text-1" as Part["id"],
        type: "text",
        content: "Hello",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      }],
    });

    let messages = [textMessage];

    const setMessages = (action: SetStateAction<ChatMessage[]>) => {
      const updater = typeof action === "function" ? action : () => action;
      messages = updater(messages);
    };
    applyWorkflowStepCompleteByNodeScan(completeEvent("planner"), setMessages);

    // Message unchanged (same reference — no match found)
    expect(messages[0]).toBe(textMessage);
  });
});
