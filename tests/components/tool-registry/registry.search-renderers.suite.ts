import { describe, expect, test } from "bun:test";
import {
  bashToolRenderer,
  globToolRenderer,
  grepToolRenderer,
  type ToolRenderProps,
} from "./registry.test-support.ts";

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
    const outputJoined = result.content.join("\n");
    expect(outputJoined).toContain("exitCode");
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
