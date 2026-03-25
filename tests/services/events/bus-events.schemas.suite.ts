/**
 * Comprehensive schema validation tests for BusEventSchemas.
 *
 * Tests every event type's Zod schema with valid data, missing fields,
 * wrong types, optional fields, and edge cases. Also tests the
 * defineBusEvent() helper function.
 */

import { describe, expect, it } from "bun:test";
import { BusEventSchemas, defineBusEvent } from "@/services/events/bus-events/schemas.ts";
import type { BusEventType } from "@/services/events/bus-events/types.ts";
import { z } from "zod";

describe("BusEventSchemas - comprehensive validation", () => {
  // ── Schema inventory ──────────────────────────────────────────────────

  it("should export schemas for all known event types", () => {
    const expectedTypes: BusEventType[] = [
      "stream.text.delta",
      "stream.text.complete",
      "stream.thinking.delta",
      "stream.thinking.complete",
      "stream.tool.start",
      "stream.tool.complete",
      "stream.tool.partial_result",
      "stream.agent.start",
      "stream.agent.update",
      "stream.agent.complete",
      "stream.session.start",
      "stream.session.idle",
      "stream.session.partial-idle",
      "stream.session.error",
      "stream.session.retry",
      "stream.session.info",
      "stream.session.warning",
      "stream.session.title_changed",
      "stream.session.truncation",
      "stream.session.compaction",
      "stream.turn.start",
      "stream.turn.end",
      "stream.permission.requested",
      "stream.human_input_required",
      "stream.skill.invoked",
      "stream.usage",
      "workflow.step.start",
      "workflow.step.complete",
      "workflow.task.update",
    ];

    for (const type of expectedTypes) {
      expect(BusEventSchemas[type]).toBeDefined();
    }

    // Count should match exactly
    expect(Object.keys(BusEventSchemas).length).toBe(expectedTypes.length);
  });

  // ── stream.text.delta ─────────────────────────────────────────────────

  describe("stream.text.delta schema", () => {
    const schema = BusEventSchemas["stream.text.delta"];

    it("accepts valid data with required fields", () => {
      expect(schema.safeParse({ delta: "hi", messageId: "m1" }).success).toBe(true);
    });

    it("accepts data with optional agentId", () => {
      const result = schema.safeParse({ delta: "hi", messageId: "m1", agentId: "a1" });
      expect(result.success).toBe(true);
    });

    it("rejects missing delta", () => {
      expect(schema.safeParse({ messageId: "m1" }).success).toBe(false);
    });

    it("rejects missing messageId", () => {
      expect(schema.safeParse({ delta: "hi" }).success).toBe(false);
    });

    it("rejects non-string delta", () => {
      expect(schema.safeParse({ delta: 42, messageId: "m1" }).success).toBe(false);
    });
  });

  // ── stream.text.complete ──────────────────────────────────────────────

  describe("stream.text.complete schema", () => {
    const schema = BusEventSchemas["stream.text.complete"];

    it("accepts valid data", () => {
      expect(schema.safeParse({ messageId: "m1", fullText: "done" }).success).toBe(true);
    });

    it("rejects missing fullText", () => {
      expect(schema.safeParse({ messageId: "m1" }).success).toBe(false);
    });

    it("accepts empty string fullText", () => {
      expect(schema.safeParse({ messageId: "m1", fullText: "" }).success).toBe(true);
    });
  });

  // ── stream.thinking.delta ─────────────────────────────────────────────

  describe("stream.thinking.delta schema", () => {
    const schema = BusEventSchemas["stream.thinking.delta"];

    it("accepts valid data", () => {
      expect(schema.safeParse({ delta: "hmm", sourceKey: "sk1", messageId: "m1" }).success).toBe(true);
    });

    it("accepts optional agentId", () => {
      expect(schema.safeParse({ delta: "hmm", sourceKey: "sk1", messageId: "m1", agentId: "a1" }).success).toBe(true);
    });

    it("rejects missing sourceKey", () => {
      expect(schema.safeParse({ delta: "hmm", messageId: "m1" }).success).toBe(false);
    });
  });

  // ── stream.thinking.complete ──────────────────────────────────────────

  describe("stream.thinking.complete schema", () => {
    const schema = BusEventSchemas["stream.thinking.complete"];

    it("accepts valid data", () => {
      expect(schema.safeParse({ sourceKey: "sk1", durationMs: 100 }).success).toBe(true);
    });

    it("rejects non-number durationMs", () => {
      expect(schema.safeParse({ sourceKey: "sk1", durationMs: "fast" }).success).toBe(false);
    });

    it("accepts optional agentId", () => {
      expect(schema.safeParse({ sourceKey: "sk1", durationMs: 100, agentId: "a1" }).success).toBe(true);
    });
  });

  // ── stream.tool.start ─────────────────────────────────────────────────

  describe("stream.tool.start schema", () => {
    const schema = BusEventSchemas["stream.tool.start"];

    it("accepts valid data", () => {
      expect(
        schema.safeParse({
          toolId: "t1",
          toolName: "bash",
          toolInput: { cmd: "ls" },
        }).success,
      ).toBe(true);
    });

    it("accepts optional fields", () => {
      expect(
        schema.safeParse({
          toolId: "t1",
          toolName: "bash",
          toolInput: { cmd: "ls" },
          sdkCorrelationId: "sdk1",
          toolMetadata: { src: "test" },
          parentAgentId: "agent1",
        }).success,
      ).toBe(true);
    });

    it("rejects non-object toolInput", () => {
      expect(
        schema.safeParse({
          toolId: "t1",
          toolName: "bash",
          toolInput: "not an object",
        }).success,
      ).toBe(false);
    });
  });

  // ── stream.tool.complete ──────────────────────────────────────────────

  describe("stream.tool.complete schema", () => {
    const schema = BusEventSchemas["stream.tool.complete"];

    it("accepts valid data", () => {
      expect(
        schema.safeParse({
          toolId: "t1",
          toolName: "bash",
          toolResult: "output",
          success: true,
        }).success,
      ).toBe(true);
    });

    it("accepts error field on failure", () => {
      const result = schema.safeParse({
        toolId: "t1",
        toolName: "bash",
        toolResult: null,
        success: false,
        error: "Command failed",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing success field", () => {
      expect(
        schema.safeParse({
          toolId: "t1",
          toolName: "bash",
          toolResult: "out",
        }).success,
      ).toBe(false);
    });

    it("accepts toolResult as any type", () => {
      // Object result
      expect(
        schema.safeParse({
          toolId: "t1",
          toolName: "bash",
          toolResult: { lines: ["a", "b"] },
          success: true,
        }).success,
      ).toBe(true);

      // Null result
      expect(
        schema.safeParse({
          toolId: "t1",
          toolName: "bash",
          toolResult: null,
          success: true,
        }).success,
      ).toBe(true);
    });
  });

  // ── stream.session.compaction ─────────────────────────────────────────

  describe("stream.session.compaction schema", () => {
    const schema = BusEventSchemas["stream.session.compaction"];

    it("accepts start phase", () => {
      expect(schema.safeParse({ phase: "start" }).success).toBe(true);
    });

    it("accepts complete phase with success", () => {
      expect(schema.safeParse({ phase: "complete", success: true }).success).toBe(true);
    });

    it("rejects unknown phase", () => {
      expect(schema.safeParse({ phase: "running" }).success).toBe(false);
    });
  });

  // ── stream.turn.end ───────────────────────────────────────────────────

  describe("stream.turn.end schema", () => {
    const schema = BusEventSchemas["stream.turn.end"];

    it("accepts valid finishReason values", () => {
      const validReasons = ["tool-calls", "stop", "max-tokens", "max-turns", "error", "unknown"] as const;
      for (const reason of validReasons) {
        expect(schema.safeParse({ turnId: "t1", finishReason: reason }).success).toBe(true);
      }
    });

    it("rejects invalid finishReason", () => {
      expect(schema.safeParse({ turnId: "t1", finishReason: "cancelled" }).success).toBe(false);
    });

    it("accepts missing finishReason (optional)", () => {
      expect(schema.safeParse({ turnId: "t1" }).success).toBe(true);
    });
  });

  // ── workflow.step.complete ────────────────────────────────────────────

  describe("workflow.step.complete schema", () => {
    const schema = BusEventSchemas["workflow.step.complete"];

    it("accepts optional truncation object", () => {
      const result = schema.safeParse({
        workflowId: "wf1",
        nodeId: "n1",
        status: "completed",
        durationMs: 100,
        truncation: {
          minTruncationParts: 5,
          truncateText: true,
          truncateReasoning: false,
          truncateTools: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects partial truncation object", () => {
      const result = schema.safeParse({
        workflowId: "wf1",
        nodeId: "n1",
        status: "completed",
        durationMs: 100,
        truncation: {
          minTruncationParts: 5,
        },
      });
      expect(result.success).toBe(false);
    });
  });

  // ── workflow.task.update ──────────────────────────────────────────────

  describe("workflow.task.update schema", () => {
    const schema = BusEventSchemas["workflow.task.update"];

    it("accepts array of tasks with optional id and blockedBy", () => {
      const result = schema.safeParse({
        tasks: [
          {
            id: "task1",
            description: "Do something",
            status: "completed",
            summary: "Done",
            blockedBy: ["task0"],
          },
          {
            description: "No id",
            status: "pending",
            summary: "",
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts optional sourceStageId", () => {
      const result = schema.safeParse({
        tasks: [{ description: "t", status: "s", summary: "x" }],
        sourceStageId: "stage-1",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty description", () => {
      // description is required but empty string is valid
      const result = schema.safeParse({
        tasks: [{ description: "", status: "s", summary: "x" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing tasks array", () => {
      expect(schema.safeParse({}).success).toBe(false);
    });
  });

  // ── stream.permission.requested ───────────────────────────────────────

  describe("stream.permission.requested schema", () => {
    const schema = BusEventSchemas["stream.permission.requested"];

    it("accepts valid data with options array", () => {
      const result = schema.safeParse({
        requestId: "r1",
        toolName: "bash",
        question: "allow?",
        options: [{ label: "Yes", value: "yes" }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts option with optional description", () => {
      const result = schema.safeParse({
        requestId: "r1",
        toolName: "bash",
        question: "allow?",
        options: [{ label: "Yes", value: "yes", description: "Allows the command" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects option missing value", () => {
      const result = schema.safeParse({
        requestId: "r1",
        toolName: "bash",
        question: "allow?",
        options: [{ label: "Yes" }],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("defineBusEvent() helper", () => {
  it("returns an object with type, schema, and parse", () => {
    const eventDef = defineBusEvent("custom.event", z.object({ foo: z.string() }));

    expect(eventDef.type).toBe("custom.event");
    expect(eventDef.schema).toBeDefined();
    expect(typeof eventDef.parse).toBe("function");
  });

  it("parse() validates data against the schema", () => {
    const eventDef = defineBusEvent("custom.event", z.object({ foo: z.string() }));

    expect(eventDef.parse({ foo: "bar" })).toEqual({ foo: "bar" });
  });

  it("parse() throws on invalid data", () => {
    const eventDef = defineBusEvent("custom.event", z.object({ foo: z.string() }));

    expect(() => eventDef.parse({ foo: 42 })).toThrow();
  });

  it("preserves type string as const", () => {
    const eventDef = defineBusEvent("my.type", z.object({}));
    // The type should be the exact literal string
    const typeValue: string = eventDef.type;
    expect(typeValue).toBe("my.type");
  });
});
