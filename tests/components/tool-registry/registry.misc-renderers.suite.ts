import { describe, expect, test } from "bun:test";
import {
  CHECKBOX,
  STATUS,
  defaultToolRenderer,
  getToolRenderer,
  mcpToolRenderer,
  readToolRenderer,
  registerAgentToolNames,
  taskToolRenderer,
  todoWriteToolRenderer,
  type ToolRenderProps,
} from "./registry.test-support.ts";

describe("defaultToolRenderer.render()", () => {
  test("renders input only", () => {
    const props: ToolRenderProps = {
      input: { key: "value", count: 42 },
    };
    const result = defaultToolRenderer.render(props);
    expect(result.title).toBe("Tool Result");
    expect(result.expandable).toBe(true);
    expect(result.content).toContain("Input:");
    expect(result.content.some(c => c.includes("key"))).toBe(true);
  });

  test("renders input with string output", () => {
    const props: ToolRenderProps = {
      input: { query: "test" },
      output: "output string",
    };
    const result = defaultToolRenderer.render(props);
    expect(result.content).toContain("Output:");
    expect(result.content).toContain("output string");
  });

  test("renders input with object output", () => {
    const props: ToolRenderProps = {
      input: { id: 123 },
      output: { status: "success", data: [1, 2, 3] },
    };
    const result = defaultToolRenderer.render(props);
    expect(result.content).toContain("Output:");
    expect(result.content.some(c => c.includes("status"))).toBe(true);
  });

  test("handles multiline string output", () => {
    const props: ToolRenderProps = {
      input: { action: "test" },
      output: "line1\nline2\nline3",
    };
    const result = defaultToolRenderer.render(props);
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line2");
    expect(result.content).toContain("line3");
  });

  test("does not include Output section when output is undefined", () => {
    const props: ToolRenderProps = {
      input: { key: "value" },
      output: undefined,
    };
    const result = defaultToolRenderer.render(props);
    expect(result.content).toContain("Input:");
    expect(result.content).not.toContain("Output:");
  });
});

describe("mcpToolRenderer.render()", () => {
  test("renders input only", () => {
    const props: ToolRenderProps = {
      input: { server: "filesystem", path: "/test" },
    };
    const result = mcpToolRenderer.render(props);
    expect(result.title).toBe("MCP Tool Result");
    expect(result.expandable).toBe(true);
    expect(result.content).toContain("Input:");
  });

  test("renders input with string output", () => {
    const props: ToolRenderProps = {
      input: { query: "search" },
      output: "result from MCP server",
    };
    const result = mcpToolRenderer.render(props);
    expect(result.content).toContain("Output:");
    expect(result.content).toContain("result from MCP server");
  });

  test("renders input with object output", () => {
    const props: ToolRenderProps = {
      input: { resource: "file" },
      output: { content: "file contents", mimeType: "text/plain" },
    };
    const result = mcpToolRenderer.render(props);
    expect(result.content).toContain("Output:");
    expect(result.content.some(c => c.includes("mimeType"))).toBe(true);
  });

  test("handles multiline string output", () => {
    const props: ToolRenderProps = {
      input: { url: "http://example.com" },
      output: "line1\nline2",
    };
    const result = mcpToolRenderer.render(props);
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line2");
  });

  test("does not include Output section when output is undefined", () => {
    const props: ToolRenderProps = {
      input: { action: "read" },
      output: undefined,
    };
    const result = mcpToolRenderer.render(props);
    expect(result.content).toContain("Input:");
    expect(result.content).not.toContain("Output:");
  });
});

describe("taskToolRenderer.render()", () => {
  test("renders with all input fields", () => {
    const props: ToolRenderProps = {
      input: {
        agent_type: "explore",
        description: "Find files",
        prompt: "Search for config files",
        model: "claude-3",
        mode: "standard",
      },
    };
    const result = taskToolRenderer.render(props);
    expect(result.expandable).toBe(true);
    expect(result.content).toContain("Agent: explore");
    expect(result.content).toContain("Model: claude-3");
    expect(result.content).toContain("Mode: standard");
    expect(result.content).toContain("Task: Find files");
    expect(result.content).toContain("Prompt: Search for config files");
  });

  test("renders with SDK format output", () => {
    const props: ToolRenderProps = {
      input: { description: "Test task" },
      output: {
        content: [{ type: "text", text: "Task completed successfully" }],
        totalDurationMs: 1500,
      },
    };
    const result = taskToolRenderer.render(props);
    expect(result.content.some((line) => line.includes("Task completed successfully"))).toBe(true);
  });

  test("renders with object output as JSON", () => {
    const props: ToolRenderProps = {
      input: { description: "Analysis" },
      output: { result: "Analysis complete" },
    };
    const result = taskToolRenderer.render(props);
    expect(result.content.some((line) => line.includes("Analysis complete"))).toBe(true);
  });

  test("truncates long prompts", () => {
    const longPrompt = "a".repeat(250);
    const props: ToolRenderProps = {
      input: { prompt: longPrompt },
    };
    const result = taskToolRenderer.render(props);
    const promptLine = result.content.find(c => c.startsWith("Prompt:"));
    expect(promptLine).toContain("chars truncated");
  });

  test("truncates long output to 8 lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Result line ${i + 1}`);
    const props: ToolRenderProps = {
      input: { description: "Task" },
      output: lines.join("\n"),
    };
    const result = taskToolRenderer.render(props);
    expect(result.content).toContain("Result line 8");
    expect(result.content).not.toContain("Result line 9");
    expect(result.content.some(c => c.includes("more lines"))).toBe(true);
  });

  test("handles minimal input", () => {
    const props: ToolRenderProps = {
      input: {},
    };
    const result = taskToolRenderer.render(props);
    expect(result.title).toBe("Sub-agent task");
    expect(result.expandable).toBe(true);
  });

  test("renders with only prompt (no description)", () => {
    const props: ToolRenderProps = {
      input: { prompt: "Search the codebase for tests" },
    };
    const result = taskToolRenderer.render(props);
    expect(result.title).toBe("Search the codebase for tests");
    expect(result.content).toContain("Prompt: Search the codebase for tests");
  });

  test("renders with plain string output", () => {
    const props: ToolRenderProps = {
      input: { description: "Quick task" },
      output: "Task finished with plain string",
    };
    const result = taskToolRenderer.render(props);
    expect(result.content).toContain("Task finished with plain string");
  });

  test("hides OpenCode task_result output from the parent task row", () => {
    const props: ToolRenderProps = {
      input: { description: "Quick task" },
      output: [
        "task_id: ses_child_123",
        "",
        "<task_result>",
        "Sub-agent final answer",
        "</task_result>",
      ].join("\n"),
    };
    const result = taskToolRenderer.render(props);
    expect(result.content.some((line) => line.includes("Sub-agent final answer"))).toBe(false);
    expect(result.content.some((line) => line.includes("<task_result>"))).toBe(false);
    expect(result.content).toContain("Task: Quick task");
  });

  test("renders with only agent_type (no description or prompt)", () => {
    const props: ToolRenderProps = {
      input: { agent_type: "code" },
    };
    const result = taskToolRenderer.render(props);
    expect(result.title).toBe("code");
    expect(result.content).toContain("Agent: code");
  });
});

describe("todoWriteToolRenderer.render()", () => {
  test("renders todos with mixed statuses", () => {
    const props: ToolRenderProps = {
      input: {
        todos: [
          { content: "Task 1", status: "completed" },
          { content: "Task 2", status: "in_progress" },
          { content: "Task 3", status: "pending" },
        ],
      },
    };
    const result = todoWriteToolRenderer.render(props);
    expect(result.title).toBe("3 tasks (1 done, 2 open)");
    expect(result.expandable).toBe(false);
    expect(result.content).toHaveLength(3);
    expect(result.content[0]).toContain(STATUS.success);
    expect(result.content[1]).toContain(STATUS.selected);
    expect(result.content[2]).toContain(STATUS.pending);
  });

  test("renders all completed todos", () => {
    const props: ToolRenderProps = {
      input: {
        todos: [
          { content: "Done 1", status: "completed" },
          { content: "Done 2", status: "completed" },
        ],
      },
    };
    const result = todoWriteToolRenderer.render(props);
    expect(result.title).toBe("2 tasks (2 done, 0 open)");
  });

  test("renders all pending todos", () => {
    const props: ToolRenderProps = {
      input: {
        todos: [
          { content: "Pending 1", status: "pending" },
          { content: "Pending 2", status: "pending" },
        ],
      },
    };
    const result = todoWriteToolRenderer.render(props);
    expect(result.title).toBe("2 tasks (0 done, 2 open)");
  });

  test("handles empty todos array", () => {
    const props: ToolRenderProps = {
      input: { todos: [] },
    };
    const result = todoWriteToolRenderer.render(props);
    expect(result.title).toBe("0 tasks (0 done, 0 open)");
    expect(result.content).toHaveLength(0);
  });

  test("handles missing todos field", () => {
    const props: ToolRenderProps = {
      input: {},
    };
    const result = todoWriteToolRenderer.render(props);
    expect(result.title).toBe("0 tasks (0 done, 0 open)");
  });
});

describe("registerAgentToolNames", () => {
  test("registers agent names as task tool renderers", () => {
    registerAgentToolNames(["my-custom-agent"]);
    expect(getToolRenderer("my-custom-agent")).toBe(taskToolRenderer);
  });

  test("does not overwrite existing renderer entries", () => {
    registerAgentToolNames(["Read"]);
    expect(getToolRenderer("Read")).toBe(readToolRenderer);
  });

  test("registers multiple agent names at once", () => {
    registerAgentToolNames(["agent-alpha", "agent-beta"]);
    expect(getToolRenderer("agent-alpha")).toBe(taskToolRenderer);
    expect(getToolRenderer("agent-beta")).toBe(taskToolRenderer);
  });

  test("handles empty array without error", () => {
    registerAgentToolNames([]);
    expect(getToolRenderer("Task")).toBe(taskToolRenderer);
  });
});
