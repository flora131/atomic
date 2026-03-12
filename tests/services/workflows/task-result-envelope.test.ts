import { describe, expect, test } from "bun:test";
import type { WorkflowRuntimeTask } from "@/services/workflows/runtime-contracts.ts";
import {
  buildTaskResultEnvelope,
  formatTaskResultEnvelopeText,
} from "@/services/workflows/task-result-envelope.ts";

function createTask(): WorkflowRuntimeTask {
  return {
    id: "#9",
    title: "Implement task result envelope",
    status: "in_progress",
    identity: {
      canonicalId: "#9",
      providerBindings: {
        task_id: ["#9", "9"],
        subagent_id: ["worker-9"],
      },
    },
  };
}

describe("task-result-envelope", () => {
  test("formats canonical task result envelope text", () => {
    expect(formatTaskResultEnvelopeText("#9", "All done")).toBe(
      "task_id: #9 (for resuming to continue this task if needed)\n\n<task_result>\nAll done\n</task_result>",
    );
  });

  test("builds envelope from task identity and provider binding", () => {
    const envelope = buildTaskResultEnvelope({
      task: createTask(),
      result: {
        agentId: "worker-9",
        success: true,
        output: "Implemented and tested.",
      },
      sessionId: "session-123",
    });

    expect(envelope).toMatchObject({
      task_id: "#9",
      tool_name: "task",
      title: "Implement task result envelope",
      metadata: {
        sessionId: "session-123",
        providerBindings: {
          subagent_id: "worker-9",
        },
      },
      status: "completed",
      output_text: "Implemented and tested.",
    });
    expect(envelope.envelope_text).toContain("task_id: #9");
    expect(envelope.envelope_text).toContain("<task_result>");
  });

  test("falls back to result agent id when provider binding is unavailable", () => {
    const envelope = buildTaskResultEnvelope({
      task: {
        id: "task-a",
        title: "Fallback",
        status: "in_progress",
        identity: {
          canonicalId: "task-a",
          providerBindings: {
            task_id: ["task-a"],
          },
        },
      },
      result: {
        agentId: "worker-a",
        success: false,
        output: "",
        error: "Worker failed",
      },
      sessionId: "session-xyz",
    });

    expect(envelope.status).toBe("error");
    expect(envelope.error).toBe("Worker failed");
    expect(envelope.metadata?.providerBindings?.subagent_id).toBe("worker-a");
  });
});
