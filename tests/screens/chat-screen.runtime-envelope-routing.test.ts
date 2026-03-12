import { describe, expect, test } from "bun:test";
import { isRuntimeEnvelopePartEvent } from "@/state/chat/exports.ts";
import type { StreamPartEvent } from "@/state/parts/index.ts";

describe("isRuntimeEnvelopePartEvent", () => {
  test("returns true for workflow runtime envelope events", () => {
    const runtimeEvents: StreamPartEvent[] = [
      {
        type: "task-list-update",
        tasks: [
          { id: "#1", title: "Wire runtime envelopes", status: "in_progress" },
        ],
      },
      {
        type: "workflow-step-start",
        workflowId: "wf-1",
        nodeId: "planner",
        nodeName: "Planner",
      },
      {
        type: "workflow-step-complete",
        workflowId: "wf-1",
        nodeId: "planner",
        status: "success",
      },
      {
        type: "task-result-upsert",
        envelope: {
          task_id: "#1",
          tool_name: "task",
          title: "Wire runtime envelopes",
          status: "completed",
          output_text: "Done",
        },
      },
    ];

    for (const event of runtimeEvents) {
      expect(isRuntimeEnvelopePartEvent(event)).toBe(true);
    }
  });

  test("returns false for non-envelope stream events", () => {
    const nonEnvelopeEvents: StreamPartEvent[] = [
      { type: "text-delta", delta: "hello" },
      { type: "tool-start", toolId: "tool-1", toolName: "Read", input: {} },
      {
        type: "thinking-meta",
        thinkingSourceKey: "source-1",
        targetMessageId: "msg-1",
        streamGeneration: 1,
        thinkingText: "analysis",
        thinkingMs: 120,
      },
    ];

    for (const event of nonEnvelopeEvents) {
      expect(isRuntimeEnvelopePartEvent(event)).toBe(false);
    }
  });
});
