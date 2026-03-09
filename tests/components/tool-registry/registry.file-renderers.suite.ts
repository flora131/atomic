import { describe, expect, test } from "bun:test";
import {
  STATUS,
  applyPatchToolRenderer,
  editToolRenderer,
  readToolRenderer,
  type ToolRenderProps,
  writeToolRenderer,
} from "./registry.test-support.ts";

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
          "*** Update File: src/screens/chat-screen.tsx",
          "@@",
          "-old line",
          "+new line",
          "*** End Patch",
        ].join("\n"),
      },
    };

    const result = applyPatchToolRenderer.render(props);
    expect(result.title).toBe("chat-screen.tsx");
    expect(result.content).toContain("*** Update File: src/screens/chat-screen.tsx");
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
