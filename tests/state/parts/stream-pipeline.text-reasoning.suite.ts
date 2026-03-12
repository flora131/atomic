import { describe, expect, test } from "bun:test";
import {
  applyStreamPartEvent,
} from "@/state/parts/stream-pipeline.ts";
import {
  createAssistantMessage,
  createPartId,
  findReasoningPartBySource,
  registerStreamPipelineHooks,
} from "./stream-pipeline.fixtures.ts";

registerStreamPipelineHooks();

describe("applyStreamPartEvent - text and reasoning", () => {
  test("applies text delta to legacy content and parts", () => {
    const msg = createAssistantMessage();
    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: "Hello" });

    expect(next.content).toBe("Hello");
    expect(next.parts).toHaveLength(1);
    expect(next.parts?.[0]?.type).toBe("text");
  });

  test("updates thinking metadata without creating reasoning parts by default", () => {
    const msg = createAssistantMessage();
    const next = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 1200,
      thinkingText: "analyzing",
    });

    expect(next.thinkingMs).toBe(1200);
    expect(next.thinkingText).toBe("analyzing");
    expect(next.parts).toHaveLength(0);
  });

  test("maps workflow task updates with blockedBy into task-list parts", () => {
    const msg = createAssistantMessage();
    const next = applyStreamPartEvent(msg, {
      type: "task-list-update",
      tasks: [
        { id: "#1", title: "Plan", status: "completed", blockedBy: [] },
        { id: "#2", title: "Implement", status: "pending", blockedBy: ["#1"] },
      ],
    });

    const taskListPart = next.parts?.find((part) => part.type === "task-list");
    expect(taskListPart?.type).toBe("task-list");
    if (taskListPart?.type === "task-list") {
      expect(taskListPart.items).toEqual([
        { id: "#1", description: "Plan", status: "completed", blockedBy: [] },
        { id: "#2", description: "Implement", status: "pending", blockedBy: ["#1"] },
      ]);
    }
  });

  test("upserts task result parts from workflow task result envelopes", () => {
    const msg = createAssistantMessage();
    const withResult = applyStreamPartEvent(msg, {
      type: "task-result-upsert",
      envelope: {
        task_id: "#7",
        tool_name: "task",
        title: "Implement registry",
        status: "completed",
        output_text: "Implemented",
        envelope_text: "task_id: #7",
      },
    });

    const taskResultPart = withResult.parts?.find((part) => part.type === "task-result");
    expect(taskResultPart?.type).toBe("task-result");
    if (taskResultPart?.type === "task-result") {
      expect(taskResultPart.taskId).toBe("#7");
      expect(taskResultPart.status).toBe("completed");
      expect(taskResultPart.outputText).toBe("Implemented");
    }

    const updated = applyStreamPartEvent(withResult, {
      type: "task-result-upsert",
      envelope: {
        task_id: "#7",
        tool_name: "task",
        title: "Implement registry",
        status: "error",
        output_text: "Failed",
        error: "lint failed",
      },
    });

    const updatedTaskResultPart = updated.parts?.find((part) => part.type === "task-result");
    expect(updatedTaskResultPart?.type).toBe("task-result");
    if (updatedTaskResultPart?.type === "task-result") {
      expect(updatedTaskResultPart.status).toBe("error");
      expect(updatedTaskResultPart.error).toBe("lint failed");
      expect(updatedTaskResultPart.outputText).toBe("Failed");
    }
    expect((updated.parts ?? []).filter((part) => part.type === "task-result")).toHaveLength(1);
  });

  test("ignores workflow step events", () => {
    const msg = createAssistantMessage();
    const startedAt = "2026-03-01T00:00:00.000Z";
    const completedAt = "2026-03-01T00:00:02.000Z";

    const withStepStart = applyStreamPartEvent(msg, {
      type: "workflow-step-start",
      workflowId: "wf-1",
      nodeId: "worker",
      nodeName: "Worker Node",
      startedAt,
    });

    expect(withStepStart.parts ?? []).toHaveLength(0);

    const withStepComplete = applyStreamPartEvent(withStepStart, {
      type: "workflow-step-complete",
      workflowId: "wf-1",
      nodeId: "worker",
      status: "success",
      completedAt,
    });

    expect(withStepComplete.parts ?? []).toHaveLength(0);
  });

  test("streams thinking as a dedicated reasoning part when enabled", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 1200,
      thinkingText: "analyzing options",
      includeReasoningPart: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: "Final answer" });

    expect(next.content).toBe("Final answer");
    expect(next.parts?.map((part) => part.type)).toEqual(["reasoning", "text"]);

    const reasoningPart = next.parts?.[0];
    expect(reasoningPart?.type).toBe("reasoning");
    if (reasoningPart?.type === "reasoning") {
      expect(reasoningPart.content).toBe("analyzing options");
      expect(reasoningPart.durationMs).toBe(1200);
      expect(reasoningPart.isStreaming).toBe(true);
    }

    const textPart = next.parts?.[1];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Final answer");
    }
  });

  test("inserts late thinking metadata before text and updates same reasoning block", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Answer " });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 800,
      thinkingText: "initial thought",
      includeReasoningPart: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 1250,
      thinkingText: "initial thought with refinement",
      includeReasoningPart: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: "continues" });

    expect(next.parts?.map((part) => part.type)).toEqual(["reasoning", "text"]);
    expect(next.content).toBe("Answer continues");

    const reasoningPart = next.parts?.[0];
    expect(reasoningPart?.type).toBe("reasoning");
    if (reasoningPart?.type === "reasoning") {
      expect(reasoningPart.content).toBe("initial thought with refinement");
      expect(reasoningPart.durationMs).toBe(1250);
    }

    const textPart = next.parts?.[1];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Answer continues");
    }
  });

  test("upserts reasoning parts by thinking source key without cross-source overwrite", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 200,
      thinkingText: "alpha draft",
      includeReasoningPart: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 300,
      thinkingText: "beta draft",
      includeReasoningPart: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 420,
      thinkingText: "alpha refined",
      includeReasoningPart: true,
    });

    const next = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 560,
      thinkingText: "beta refined",
      includeReasoningPart: true,
    });

    const reasoningParts = (next.parts ?? []).filter((part) => part.type === "reasoning");
    expect(reasoningParts).toHaveLength(2);

    const sourceA = reasoningParts.find(
      (part) => part.type === "reasoning" && part.thinkingSourceKey === "source:a",
    );
    expect(sourceA?.type).toBe("reasoning");
    if (sourceA?.type === "reasoning") {
      expect(sourceA.content).toBe("alpha refined");
      expect(sourceA.durationMs).toBe(420);
      expect(sourceA.isStreaming).toBe(true);
    }

    const sourceB = reasoningParts.find(
      (part) => part.type === "reasoning" && part.thinkingSourceKey === "source:b",
    );
    expect(sourceB?.type).toBe("reasoning");
    if (sourceB?.type === "reasoning") {
      expect(sourceB.content).toBe("beta refined");
      expect(sourceB.durationMs).toBe(560);
      expect(sourceB.isStreaming).toBe(true);
    }
  });

  test("re-syncs per-source registry from reasoning parts when mapping is missing", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 200,
      thinkingText: "alpha draft",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 300,
      thinkingText: "beta draft",
      includeReasoningPart: true,
    });

    const sourceABefore = findReasoningPartBySource(msg, "source:a");
    const sourceBBefore = findReasoningPartBySource(msg, "source:b");
    expect(sourceABefore?.type).toBe("reasoning");
    expect(sourceBBefore?.type).toBe("reasoning");

    const messageWithoutRegistry = {
      ...msg,
      parts: [...(msg.parts ?? [])],
    };

    const next = applyStreamPartEvent(messageWithoutRegistry, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 560,
      thinkingText: "beta refined after clone",
      includeReasoningPart: true,
    });

    const sourceAAfter = findReasoningPartBySource(next, "source:a");
    expect(sourceAAfter?.type).toBe("reasoning");
    if (sourceAAfter?.type === "reasoning" && sourceABefore?.type === "reasoning") {
      expect(sourceAAfter.id).toBe(sourceABefore.id);
      expect(sourceAAfter.content).toBe("alpha draft");
      expect(sourceAAfter.durationMs).toBe(200);
    }

    const sourceBAfter = findReasoningPartBySource(next, "source:b");
    expect(sourceBAfter?.type).toBe("reasoning");
    if (sourceBAfter?.type === "reasoning" && sourceBBefore?.type === "reasoning") {
      expect(sourceBAfter.id).toBe(sourceBBefore.id);
      expect(sourceBAfter.content).toBe("beta refined after clone");
      expect(sourceBAfter.durationMs).toBe(560);
    }

    expect((next.parts ?? []).filter((part) => part.type === "reasoning")).toHaveLength(2);
  });

  test("re-syncs per-source registry when mapping points to a stale part id", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 200,
      thinkingText: "alpha draft",
      includeReasoningPart: true,
    });

    const sourceAInitial = findReasoningPartBySource(msg, "source:a");
    expect(sourceAInitial?.type).toBe("reasoning");
    if (sourceAInitial?.type === "reasoning") {
      sourceAInitial.id = createPartId();
    }

    const next = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 420,
      thinkingText: "alpha refined after stale mapping",
      includeReasoningPart: true,
    });

    const sourceAAfter = findReasoningPartBySource(next, "source:a");
    expect(sourceAAfter?.type).toBe("reasoning");
    if (sourceAAfter?.type === "reasoning" && sourceAInitial?.type === "reasoning") {
      expect(sourceAAfter.id).toBe(sourceAInitial.id);
      expect(sourceAAfter.content).toBe("alpha refined after stale mapping");
      expect(sourceAAfter.durationMs).toBe(420);
      expect(sourceAAfter.isStreaming).toBe(true);
    }

    expect((next.parts ?? []).filter((part) => part.type === "reasoning")).toHaveLength(1);
  });

  test("text-complete is a no-op in the reducer (reconciliation handled upstream)", () => {
    const msg = createAssistantMessage();
    const withDelta = applyStreamPartEvent(msg, { type: "text-delta", delta: "Hello" });
    const next = applyStreamPartEvent(withDelta, {
      type: "text-complete",
      fullText: "Hello World",
      messageId: "msg-test",
    });

    expect(next).toBe(withDelta);
    expect(next.content).toBe("Hello");
  });
});
