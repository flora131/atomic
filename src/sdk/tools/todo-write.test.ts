import { describe, expect, test } from "bun:test";
import { createTodoWriteTool } from "./todo-write.ts";

const mockToolContext: import("../types.ts").ToolContext = {
  sessionID: "session-1",
  messageID: "message-1",
  agent: "claude",
  directory: process.cwd(),
  abort: new AbortController().signal,
};

describe("TodoWrite tool validation", () => {
  test("rejects items without IDs", () => {
    const tool = createTodoWriteTool();
    const result = tool.handler({
      todos: [
        {
          content: "Task without id",
          status: "pending",
          activeForm: "Working",
        },
      ],
    }, mockToolContext) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing task IDs");
  });

  test("rejects non-#N task IDs", () => {
    const tool = createTodoWriteTool();
    const result = tool.handler({
      todos: [
        {
          id: "#2-#11",
          content: "Invalid range",
          status: "pending",
          activeForm: "Working",
        },
      ],
    }, mockToolContext) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("#2-#11");
  });

  test("rejects duplicate task IDs", () => {
    const tool = createTodoWriteTool();
    const result = tool.handler({
      todos: [
        {
          id: "#1",
          content: "Task A",
          status: "pending",
          activeForm: "Working A",
        },
        {
          id: "#1",
          content: "Task B",
          status: "pending",
          activeForm: "Working B",
        },
      ],
    }, mockToolContext) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("Duplicate task IDs");
  });

  test("accepts valid #N task IDs", () => {
    const tool = createTodoWriteTool();
    const result = tool.handler({
      todos: [
        {
          id: "#1",
          content: "Task A",
          status: "completed",
          activeForm: "Completing task A",
        },
      ],
    }, mockToolContext) as { success: boolean; summary?: string };

    expect(result.success).toBe(true);
    expect(result.summary).toContain("1 tasks");
  });
});
