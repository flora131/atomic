import { describe, expect, test } from "bun:test";
import {
  getToolRenderer,
  getRegisteredToolNames,
  hasCustomRenderer,
  parseMcpToolName,
  getLanguageFromExtension,
  defaultToolRenderer,
  readToolRenderer,
  editToolRenderer,
  applyPatchToolRenderer,
  bashToolRenderer,
  writeToolRenderer,
  globToolRenderer,
  grepToolRenderer,
  mcpToolRenderer,
  taskToolRenderer,
  todoWriteToolRenderer,
  parseTaskToolResult,
  registerAgentToolNames,
  TOOL_RENDERERS,
  type ToolRenderProps,
} from "./registry";
import { STATUS, CHECKBOX } from "../constants/icons";

describe("getToolRenderer", () => {
  test("returns registered renderer for known tool names", () => {
    expect(getToolRenderer("Read")).toBe(readToolRenderer);
    expect(getToolRenderer("read")).toBe(readToolRenderer);
    expect(getToolRenderer("Bash")).toBe(bashToolRenderer);
    expect(getToolRenderer("bash")).toBe(bashToolRenderer);
    expect(getToolRenderer("Task")).toBe(taskToolRenderer);
    expect(getToolRenderer("task")).toBe(taskToolRenderer);
    expect(getToolRenderer("launch_agent")).toBe(taskToolRenderer);
    expect(getToolRenderer("apply_patch")).toBe(applyPatchToolRenderer);
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

  test("handles Copilot format MCP tool names", () => {
    expect(parseMcpToolName("deepwiki/ask_question")).toEqual({
      server: "deepwiki",
      tool: "ask_question",
    });
    expect(parseMcpToolName("file_system/read_write")).toEqual({
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

  test("normalizes whitespace and line endings in extracted text", () => {
    const output = {
      content: [
        { type: "text", text: "\r\n  line one\r\nline two\r\n" },
      ],
    };
    const result = parseTaskToolResult(output);
    expect(result.text).toBe("line one\nline two");
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

  test("returns undefined for whitespace-only text output", () => {
    expect(parseTaskToolResult("\n\r\n  ").text).toBeUndefined();
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

  test("detects isAsync from async_launched result", () => {
    const output = {
      isAsync: true,
      status: "async_launched",
      output_file: "/tmp/agent-output.txt",
    };
    const result = parseTaskToolResult(output);
    expect(result.isAsync).toBe(true);
  });

  test("does not set isAsync for non-async results", () => {
    const output = { result: "Normal result" };
    const result = parseTaskToolResult(output);
    expect(result.isAsync).toBeUndefined();
  });

  test("detects isAsync alongside recognized formats", () => {
    const output = {
      result: "Async task started",
      isAsync: true,
    };
    const result = parseTaskToolResult(output);
    expect(result.text).toBe("Async task started");
    expect(result.isAsync).toBe(true);
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

// ============================================================================
// RENDER METHOD TESTS
// ============================================================================

describe("readToolRenderer.render()", () => {
  test("renders with output as string containing parsed JSON with file.content", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.ts" },
      output: JSON.stringify({ file: { content: "line1\nline2" } }),
    };
    const result = readToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.ts");
    expect(result.content).toEqual(["line1", "line2"]);
    expect(result.language).toBe("typescript");
    expect(result.expandable).toBe(true);
  });

  test("renders with output as string containing parsed JSON with content field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.py" },
      output: JSON.stringify({ content: "python code" }),
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["python code"]);
    expect(result.language).toBe("python");
  });

  test("renders with output as string containing parsed JSON with text field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: JSON.stringify({ text: "text content" }),
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["text content"]);
  });

  test("renders with output as string containing parsed JSON with value field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: JSON.stringify({ value: "value content" }),
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["value content"]);
  });

  test("renders with output as string containing parsed JSON with data field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: JSON.stringify({ data: "data content" }),
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["data content"]);
  });

  test("renders with output as raw string (not JSON)", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: "raw string content",
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["raw string content"]);
  });

  test("renders with output as object containing file.content", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.rs" },
      output: { file: { content: "fn main() {}" } },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["fn main() {}"]);
    expect(result.language).toBe("rust");
  });

  test("renders with output as object containing output field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.go" },
      output: { output: "go output" },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["go output"]);
  });

  test("renders with output as object containing result field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.java" },
      output: { result: "java result" },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["java result"]);
  });

  test("renders with output as object containing rawOutput field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: { rawOutput: "raw output" },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["raw output"]);
  });

  test("renders pending state when output is undefined", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: undefined,
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toContain("(file read pending...)");
  });

  test("renders pending state when output is null", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: null,
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toContain("(file read pending...)");
  });

  test("renders empty file", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/empty.txt" },
      output: "",
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toContain("(empty file)");
  });

  test("handles alternate parameter name 'path'", () => {
    const props: ToolRenderProps = {
      input: { path: "/path/to/file.json" },
      output: '{"key": "value"}',
    };
    const result = readToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.json");
    expect(result.language).toBe("json");
  });

  test("handles alternate parameter name 'filePath'", () => {
    const props: ToolRenderProps = {
      input: { filePath: "/path/to/file.yaml" },
      output: "yaml: content",
    };
    const result = readToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.yaml");
    expect(result.language).toBe("yaml");
  });

  test("renders with JSON string that parses to a plain string", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: JSON.stringify("simple string value"),
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["simple string value"]);
  });

  test("renders 'could not extract' when output is unrecognized type", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt" },
      output: 12345,
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["(could not extract file content)"]);
  });

  test("renders with object containing text field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.md" },
      output: { text: "markdown text" },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["markdown text"]);
    expect(result.language).toBe("markdown");
  });

  test("renders with object containing value field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.css" },
      output: { value: "body { color: red; }" },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["body { color: red; }"]);
    expect(result.language).toBe("css");
  });

  test("renders with object containing data field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.html" },
      output: { data: "<html></html>" },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["<html></html>"]);
    expect(result.language).toBe("html");
  });

  test("renders with object containing content field", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.py" },
      output: { content: "import os" },
    };
    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["import os"]);
  });

  test("falls back to 'unknown' when no file path param is provided", () => {
    const props: ToolRenderProps = {
      input: {},
      output: "some content",
    };
    const result = readToolRenderer.render(props);
    expect(result.title).toBe("unknown");
  });

  test("renders with JSON string containing unrecognized fields falls back to raw string", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.ts" },
      output: JSON.stringify({ unrecognized: "field" }),
    };
    const result = readToolRenderer.render(props);
    // Falls back to raw string since no recognized field is found
    expect(result.content[0]).toContain("unrecognized");
  });
});

describe("editToolRenderer.render()", () => {
  test("renders diff with old_string and new_string", () => {
    const props: ToolRenderProps = {
      input: {
        file_path: "/path/to/file.ts",
        old_string: "old line",
        new_string: "new line",
      },
    };
    const result = editToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.ts");
    expect(result.language).toBe("diff");
    expect(result.expandable).toBe(true);
    expect(result.content).toContain("--- /path/to/file.ts");
    expect(result.content).toContain("+++ /path/to/file.ts");
    expect(result.content).toContain("- old line");
    expect(result.content).toContain("+ new line");
  });

  test("renders diff with multiline changes", () => {
    const props: ToolRenderProps = {
      input: {
        file_path: "/path/to/file.ts",
        old_string: "line1\nline2",
        new_string: "newLine1\nnewLine2",
      },
    };
    const result = editToolRenderer.render(props);
    expect(result.content).toContain("- line1");
    expect(result.content).toContain("- line2");
    expect(result.content).toContain("+ newLine1");
    expect(result.content).toContain("+ newLine2");
  });

  test("renders diff with only old_string", () => {
    const props: ToolRenderProps = {
      input: {
        file_path: "/path/to/file.ts",
        old_string: "removed line",
        new_string: "",
      },
    };
    const result = editToolRenderer.render(props);
    expect(result.content).toContain("- removed line");
  });

  test("renders diff with only new_string", () => {
    const props: ToolRenderProps = {
      input: {
        file_path: "/path/to/file.ts",
        old_string: "",
        new_string: "added line",
      },
    };
    const result = editToolRenderer.render(props);
    expect(result.content).toContain("+ added line");
  });

  test("handles alternate parameter name 'path'", () => {
    const props: ToolRenderProps = {
      input: {
        path: "/path/to/file.ts",
        old_string: "old",
        new_string: "new",
      },
    };
    const result = editToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.ts");
  });

  test("handles alternate parameter name 'filePath'", () => {
    const props: ToolRenderProps = {
      input: {
        filePath: "/path/to/file.rs",
        old_string: "old",
        new_string: "new",
      },
    };
    const result = editToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.rs");
  });

  test("falls back to 'unknown' when no file path param is provided", () => {
    const props: ToolRenderProps = {
      input: { old_string: "old", new_string: "new" },
    };
    const result = editToolRenderer.render(props);
    expect(result.title).toBe("unknown");
    expect(result.content[0]).toBe("--- unknown");
    expect(result.content[1]).toBe("+++ unknown");
  });
});

describe("applyPatchToolRenderer.render()", () => {
  test("shows empty apply patch block until patch text is available", () => {
    const props: ToolRenderProps = {
      input: {},
      output: undefined,
    };

    const result = applyPatchToolRenderer.render(props);
    expect(result.title).toBe("Apply patch");
    expect(result.content).toEqual([]);
    expect(result.expandable).toBe(false);
  });

  test("renders patchText content instead of unknown file placeholders", () => {
    const props: ToolRenderProps = {
      input: {
        patchText: [
          "*** Begin Patch",
          "*** Update File: src/ui/chat.tsx",
          "@@",
          "-old line",
          "+new line",
          "*** End Patch",
        ].join("\n"),
      },
    };

    const result = applyPatchToolRenderer.render(props);
    expect(result.title).toBe("chat.tsx");
    expect(result.content).toContain("*** Update File: src/ui/chat.tsx");
    expect(result.content).not.toContain("--- unknown");
    expect(result.content).not.toContain("+++ unknown");
  });

  test("summarizes multi-file patches in title", () => {
    const props: ToolRenderProps = {
      input: {
        patchText: [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "-a",
          "+b",
          "*** Add File: src/new.ts",
          "+export const v = 1;",
          "*** End Patch",
        ].join("\n"),
      },
    };

    const result = applyPatchToolRenderer.render(props);
    expect(result.title).toBe("2 files");
    expect(result.content).toContain("*** Update File: src/a.ts");
    expect(result.content).toContain("*** Add File: src/new.ts");
  });

  test("uses output metadata files when patchText is unavailable", () => {
    const props: ToolRenderProps = {
      input: {},
      output: {
        metadata: {
          files: [
            { relativePath: "src/one.ts", type: "update" },
            { relativePath: "src/two.ts", type: "add" },
          ],
        },
      },
    };

    const result = applyPatchToolRenderer.render(props);
    expect(result.title).toBe("2 files");
    expect(result.content).toContain("*** Update File: src/one.ts");
    expect(result.content).toContain("*** Add File: src/two.ts");
  });

  test("extracts patch text from alternate input keys", () => {
    const props: ToolRenderProps = {
      input: {
        patch_text: [
          "*** Begin Patch",
          "*** Update File: src/alt.ts",
          "@@",
          "-before",
          "+after",
          "*** End Patch",
        ].join("\n"),
      },
    };

    const result = applyPatchToolRenderer.render(props);
    expect(result.title).toBe("alt.ts");
    expect(result.content).toContain("*** Update File: src/alt.ts");
    expect(result.content).not.toContain("--- unknown");
    expect(result.content).not.toContain("+++ unknown");
  });

  test("parses metadata files from JSON string output", () => {
    const props: ToolRenderProps = {
      input: {},
      output: JSON.stringify({
        metadata: {
          files: [
            { relativePath: "src/three.ts", type: "update" },
          ],
        },
      }),
    };

    const result = applyPatchToolRenderer.render(props);
    expect(result.title).toBe("three.ts");
    expect(result.content).toContain("*** Update File: src/three.ts");
  });
});

describe("bashToolRenderer.render()", () => {
  test("renders command with string output", () => {
    const props: ToolRenderProps = {
      input: { command: "echo hello" },
      output: "hello\n",
    };
    const result = bashToolRenderer.render(props);
    expect(result.title).toBe("echo hello");
    expect(result.language).toBe("bash");
    expect(result.expandable).toBe(true);
    expect(result.content[0]).toBe("$ echo hello");
    expect(result.content).toContain("hello");
  });

  test("renders command with JSON output containing stdout", () => {
    const props: ToolRenderProps = {
      input: { command: "ls" },
      output: JSON.stringify({ stdout: "file1.txt\nfile2.txt" }),
    };
    const result = bashToolRenderer.render(props);
    expect(result.content).toContain("file1.txt");
    expect(result.content).toContain("file2.txt");
  });

  test("renders command with object output containing stdout", () => {
    const props: ToolRenderProps = {
      input: { command: "pwd" },
      output: { stdout: "/home/user" },
    };
    const result = bashToolRenderer.render(props);
    expect(result.content).toContain("/home/user");
  });

  test("renders command with object output containing output field", () => {
    const props: ToolRenderProps = {
      input: { command: "test" },
      output: { output: "test output" },
    };
    const result = bashToolRenderer.render(props);
    expect(result.content).toContain("test output");
  });

  test("renders command without output (pending)", () => {
    const props: ToolRenderProps = {
      input: { command: "sleep 1" },
      output: undefined,
    };
    const result = bashToolRenderer.render(props);
    expect(result.content[0]).toBe("$ sleep 1");
    expect(result.content.length).toBe(1);
  });

  test("handles alternate parameter name 'cmd'", () => {
    const props: ToolRenderProps = {
      input: { cmd: "ls -la" },
      output: "output",
    };
    const result = bashToolRenderer.render(props);
    expect(result.title).toBe("ls -la");
    expect(result.content[0]).toBe("$ ls -la");
  });

  test("renders command with JSON output containing output field", () => {
    const props: ToolRenderProps = {
      input: { command: "run test" },
      output: JSON.stringify({ output: "test passed" }),
    };
    const result = bashToolRenderer.render(props);
    expect(result.content).toContain("test passed");
  });

  test("renders command with object output falling back to JSON.stringify", () => {
    const props: ToolRenderProps = {
      input: { command: "complex" },
      output: { exitCode: 0, signal: null },
    };
    const result = bashToolRenderer.render(props);
    // Should JSON.stringify the output since it has neither stdout nor output
    const outputJoined = result.content.join("\n");
    expect(outputJoined).toContain("exitCode");
  });
});

describe("writeToolRenderer.render()", () => {
  test("renders success state with output present", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.ts", content: "test content" },
      output: { success: true },
    };
    const result = writeToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.ts");
    expect(result.language).toBe("typescript");
    expect(result.expandable).toBe(true);
    expect(result.content[0]).toContain(STATUS.success);
  });

  test("renders pending state without output", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.ts", content: "test" },
      output: undefined,
    };
    const result = writeToolRenderer.render(props);
    expect(result.content[0]).toContain(STATUS.pending);
  });

  test("shows content preview (first 10 lines)", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt", content: lines.join("\n") },
      output: { success: true },
    };
    const result = writeToolRenderer.render(props);
    expect(result.content).toContain("line 1");
    expect(result.content).toContain("line 10");
    expect(result.content).not.toContain("line 11");
    expect(result.content.some(c => c.includes("more lines"))).toBe(true);
  });

  test("handles alternate parameter name 'path'", () => {
    const props: ToolRenderProps = {
      input: { path: "/path/to/file.py", content: "print('hello')" },
      output: { success: true },
    };
    const result = writeToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.py");
    expect(result.language).toBe("python");
  });

  test("handles empty content", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.txt", content: "" },
      output: { success: true },
    };
    const result = writeToolRenderer.render(props);
    expect(result.title).toBe("/path/to/file.txt");
  });
});

describe("globToolRenderer.render()", () => {
  test("renders with array output", () => {
    const props: ToolRenderProps = {
      input: { pattern: "**/*.ts", path: "/project" },
      output: ["file1.ts", "file2.ts", "file3.ts"],
    };
    const result = globToolRenderer.render(props);
    expect(result.title).toBe("**/*.ts");
    expect(result.expandable).toBe(true);
    expect(result.content).toContain("Pattern: **/*.ts");
    expect(result.content).toContain("Path: /project");
    expect(result.content).toContain("Found 3 file(s):");
    expect(result.content).toContain("  file1.ts");
  });

  test("renders with JSON string output containing matches", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.json" },
      output: JSON.stringify({ matches: ["package.json", "tsconfig.json"] }),
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("Found 2 file(s):");
    expect(result.content).toContain("  package.json");
  });

  test("renders with object output containing matches", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.md" },
      output: { matches: ["README.md", "CHANGELOG.md"] },
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("Found 2 file(s):");
  });

  test("renders with newline-separated string output", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.txt" },
      output: "file1.txt\nfile2.txt\nfile3.txt",
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("Found 3 file(s):");
  });

  test("renders no results when output is undefined", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.xyz" },
      output: undefined,
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("(no results)");
  });

  test("truncates file list to 20 items", () => {
    const files = Array.from({ length: 25 }, (_, i) => `file${i}.ts`);
    const props: ToolRenderProps = {
      input: { pattern: "**/*.ts" },
      output: files,
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("Found 25 file(s):");
    expect(result.content).toContain("  file19.ts");
    expect(result.content.some(c => c.includes("more files"))).toBe(true);
  });

  test("defaults path to '.'", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.ts" },
      output: ["test.ts"],
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("Path: .");
  });

  test("renders with JSON string output that parses to an array", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.rs" },
      output: JSON.stringify(["main.rs", "lib.rs"]),
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("Found 2 file(s):");
    expect(result.content).toContain("  main.rs");
    expect(result.content).toContain("  lib.rs");
  });

  test("renders with JSON string output containing content field", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.go" },
      output: JSON.stringify({ content: "main.go\nutil.go" }),
    };
    const result = globToolRenderer.render(props);
    // When content is a string, it becomes a single newline-separated string
    expect(result.content).toContain("Found 2 file(s):");
  });

  test("renders with object output containing content string", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.py" },
      output: { content: "app.py\ntest.py" },
    };
    const result = globToolRenderer.render(props);
    expect(result.content).toContain("Found 2 file(s):");
  });

  test("renders empty string file list as direct content", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.none" },
      output: "   ",
    };
    const result = globToolRenderer.render(props);
    // Empty/whitespace-only string filter produces no file entries
    // Falls through to the else with fileList.length === 0, which outputs the raw string
    expect(result.content).toContain("   ");
  });
});

describe("grepToolRenderer.render()", () => {
  test("renders with string output", () => {
    const props: ToolRenderProps = {
      input: { pattern: "function", path: "/src" },
      output: "file1.ts:function test() {}\nfile2.ts:function other() {}",
    };
    const result = grepToolRenderer.render(props);
    expect(result.title).toBe("function");
    expect(result.expandable).toBe(true);
    expect(result.content).toContain("Pattern: function");
    expect(result.content).toContain("Path: /src");
    expect(result.content).toContain("file1.ts:function test() {}");
  });

  test("renders with JSON string output containing content", () => {
    const props: ToolRenderProps = {
      input: { pattern: "import" },
      output: JSON.stringify({ content: "file1.ts:import React" }),
    };
    const result = grepToolRenderer.render(props);
    expect(result.content).toContain("file1.ts:import React");
  });

  test("renders with object output containing content", () => {
    const props: ToolRenderProps = {
      input: { pattern: "export" },
      output: { content: "file.ts:export const x = 1" },
    };
    const result = grepToolRenderer.render(props);
    expect(result.content).toContain("file.ts:export const x = 1");
  });

  test("renders no matches when output is undefined", () => {
    const props: ToolRenderProps = {
      input: { pattern: "nonexistent" },
      output: undefined,
    };
    const result = grepToolRenderer.render(props);
    expect(result.content).toContain("(no matches)");
  });

  test("truncates output to 30 lines", () => {
    const lines = Array.from({ length: 35 }, (_, i) => `line ${i + 1}`);
    const props: ToolRenderProps = {
      input: { pattern: "test" },
      output: lines.join("\n"),
    };
    const result = grepToolRenderer.render(props);
    expect(result.content).toContain("line 30");
    expect(result.content.some(c => c.includes("more lines"))).toBe(true);
  });

  test("defaults path to '.'", () => {
    const props: ToolRenderProps = {
      input: { pattern: "test" },
      output: "result",
    };
    const result = grepToolRenderer.render(props);
    expect(result.content).toContain("Path: .");
  });

  test("renders with JSON string that parses to a plain string", () => {
    const props: ToolRenderProps = {
      input: { pattern: "hello" },
      output: JSON.stringify("parsed string content"),
    };
    const result = grepToolRenderer.render(props);
    expect(result.content).toContain("parsed string content");
  });

  test("renders with object output without content field (JSON.stringify fallback)", () => {
    const props: ToolRenderProps = {
      input: { pattern: "search" },
      output: { matches: 5, files: ["a.ts", "b.ts"] },
    };
    const result = grepToolRenderer.render(props);
    const outputJoined = result.content.join("\n");
    expect(outputJoined).toContain("matches");
    expect(outputJoined).toContain("files");
  });
});

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
    expect(result.content).toContain("Task completed successfully");
  });

  test("renders with TaskOutput format output", () => {
    const props: ToolRenderProps = {
      input: { description: "Analysis" },
      output: { result: "Analysis complete" },
    };
    const result = taskToolRenderer.render(props);
    expect(result.content).toContain("Analysis complete");
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
      output: { result: lines.join("\n") },
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
    // "Read" already maps to readToolRenderer
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
    // No error thrown, existing registry unaffected
    expect(getToolRenderer("Task")).toBe(taskToolRenderer);
  });
});
