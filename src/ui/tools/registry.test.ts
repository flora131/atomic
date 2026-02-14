import { describe, expect, test } from "bun:test";
import {
  getToolRenderer,
  getRegisteredToolNames,
  hasCustomRenderer,
  parseMcpToolName,
  getLanguageFromExtension,
  defaultToolRenderer,
  readToolRenderer,
  bashToolRenderer,
  mcpToolRenderer,
  taskToolRenderer,
  parseTaskToolResult,
  type ToolRenderProps,
} from "./registry";

describe("getToolRenderer", () => {
  test("returns registered renderer for known tool names", () => {
    expect(getToolRenderer("Read")).toBe(readToolRenderer);
    expect(getToolRenderer("read")).toBe(readToolRenderer);
    expect(getToolRenderer("Bash")).toBe(bashToolRenderer);
    expect(getToolRenderer("bash")).toBe(bashToolRenderer);
    expect(getToolRenderer("Task")).toBe(taskToolRenderer);
    expect(getToolRenderer("task")).toBe(taskToolRenderer);
  });

  test("returns MCP renderer for MCP tool names", () => {
    expect(getToolRenderer("mcp__server__tool")).toBe(mcpToolRenderer);
    expect(getToolRenderer("mcp__filesystem__read")).toBe(mcpToolRenderer);
    expect(getToolRenderer("mcp__github__create_pr")).toBe(mcpToolRenderer);
  });

  test("returns default renderer for unknown tool names", () => {
    expect(getToolRenderer("UnknownTool")).toBe(defaultToolRenderer);
    expect(getToolRenderer("some_random_tool")).toBe(defaultToolRenderer);
    expect(getToolRenderer("")).toBe(defaultToolRenderer);
  });

  test("returns default renderer for invalid MCP tool names", () => {
    expect(getToolRenderer("mcp__only_one_part")).toBe(defaultToolRenderer);
    expect(getToolRenderer("mcp_single_underscore_server_tool")).toBe(defaultToolRenderer);
  });
});

describe("getRegisteredToolNames", () => {
  test("returns sorted list of registered tool names", () => {
    const toolNames = getRegisteredToolNames();
    expect(Array.isArray(toolNames)).toBe(true);
    expect(toolNames.length).toBeGreaterThan(0);
    // Check that it includes some known tools
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Task");
  });

  test("returns deduplicated names (case-insensitive)", () => {
    const toolNames = getRegisteredToolNames();
    // Should not have both "Read" and "read" in the list
    const lowercaseNames = toolNames.map(name => name.toLowerCase());
    const uniqueLowercaseNames = new Set(lowercaseNames);
    expect(lowercaseNames.length).toBe(uniqueLowercaseNames.size);
  });

  test("returns names in alphabetical order", () => {
    const toolNames = getRegisteredToolNames();
    const sortedNames = [...toolNames].sort();
    expect(toolNames).toEqual(sortedNames);
  });
});

describe("hasCustomRenderer", () => {
  test("returns true for tools with custom renderers", () => {
    expect(hasCustomRenderer("Read")).toBe(true);
    expect(hasCustomRenderer("read")).toBe(true);
    expect(hasCustomRenderer("Bash")).toBe(true);
    expect(hasCustomRenderer("bash")).toBe(true);
    expect(hasCustomRenderer("Task")).toBe(true);
    expect(hasCustomRenderer("task")).toBe(true);
    expect(hasCustomRenderer("Edit")).toBe(true);
    expect(hasCustomRenderer("Write")).toBe(true);
    expect(hasCustomRenderer("Glob")).toBe(true);
    expect(hasCustomRenderer("Grep")).toBe(true);
  });

  test("returns false for unknown tools", () => {
    expect(hasCustomRenderer("UnknownTool")).toBe(false);
    expect(hasCustomRenderer("some_random_tool")).toBe(false);
    expect(hasCustomRenderer("")).toBe(false);
  });

  test("returns false for MCP tools (they use special handling)", () => {
    // MCP tools are not in TOOL_RENDERERS, they're detected by pattern
    expect(hasCustomRenderer("mcp__server__tool")).toBe(false);
    expect(hasCustomRenderer("mcp__filesystem__read")).toBe(false);
  });
});

describe("parseMcpToolName", () => {
  test("parses valid MCP tool names", () => {
    expect(parseMcpToolName("mcp__server__tool")).toEqual({
      server: "server",
      tool: "tool",
    });
    expect(parseMcpToolName("mcp__filesystem__read_file")).toEqual({
      server: "filesystem",
      tool: "read_file",
    });
    expect(parseMcpToolName("mcp__github__create_pr")).toEqual({
      server: "github",
      tool: "create_pr",
    });
  });

  test("handles MCP tool names with underscores in server or tool", () => {
    expect(parseMcpToolName("mcp__my_server__my_tool")).toEqual({
      server: "my_server",
      tool: "my_tool",
    });
    expect(parseMcpToolName("mcp__file_system__read_write")).toEqual({
      server: "file_system",
      tool: "read_write",
    });
  });

  test("returns null for invalid MCP tool names", () => {
    expect(parseMcpToolName("mcp__only_one_part")).toBeNull();
    expect(parseMcpToolName("mcp_single_underscore__tool")).toBeNull();
    expect(parseMcpToolName("not_mcp__server__tool")).toBeNull();
    expect(parseMcpToolName("mcp__")).toBeNull();
    expect(parseMcpToolName("")).toBeNull();
    expect(parseMcpToolName("regular_tool_name")).toBeNull();
  });
});

describe("getLanguageFromExtension", () => {
  test("returns correct language for JavaScript/TypeScript extensions", () => {
    expect(getLanguageFromExtension("js")).toBe("javascript");
    expect(getLanguageFromExtension("jsx")).toBe("javascript");
    expect(getLanguageFromExtension("ts")).toBe("typescript");
    expect(getLanguageFromExtension("tsx")).toBe("typescript");
    expect(getLanguageFromExtension("mjs")).toBe("javascript");
    expect(getLanguageFromExtension("cjs")).toBe("javascript");
  });

  test("returns correct language for Python extensions", () => {
    expect(getLanguageFromExtension("py")).toBe("python");
    expect(getLanguageFromExtension("pyw")).toBe("python");
    expect(getLanguageFromExtension("pyx")).toBe("python");
  });

  test("returns correct language for config file extensions", () => {
    expect(getLanguageFromExtension("json")).toBe("json");
    expect(getLanguageFromExtension("yaml")).toBe("yaml");
    expect(getLanguageFromExtension("yml")).toBe("yaml");
    expect(getLanguageFromExtension("toml")).toBe("toml");
    expect(getLanguageFromExtension("xml")).toBe("xml");
  });

  test("returns correct language for shell/bash extensions", () => {
    expect(getLanguageFromExtension("sh")).toBe("bash");
    expect(getLanguageFromExtension("bash")).toBe("bash");
    expect(getLanguageFromExtension("zsh")).toBe("bash");
  });

  test("returns correct language for markup extensions", () => {
    expect(getLanguageFromExtension("md")).toBe("markdown");
    expect(getLanguageFromExtension("markdown")).toBe("markdown");
    expect(getLanguageFromExtension("html")).toBe("html");
    expect(getLanguageFromExtension("htm")).toBe("html");
  });

  test("is case-insensitive", () => {
    expect(getLanguageFromExtension("JS")).toBe("javascript");
    expect(getLanguageFromExtension("TS")).toBe("typescript");
    expect(getLanguageFromExtension("PY")).toBe("python");
    expect(getLanguageFromExtension("MD")).toBe("markdown");
  });

  test("returns undefined for unknown extensions", () => {
    expect(getLanguageFromExtension("unknown")).toBeUndefined();
    expect(getLanguageFromExtension("xyz")).toBeUndefined();
    expect(getLanguageFromExtension("")).toBeUndefined();
  });
});

describe("parseTaskToolResult", () => {
  test("extracts text from plain string output", () => {
    const result = parseTaskToolResult("Simple text result");
    expect(result.text).toBe("Simple text result");
    expect(result.durationMs).toBeUndefined();
    expect(result.toolUses).toBeUndefined();
  });

  test("extracts text from SDK format with content array", () => {
    const output = {
      content: [
        { type: "text", text: "Agent completed task successfully" },
      ],
      totalDurationMs: 5000,
      totalToolUseCount: 3,
      totalTokens: 1500,
    };
    const result = parseTaskToolResult(output);
    expect(result.text).toBe("Agent completed task successfully");
    expect(result.durationMs).toBe(5000);
    expect(result.toolUses).toBe(3);
    expect(result.tokens).toBe(1500);
  });

  test("extracts text from documented TaskOutput format", () => {
    const output = {
      result: "Task completed",
      duration_ms: 3000,
    };
    const result = parseTaskToolResult(output);
    expect(result.text).toBe("Task completed");
    expect(result.durationMs).toBe(3000);
  });

  test("handles JSON string input", () => {
    const jsonString = JSON.stringify({ result: "Parsed from JSON" });
    const result = parseTaskToolResult(jsonString);
    expect(result.text).toBe("Parsed from JSON");
  });

  test("returns undefined for null or undefined input", () => {
    expect(parseTaskToolResult(null).text).toBeUndefined();
    expect(parseTaskToolResult(undefined).text).toBeUndefined();
  });

  test("converts non-object types to string", () => {
    expect(parseTaskToolResult(42).text).toBe("42");
    expect(parseTaskToolResult(true).text).toBe("true");
  });

  test("stringifies objects without recognized fields", () => {
    const output = { unrecognized: "field", other: "data" };
    const result = parseTaskToolResult(output);
    expect(result.text).toContain("unrecognized");
    expect(result.text).toContain("field");
  });
});

describe("Tool renderer icon and title generation", () => {
  test("readToolRenderer generates correct icon and title", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.ts" },
    };
    expect(readToolRenderer.icon).toBe("≡");
    expect(readToolRenderer.getTitle(props)).toBe("file.ts");
  });

  test("bashToolRenderer generates correct icon and title", () => {
    const props: ToolRenderProps = {
      input: { command: "ls -la" },
    };
    expect(bashToolRenderer.icon).toBe("$");
    expect(bashToolRenderer.getTitle(props)).toBe("ls -la");
  });

  test("bashToolRenderer truncates long commands in title", () => {
    const longCommand = "a".repeat(60);
    const props: ToolRenderProps = {
      input: { command: longCommand },
    };
    const title = bashToolRenderer.getTitle(props);
    expect(title.length).toBeLessThan(longCommand.length);
    expect(title).toContain("...");
  });

  test("taskToolRenderer generates title from description and agent type", () => {
    const props: ToolRenderProps = {
      input: {
        agent_type: "explore",
        description: "Find config files",
        prompt: "Search for configuration files in the project",
      },
    };
    expect(taskToolRenderer.icon).toBe("◉");
    const title = taskToolRenderer.getTitle(props);
    expect(title).toContain("explore");
    expect(title).toContain("Find config files");
  });

  test("defaultToolRenderer handles missing input gracefully", () => {
    const props: ToolRenderProps = {
      input: {},
    };
    expect(defaultToolRenderer.icon).toBe("▶");
    expect(defaultToolRenderer.getTitle(props)).toBe("Tool execution");
  });
});
