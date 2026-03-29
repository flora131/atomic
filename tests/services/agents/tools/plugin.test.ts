/**
 * Tests for src/services/agents/tools/plugin.ts
 *
 * Type-safe tool definition helper:
 * - tool() identity function
 * - tool.schema re-export of zod
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { tool } from "@/services/agents/tools/plugin.ts";
import type { ToolInput } from "@/services/agents/tools/plugin.ts";

// --- tool() identity function ---

describe("tool()", () => {
  test("returns the same input object", () => {
    const input: ToolInput<{ name: z.ZodString }> = {
      description: "A test tool",
      args: { name: z.string() },
      execute: (args) => `Hello, ${args.name}`,
    };

    const result = tool(input);
    expect(result).toBe(input);
  });

  test("preserves description", () => {
    const input = tool({
      description: "My description",
      args: { value: z.number() },
      execute: () => "ok",
    });

    expect(input.description).toBe("My description");
  });

  test("preserves args schema", () => {
    const nameSchema = z.string();
    const input = tool({
      description: "test",
      args: { name: nameSchema },
      execute: () => "ok",
    });

    expect(input.args.name).toBe(nameSchema);
  });

  test("preserves execute function", () => {
    const executeFn = () => "result";
    const input = tool({
      description: "test",
      args: {},
      execute: executeFn,
    });

    expect(input.execute).toBe(executeFn);
  });

  test("execute function can be called with typed args", async () => {
    const myTool = tool({
      description: "Greeter",
      args: {
        name: z.string(),
        times: z.number(),
      },
      execute: (args) => `${args.name} x${args.times}`,
    });

    const result = myTool.execute(
      { name: "Alice", times: 3 },
      {} as any, // ToolContext mock
    );
    expect(result).toBe("Alice x3");
  });

  test("execute function can return a promise", async () => {
    const myTool = tool({
      description: "Async tool",
      args: { delay: z.number() },
      execute: async (args) => `waited ${args.delay}ms`,
    });

    const result = await myTool.execute({ delay: 100 }, {} as any);
    expect(result).toBe("waited 100ms");
  });
});

// --- tool.schema ---

describe("tool.schema", () => {
  test("is the zod instance", () => {
    expect(tool.schema).toBe(z);
  });

  test("can create string schemas", () => {
    const schema = tool.schema.string();
    expect(schema.parse("hello")).toBe("hello");
  });

  test("can create number schemas", () => {
    const schema = tool.schema.number();
    expect(schema.parse(42)).toBe(42);
  });

  test("can create object schemas from args", () => {
    const schema = tool.schema.object({
      name: tool.schema.string(),
      age: tool.schema.number(),
    });

    const result = schema.parse({ name: "Bob", age: 25 });
    expect(result).toEqual({ name: "Bob", age: 25 });
  });
});
