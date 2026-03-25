import { describe, expect, test } from "bun:test";
import type { WorkflowRuntimeTask } from "@/services/workflows/runtime-contracts.ts";
import {
  buildTaskResultEnvelope,
  formatTaskResultEnvelopeText,
} from "@/services/workflows/task-result-envelope.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTask(overrides?: Partial<WorkflowRuntimeTask>): WorkflowRuntimeTask {
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
    ...overrides,
  };
}

function createMinimalTask(overrides?: Partial<WorkflowRuntimeTask>): WorkflowRuntimeTask {
  return {
    id: "task-a",
    title: "Fallback",
    status: "in_progress",
    identity: {
      canonicalId: "task-a",
      providerBindings: {
        task_id: ["task-a"],
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatTaskResultEnvelopeText
// ---------------------------------------------------------------------------

describe("formatTaskResultEnvelopeText", () => {
  test("formats canonical task result envelope text", () => {
    expect(formatTaskResultEnvelopeText("#9", "All done")).toBe(
      "task_id: #9 (for resuming to continue this task if needed)\n\n<task_result>\nAll done\n</task_result>",
    );
  });

  test("handles empty output text", () => {
    const result = formatTaskResultEnvelopeText("#1", "");
    expect(result).toContain("task_id: #1");
    expect(result).toContain("<task_result>\n\n</task_result>");
  });

  test("handles multiline output text", () => {
    const output = "Line 1\nLine 2\nLine 3";
    const result = formatTaskResultEnvelopeText("#2", output);
    expect(result).toContain("Line 1\nLine 2\nLine 3");
    expect(result).toContain("<task_result>");
    expect(result).toContain("</task_result>");
  });

  test("preserves special characters in task ID", () => {
    const result = formatTaskResultEnvelopeText("task-with-dashes_and_underscores", "output");
    expect(result).toContain("task_id: task-with-dashes_and_underscores");
  });
});

// ---------------------------------------------------------------------------
// buildTaskResultEnvelope — success cases
// ---------------------------------------------------------------------------

describe("buildTaskResultEnvelope", () => {
  describe("success cases", () => {
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

    test("uses canonical ID from identity when available", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask({
          id: "#9",
          identity: {
            canonicalId: "#9",
            providerBindings: { task_id: ["#9"] },
          },
        }),
        result: { success: true, output: "done", agentId: "w1" },
      });

      expect(envelope.task_id).toBe("#9");
    });

    test("falls back to task.id when identity has no canonical ID", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask({
          id: "fallback-id",
          title: "Fallback test",
          identity: undefined,
        }),
        result: { success: true, output: "ok", agentId: "w1" },
      });

      expect(envelope.task_id).toBe("fallback-id");
    });

    test("includes output_structured when provided", () => {
      const structured = { metrics: { coverage: 95 }, status: "green" };
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "done", agentId: "w1" },
        outputStructured: structured,
      });

      expect(envelope.output_structured).toEqual(structured);
    });

    test("omits output_structured when not provided", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "done", agentId: "w1" },
      });

      expect(envelope.output_structured).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------

  describe("error cases", () => {
    test("sets status to error and includes error message on failure", () => {
      const envelope = buildTaskResultEnvelope({
        task: createMinimalTask(),
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

    test("omits error field when result is successful", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "ok", agentId: "w1" },
      });

      expect(envelope.error).toBeUndefined();
    });

    test("omits error field when failure has no error message", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: false, output: "", agentId: "w1" },
      });

      expect(envelope.status).toBe("error");
      expect(envelope.error).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Provider binding resolution
  // -----------------------------------------------------------------------

  describe("provider binding resolution", () => {
    test("uses first binding from the requested provider", () => {
      const task = createTask({
        identity: {
          canonicalId: "#9",
          providerBindings: {
            subagent_id: ["worker-first", "worker-second"],
            task_id: ["#9"],
          },
        },
      });

      const envelope = buildTaskResultEnvelope({
        task,
        result: { success: true, output: "ok", agentId: "worker-fallback" },
      });

      expect(envelope.metadata?.providerBindings?.subagent_id).toBe("worker-first");
    });

    test("falls back to result agent id when provider binding is unavailable", () => {
      const envelope = buildTaskResultEnvelope({
        task: createMinimalTask(),
        result: {
          agentId: "worker-a",
          success: false,
          output: "",
          error: "Worker failed",
        },
        sessionId: "session-xyz",
      });

      expect(envelope.metadata?.providerBindings?.subagent_id).toBe("worker-a");
    });

    test("uses custom provider name when specified", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask({
          identity: {
            canonicalId: "#9",
            providerBindings: {
              custom_provider: ["custom-id"],
              task_id: ["#9"],
            },
          },
        }),
        result: { success: true, output: "ok", agentId: "w1" },
        provider: "custom_provider",
      });

      expect(envelope.metadata?.providerBindings?.custom_provider).toBe("custom-id");
    });
  });

  // -----------------------------------------------------------------------
  // Tool name
  // -----------------------------------------------------------------------

  describe("tool name", () => {
    test("defaults tool_name to 'task'", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "ok", agentId: "w1" },
      });

      expect(envelope.tool_name).toBe("task");
    });

    test("uses custom tool name when provided", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "ok", agentId: "w1" },
        toolName: "code_review",
      });

      expect(envelope.tool_name).toBe("code_review");
    });

    test("trims whitespace from custom tool name", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "ok", agentId: "w1" },
        toolName: "  custom_tool  ",
      });

      expect(envelope.tool_name).toBe("custom_tool");
    });

    test("falls back to default when tool name is empty", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "ok", agentId: "w1" },
        toolName: "   ",
      });

      expect(envelope.tool_name).toBe("task");
    });
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  describe("metadata", () => {
    test("includes sessionId in metadata when provided", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "ok", agentId: "w1" },
        sessionId: "sess-abc",
      });

      expect(envelope.metadata?.sessionId).toBe("sess-abc");
    });

    test("includes agentId fallback in metadata even when no provider binding exists", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask({
          identity: {
            canonicalId: "#9",
            providerBindings: {},
          },
        }),
        result: { success: true, output: "ok", agentId: "fallback-agent" },
      });

      // agentId is used as fallback when no provider binding resolves
      expect(envelope.metadata?.providerBindings?.subagent_id).toBe("fallback-agent");
    });

    test("includes both sessionId and providerBindings when available", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "ok", agentId: "w1" },
        sessionId: "sess-xyz",
      });

      expect(envelope.metadata?.sessionId).toBe("sess-xyz");
      expect(envelope.metadata?.providerBindings).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Envelope text
  // -----------------------------------------------------------------------

  describe("envelope_text", () => {
    test("includes task_id reference in envelope text", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "Great work!", agentId: "w1" },
      });

      expect(envelope.envelope_text).toContain("task_id: #9");
      expect(envelope.envelope_text).toContain("<task_result>");
      expect(envelope.envelope_text).toContain("Great work!");
      expect(envelope.envelope_text).toContain("</task_result>");
    });

    test("handles empty output in envelope text", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "", agentId: "w1" },
      });

      expect(envelope.envelope_text).toContain("task_id: #9");
      expect(envelope.output_text).toBe("");
    });

    test("handles non-string output gracefully", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: undefined as unknown as string, agentId: "w1" },
      });

      expect(envelope.output_text).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // Output text
  // -----------------------------------------------------------------------

  describe("output_text", () => {
    test("stores output text from result", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: "Implementation complete.", agentId: "w1" },
      });

      expect(envelope.output_text).toBe("Implementation complete.");
    });

    test("defaults to empty string for missing output", () => {
      const envelope = buildTaskResultEnvelope({
        task: createTask(),
        result: { success: true, output: undefined as unknown as string, agentId: "w1" },
      });

      expect(envelope.output_text).toBe("");
    });
  });
});
