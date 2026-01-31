/**
 * Tests for ToolResultRegistry
 *
 * Tests cover:
 * - Individual tool renderers (Read, Edit, Bash, Write, Glob, Grep)
 * - Default renderer for unknown tools
 * - Helper functions
 * - Language detection
 */

import { describe, test, expect } from "bun:test";
import {
  readToolRenderer,
  editToolRenderer,
  bashToolRenderer,
  writeToolRenderer,
  globToolRenderer,
  grepToolRenderer,
  defaultToolRenderer,
  getToolRenderer,
  getRegisteredToolNames,
  hasCustomRenderer,
  getLanguageFromExtension,
  type ToolRenderProps,
  type ToolRenderResult,
} from "../../../src/ui/tools/registry.ts";

// ============================================================================
// READ TOOL RENDERER TESTS
// ============================================================================

describe("readToolRenderer", () => {
  test("has correct icon", () => {
    expect(readToolRenderer.icon).toBe("📄");
  });

  test("getTitle returns filename from path", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/home/user/project/src/main.ts" },
    };
    expect(readToolRenderer.getTitle(props)).toBe("main.ts");
  });

  test("getTitle handles missing file_path", () => {
    const props: ToolRenderProps = { input: {} };
    expect(readToolRenderer.getTitle(props)).toBe("Read file");
  });

  test("render returns file content", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/file.ts" },
      output: "const x = 1;\nconst y = 2;",
    };

    const result = readToolRenderer.render(props);

    expect(result.title).toBe("/path/to/file.ts");
    expect(result.content).toEqual(["const x = 1;", "const y = 2;"]);
    expect(result.language).toBe("typescript");
    expect(result.expandable).toBe(true);
  });

  test("render handles empty file", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/empty.txt" },
      output: "",
    };

    const result = readToolRenderer.render(props);
    expect(result.content).toEqual(["(empty file)"]);
  });
});

// ============================================================================
// EDIT TOOL RENDERER TESTS
// ============================================================================

describe("editToolRenderer", () => {
  test("has correct icon", () => {
    expect(editToolRenderer.icon).toBe("✏️");
  });

  test("getTitle returns filename from path", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/src/component.tsx" },
    };
    expect(editToolRenderer.getTitle(props)).toBe("component.tsx");
  });

  test("render shows diff format", () => {
    const props: ToolRenderProps = {
      input: {
        file_path: "/file.ts",
        old_string: "const old = 1;",
        new_string: "const new = 2;",
      },
    };

    const result = editToolRenderer.render(props);

    expect(result.title).toBe("/file.ts");
    expect(result.language).toBe("diff");
    expect(result.content).toContain("--- /file.ts");
    expect(result.content).toContain("+++ /file.ts");
    expect(result.content).toContain("- const old = 1;");
    expect(result.content).toContain("+ const new = 2;");
  });

  test("render handles multiline diff", () => {
    const props: ToolRenderProps = {
      input: {
        file_path: "/file.ts",
        old_string: "line1\nline2",
        new_string: "new1\nnew2\nnew3",
      },
    };

    const result = editToolRenderer.render(props);

    expect(result.content).toContain("- line1");
    expect(result.content).toContain("- line2");
    expect(result.content).toContain("+ new1");
    expect(result.content).toContain("+ new2");
    expect(result.content).toContain("+ new3");
  });
});

// ============================================================================
// BASH TOOL RENDERER TESTS
// ============================================================================

describe("bashToolRenderer", () => {
  test("has correct icon", () => {
    expect(bashToolRenderer.icon).toBe("💻");
  });

  test("getTitle returns command", () => {
    const props: ToolRenderProps = {
      input: { command: "ls -la" },
    };
    expect(bashToolRenderer.getTitle(props)).toBe("ls -la");
  });

  test("getTitle truncates long commands", () => {
    const longCommand = "very long command ".repeat(10);
    const props: ToolRenderProps = {
      input: { command: longCommand },
    };
    const title = bashToolRenderer.getTitle(props);
    expect(title.length).toBeLessThanOrEqual(50);
    expect(title.endsWith("...")).toBe(true);
  });

  test("render shows command and output", () => {
    const props: ToolRenderProps = {
      input: { command: "echo hello" },
      output: "hello",
    };

    const result = bashToolRenderer.render(props);

    expect(result.content).toContain("$ echo hello");
    expect(result.content).toContain("hello");
    expect(result.language).toBe("bash");
  });

  test("render handles multiline output", () => {
    const props: ToolRenderProps = {
      input: { command: "ls" },
      output: "file1.txt\nfile2.txt\nfile3.txt",
    };

    const result = bashToolRenderer.render(props);

    expect(result.content).toContain("file1.txt");
    expect(result.content).toContain("file2.txt");
    expect(result.content).toContain("file3.txt");
  });
});

// ============================================================================
// WRITE TOOL RENDERER TESTS
// ============================================================================

describe("writeToolRenderer", () => {
  test("has correct icon", () => {
    expect(writeToolRenderer.icon).toBe("📝");
  });

  test("getTitle returns filename", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/path/to/new-file.js" },
    };
    expect(writeToolRenderer.getTitle(props)).toBe("new-file.js");
  });

  test("render shows success status when output present", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/file.txt", content: "hello" },
      output: true,
    };

    const result = writeToolRenderer.render(props);

    expect(result.content.some((line) => line.includes("✓"))).toBe(true);
  });

  test("render shows pending status when no output", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/file.txt", content: "hello" },
    };

    const result = writeToolRenderer.render(props);

    expect(result.content.some((line) => line.includes("⏳"))).toBe(true);
  });

  test("render shows content preview", () => {
    const props: ToolRenderProps = {
      input: { file_path: "/file.ts", content: "const x = 1;\nconst y = 2;" },
      output: true,
    };

    const result = writeToolRenderer.render(props);

    expect(result.content).toContain("const x = 1;");
    expect(result.content).toContain("const y = 2;");
  });

  test("render truncates long content", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const props: ToolRenderProps = {
      input: { file_path: "/file.txt", content: lines },
      output: true,
    };

    const result = writeToolRenderer.render(props);

    expect(result.content.some((line) => line.includes("more lines"))).toBe(true);
  });
});

// ============================================================================
// GLOB TOOL RENDERER TESTS
// ============================================================================

describe("globToolRenderer", () => {
  test("has correct icon", () => {
    expect(globToolRenderer.icon).toBe("🔍");
  });

  test("getTitle returns pattern", () => {
    const props: ToolRenderProps = {
      input: { pattern: "**/*.ts" },
    };
    expect(globToolRenderer.getTitle(props)).toBe("**/*.ts");
  });

  test("render shows file list", () => {
    const props: ToolRenderProps = {
      input: { pattern: "*.ts", path: "src" },
      output: ["file1.ts", "file2.ts"],
    };

    const result = globToolRenderer.render(props);

    expect(result.content).toContain("Pattern: *.ts");
    expect(result.content).toContain("Path: src");
    expect(result.content.some((line) => line.includes("file1.ts"))).toBe(true);
  });

  test("render truncates long file lists", () => {
    const files = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
    const props: ToolRenderProps = {
      input: { pattern: "*.ts" },
      output: files,
    };

    const result = globToolRenderer.render(props);

    expect(result.content.some((line) => line.includes("more files"))).toBe(true);
  });
});

// ============================================================================
// GREP TOOL RENDERER TESTS
// ============================================================================

describe("grepToolRenderer", () => {
  test("has correct icon", () => {
    expect(grepToolRenderer.icon).toBe("🔎");
  });

  test("getTitle returns pattern", () => {
    const props: ToolRenderProps = {
      input: { pattern: "function.*" },
    };
    expect(grepToolRenderer.getTitle(props)).toBe("function.*");
  });

  test("render shows search results", () => {
    const props: ToolRenderProps = {
      input: { pattern: "TODO", path: "src" },
      output: "src/file.ts:10: // TODO: fix this\nsrc/file.ts:20: // TODO: refactor",
    };

    const result = grepToolRenderer.render(props);

    expect(result.content).toContain("Pattern: TODO");
    expect(result.content).toContain("Path: src");
    expect(result.content.some((line) => line.includes("TODO"))).toBe(true);
  });

  test("render handles no matches", () => {
    const props: ToolRenderProps = {
      input: { pattern: "nonexistent" },
    };

    const result = grepToolRenderer.render(props);

    expect(result.content).toContain("(no matches)");
  });
});

// ============================================================================
// DEFAULT TOOL RENDERER TESTS
// ============================================================================

describe("defaultToolRenderer", () => {
  test("has correct icon", () => {
    expect(defaultToolRenderer.icon).toBe("🔧");
  });

  test("getTitle extracts first input value", () => {
    const props: ToolRenderProps = {
      input: { name: "test_value" },
    };
    expect(defaultToolRenderer.getTitle(props)).toBe("test_value");
  });

  test("getTitle returns default for empty input", () => {
    const props: ToolRenderProps = { input: {} };
    expect(defaultToolRenderer.getTitle(props)).toBe("Tool execution");
  });

  test("render shows JSON for input and output", () => {
    const props: ToolRenderProps = {
      input: { key: "value" },
      output: { result: "success" },
    };

    const result = defaultToolRenderer.render(props);

    expect(result.content.join("\n")).toContain("Input:");
    expect(result.content.join("\n")).toContain("Output:");
  });
});

// ============================================================================
// GET TOOL RENDERER TESTS
// ============================================================================

describe("getToolRenderer", () => {
  test("returns Read renderer", () => {
    expect(getToolRenderer("Read")).toBe(readToolRenderer);
    expect(getToolRenderer("read")).toBe(readToolRenderer);
  });

  test("returns Edit renderer", () => {
    expect(getToolRenderer("Edit")).toBe(editToolRenderer);
    expect(getToolRenderer("edit")).toBe(editToolRenderer);
  });

  test("returns Bash renderer", () => {
    expect(getToolRenderer("Bash")).toBe(bashToolRenderer);
    expect(getToolRenderer("bash")).toBe(bashToolRenderer);
  });

  test("returns Write renderer", () => {
    expect(getToolRenderer("Write")).toBe(writeToolRenderer);
    expect(getToolRenderer("write")).toBe(writeToolRenderer);
  });

  test("returns Glob renderer", () => {
    expect(getToolRenderer("Glob")).toBe(globToolRenderer);
    expect(getToolRenderer("glob")).toBe(globToolRenderer);
  });

  test("returns Grep renderer", () => {
    expect(getToolRenderer("Grep")).toBe(grepToolRenderer);
    expect(getToolRenderer("grep")).toBe(grepToolRenderer);
  });

  test("returns default renderer for unknown tools", () => {
    expect(getToolRenderer("UnknownTool")).toBe(defaultToolRenderer);
    expect(getToolRenderer("CustomTool")).toBe(defaultToolRenderer);
  });
});

// ============================================================================
// GET REGISTERED TOOL NAMES TESTS
// ============================================================================

describe("getRegisteredToolNames", () => {
  test("returns unique tool names", () => {
    const names = getRegisteredToolNames();

    expect(names).toContain("Read");
    expect(names).toContain("Edit");
    expect(names).toContain("Bash");
    expect(names).toContain("Write");
  });

  test("returns sorted names", () => {
    const names = getRegisteredToolNames();

    // Check array is sorted
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

// ============================================================================
// HAS CUSTOM RENDERER TESTS
// ============================================================================

describe("hasCustomRenderer", () => {
  test("returns true for registered tools", () => {
    expect(hasCustomRenderer("Read")).toBe(true);
    expect(hasCustomRenderer("Edit")).toBe(true);
    expect(hasCustomRenderer("Bash")).toBe(true);
    expect(hasCustomRenderer("Write")).toBe(true);
  });

  test("returns true for lowercase names", () => {
    expect(hasCustomRenderer("read")).toBe(true);
    expect(hasCustomRenderer("edit")).toBe(true);
  });

  test("returns false for unknown tools", () => {
    expect(hasCustomRenderer("UnknownTool")).toBe(false);
    expect(hasCustomRenderer("Custom")).toBe(false);
  });
});

// ============================================================================
// GET LANGUAGE FROM EXTENSION TESTS
// ============================================================================

describe("getLanguageFromExtension", () => {
  test("detects JavaScript/TypeScript", () => {
    expect(getLanguageFromExtension("js")).toBe("javascript");
    expect(getLanguageFromExtension("jsx")).toBe("javascript");
    expect(getLanguageFromExtension("ts")).toBe("typescript");
    expect(getLanguageFromExtension("tsx")).toBe("typescript");
  });

  test("detects Python", () => {
    expect(getLanguageFromExtension("py")).toBe("python");
    expect(getLanguageFromExtension("pyw")).toBe("python");
  });

  test("detects Rust", () => {
    expect(getLanguageFromExtension("rs")).toBe("rust");
  });

  test("detects Go", () => {
    expect(getLanguageFromExtension("go")).toBe("go");
  });

  test("detects config files", () => {
    expect(getLanguageFromExtension("json")).toBe("json");
    expect(getLanguageFromExtension("yaml")).toBe("yaml");
    expect(getLanguageFromExtension("yml")).toBe("yaml");
    expect(getLanguageFromExtension("toml")).toBe("toml");
  });

  test("detects shell scripts", () => {
    expect(getLanguageFromExtension("sh")).toBe("bash");
    expect(getLanguageFromExtension("bash")).toBe("bash");
    expect(getLanguageFromExtension("zsh")).toBe("bash");
  });

  test("detects web files", () => {
    expect(getLanguageFromExtension("html")).toBe("html");
    expect(getLanguageFromExtension("css")).toBe("css");
    expect(getLanguageFromExtension("scss")).toBe("scss");
  });

  test("returns undefined for unknown extensions", () => {
    expect(getLanguageFromExtension("xyz")).toBeUndefined();
    expect(getLanguageFromExtension("unknown")).toBeUndefined();
  });

  test("handles case insensitivity", () => {
    expect(getLanguageFromExtension("TS")).toBe("typescript");
    expect(getLanguageFromExtension("JS")).toBe("javascript");
  });
});
