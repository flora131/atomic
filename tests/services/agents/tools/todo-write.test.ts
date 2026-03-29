/**
 * Tests for src/services/agents/tools/todo-write.ts
 *
 * TodoWrite tool definition:
 * - createTodoWriteTool() factory
 * - Handler state tracking (oldTodos/newTodos)
 * - Status summary computation
 * - Input schema structure
 */

import { describe, test, expect } from "bun:test";
import { createTodoWriteTool } from "@/services/agents/tools/todo-write.ts";
import type { TodoItem } from "@/services/agents/tools/todo-write.ts";

const mockContext = {
  sessionID: "test",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/tmp",
  abort: new AbortController().signal,
};

// --- createTodoWriteTool structure ---

describe("createTodoWriteTool – structure", () => {
  test("returns a tool with name 'TodoWrite'", () => {
    const tool = createTodoWriteTool();
    expect(tool.name).toBe("TodoWrite");
  });

  test("has a description string", () => {
    const tool = createTodoWriteTool();
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });

  test("has an inputSchema with required 'todos' field", () => {
    const tool = createTodoWriteTool();
    const schema = tool.inputSchema as Record<string, unknown>;

    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["todos"]);
  });

  test("inputSchema defines todos as an array of objects", () => {
    const tool = createTodoWriteTool();
    const schema = tool.inputSchema as any;
    const todosSchema = schema.properties.todos;

    expect(todosSchema.type).toBe("array");
    expect(todosSchema.items.type).toBe("object");
  });

  test("inputSchema items require description, status, and summary", () => {
    const tool = createTodoWriteTool();
    const schema = tool.inputSchema as any;
    const itemSchema = schema.properties.todos.items;

    expect(itemSchema.required).toContain("description");
    expect(itemSchema.required).toContain("status");
    expect(itemSchema.required).toContain("summary");
  });
});

// --- Handler behavior ---

describe("createTodoWriteTool – handler", () => {
  test("returns oldTodos as empty on first call", () => {
    const tool = createTodoWriteTool();
    const todos: TodoItem[] = [
      { description: "Task 1", status: "pending", summary: "Doing task 1" },
    ];

    const result = tool.handler({ todos }, mockContext) as any;
    expect(result.oldTodos).toEqual([]);
  });

  test("returns newTodos matching input", () => {
    const tool = createTodoWriteTool();
    const todos: TodoItem[] = [
      { description: "Task 1", status: "pending", summary: "Doing task 1" },
    ];

    const result = tool.handler({ todos }, mockContext) as any;
    expect(result.newTodos).toEqual(todos);
  });

  test("tracks state across calls – oldTodos reflects previous call", () => {
    const tool = createTodoWriteTool();

    const firstTodos: TodoItem[] = [
      { description: "Setup", status: "completed", summary: "Setting up" },
    ];
    const secondTodos: TodoItem[] = [
      { description: "Setup", status: "completed", summary: "Setting up" },
      { description: "Build", status: "in_progress", summary: "Building" },
    ];

    tool.handler({ todos: firstTodos }, mockContext);
    const result = tool.handler({ todos: secondTodos }, mockContext) as any;

    expect(result.oldTodos).toEqual(firstTodos);
    expect(result.newTodos).toEqual(secondTodos);
  });

  test("each createTodoWriteTool() call creates independent state", () => {
    const tool1 = createTodoWriteTool();
    const tool2 = createTodoWriteTool();

    const todos: TodoItem[] = [
      { description: "Task", status: "pending", summary: "Tasking" },
    ];

    tool1.handler({ todos }, mockContext);

    // tool2 should not be affected by tool1's state
    const result = tool2.handler({ todos }, mockContext) as any;
    expect(result.oldTodos).toEqual([]);
  });
});

// --- Status summary ---

describe("createTodoWriteTool – status summary", () => {
  test("empty todos returns '0 tasks: 0 done, 0 in progress, 0 pending'", () => {
    const tool = createTodoWriteTool();
    const result = tool.handler({ todos: [] }, mockContext) as any;
    expect(result.statusSummary).toBe("0 tasks: 0 done, 0 in progress, 0 pending");
  });

  test("counts completed tasks correctly", () => {
    const tool = createTodoWriteTool();
    const todos: TodoItem[] = [
      { description: "A", status: "completed", summary: "Done A" },
      { description: "B", status: "completed", summary: "Done B" },
      { description: "C", status: "pending", summary: "Doing C" },
    ];

    const result = tool.handler({ todos }, mockContext) as any;
    expect(result.statusSummary).toBe("3 tasks: 2 done, 0 in progress, 1 pending");
  });

  test("counts in_progress tasks correctly", () => {
    const tool = createTodoWriteTool();
    const todos: TodoItem[] = [
      { description: "A", status: "in_progress", summary: "Working A" },
      { description: "B", status: "in_progress", summary: "Working B" },
    ];

    const result = tool.handler({ todos }, mockContext) as any;
    expect(result.statusSummary).toBe("2 tasks: 0 done, 2 in progress, 0 pending");
  });

  test("counts all status types in a mixed list", () => {
    const tool = createTodoWriteTool();
    const todos: TodoItem[] = [
      { description: "A", status: "completed", summary: "Done" },
      { description: "B", status: "in_progress", summary: "Working" },
      { description: "C", status: "pending", summary: "Waiting" },
      { description: "D", status: "pending", summary: "Waiting" },
      { description: "E", status: "completed", summary: "Done" },
    ];

    const result = tool.handler({ todos }, mockContext) as any;
    expect(result.statusSummary).toBe("5 tasks: 2 done, 1 in progress, 2 pending");
  });

  test("single pending task", () => {
    const tool = createTodoWriteTool();
    const todos: TodoItem[] = [
      { description: "Only task", status: "pending", summary: "Planning" },
    ];

    const result = tool.handler({ todos }, mockContext) as any;
    expect(result.statusSummary).toBe("1 tasks: 0 done, 0 in progress, 1 pending");
  });
});
