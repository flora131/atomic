/**
 * Unit tests for code block component
 *
 * Tests cover:
 * - normalizeLanguage function
 * - extractCodeBlocks function
 * - hasCodeBlocks function
 * - extractInlineCode function
 * - CodeBlockProps interface
 */

import { describe, test, expect } from "bun:test";
import {
  normalizeLanguage,
  extractCodeBlocks,
  hasCodeBlocks,
  extractInlineCode,
  type CodeBlockProps,
  type ParsedCodeBlock,
} from "../../src/ui/code-block.tsx";

// ============================================================================
// normalizeLanguage Tests
// ============================================================================

describe("normalizeLanguage", () => {
  test("normalizes JavaScript aliases", () => {
    expect(normalizeLanguage("js")).toBe("javascript");
    expect(normalizeLanguage("JS")).toBe("javascript");
    expect(normalizeLanguage("jsx")).toBe("javascript");
  });

  test("normalizes TypeScript aliases", () => {
    expect(normalizeLanguage("ts")).toBe("typescript");
    expect(normalizeLanguage("TS")).toBe("typescript");
    expect(normalizeLanguage("tsx")).toBe("typescript");
  });

  test("normalizes Python aliases", () => {
    expect(normalizeLanguage("py")).toBe("python");
    expect(normalizeLanguage("python3")).toBe("python");
    expect(normalizeLanguage("Python")).toBe("python");
  });

  test("normalizes shell aliases", () => {
    expect(normalizeLanguage("sh")).toBe("bash");
    expect(normalizeLanguage("shell")).toBe("bash");
    expect(normalizeLanguage("zsh")).toBe("bash");
  });

  test("normalizes web languages", () => {
    expect(normalizeLanguage("htm")).toBe("html");
    expect(normalizeLanguage("scss")).toBe("css");
    expect(normalizeLanguage("sass")).toBe("css");
    expect(normalizeLanguage("less")).toBe("css");
  });

  test("normalizes data formats", () => {
    expect(normalizeLanguage("yml")).toBe("yaml");
    expect(normalizeLanguage("YAML")).toBe("yaml");
  });

  test("normalizes other language aliases", () => {
    expect(normalizeLanguage("rs")).toBe("rust");
    expect(normalizeLanguage("rb")).toBe("ruby");
    expect(normalizeLanguage("kt")).toBe("kotlin");
    expect(normalizeLanguage("c++")).toBe("cpp");
    expect(normalizeLanguage("c#")).toBe("csharp");
    expect(normalizeLanguage("cs")).toBe("csharp");
  });

  test("returns lowercase for unknown languages", () => {
    expect(normalizeLanguage("UnknownLang")).toBe("unknownlang");
    expect(normalizeLanguage("COBOL")).toBe("cobol");
  });

  test("handles empty string", () => {
    expect(normalizeLanguage("")).toBe("");
  });

  test("trims whitespace", () => {
    expect(normalizeLanguage("  js  ")).toBe("javascript");
    expect(normalizeLanguage("\tpython\n")).toBe("python");
  });
});

// ============================================================================
// extractCodeBlocks Tests
// ============================================================================

describe("extractCodeBlocks", () => {
  test("extracts single code block", () => {
    const markdown = "```javascript\nconst x = 1;\n```";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks.length).toBe(1);
    expect(blocks[0]?.content).toBe("const x = 1;");
    expect(blocks[0]?.language).toBe("javascript");
  });

  test("extracts multiple code blocks", () => {
    const markdown = `
Some text
\`\`\`python
def hello():
    pass
\`\`\`
More text
\`\`\`typescript
const y = 2;
\`\`\`
`;
    const blocks = extractCodeBlocks(markdown);

    expect(blocks.length).toBe(2);
    expect(blocks[0]?.language).toBe("python");
    expect(blocks[0]?.content).toContain("def hello():");
    expect(blocks[1]?.language).toBe("typescript");
    expect(blocks[1]?.content).toBe("const y = 2;");
  });

  test("handles code block without language", () => {
    const markdown = "```\nplain text\n```";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks.length).toBe(1);
    expect(blocks[0]?.content).toBe("plain text");
    expect(blocks[0]?.language).toBe("");
  });

  test("normalizes language in extracted blocks", () => {
    const markdown = "```ts\nconst x = 1;\n```";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks[0]?.language).toBe("typescript");
  });

  test("handles multiline code", () => {
    const markdown = `\`\`\`javascript
function foo() {
  return bar();
}
\`\`\``;
    const blocks = extractCodeBlocks(markdown);

    expect(blocks.length).toBe(1);
    expect(blocks[0]?.content).toContain("function foo()");
    expect(blocks[0]?.content).toContain("return bar();");
  });

  test("provides correct indices", () => {
    const markdown = "prefix```js\ncode\n```suffix";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks[0]?.startIndex).toBe(6);
    // End index is start + length of full match
    expect(blocks[0]?.endIndex).toBe(20);
  });

  test("returns empty array for no code blocks", () => {
    const markdown = "Just some regular text without code blocks";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks).toEqual([]);
  });

  test("handles adjacent code blocks", () => {
    const markdown = "```js\na\n```\n```py\nb\n```";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks.length).toBe(2);
    expect(blocks[0]?.content).toBe("a");
    expect(blocks[1]?.content).toBe("b");
  });

  test("trims trailing whitespace from content", () => {
    const markdown = "```js\ncode   \n\n\n```";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks[0]?.content).toBe("code");
  });

  test("handles empty code block", () => {
    const markdown = "```js\n```";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks.length).toBe(1);
    expect(blocks[0]?.content).toBe("");
  });
});

// ============================================================================
// hasCodeBlocks Tests
// ============================================================================

describe("hasCodeBlocks", () => {
  test("returns true for text with code blocks", () => {
    expect(hasCodeBlocks("```js\ncode\n```")).toBe(true);
    expect(hasCodeBlocks("text ```python\ncode\n``` more")).toBe(true);
  });

  test("returns false for text without code blocks", () => {
    expect(hasCodeBlocks("no code here")).toBe(false);
    expect(hasCodeBlocks("just `inline` code")).toBe(false);
  });

  test("returns false for incomplete code blocks", () => {
    expect(hasCodeBlocks("```js\nno closing")).toBe(false);
    expect(hasCodeBlocks("no opening\n```")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(hasCodeBlocks("")).toBe(false);
  });
});

// ============================================================================
// extractInlineCode Tests
// ============================================================================

describe("extractInlineCode", () => {
  test("extracts single inline code", () => {
    const text = "Use the `console.log` function";
    const codes = extractInlineCode(text);

    expect(codes).toEqual(["console.log"]);
  });

  test("extracts multiple inline codes", () => {
    const text = "Use `foo` and `bar` together";
    const codes = extractInlineCode(text);

    expect(codes).toEqual(["foo", "bar"]);
  });

  test("returns empty array for no inline code", () => {
    const text = "No inline code here";
    const codes = extractInlineCode(text);

    expect(codes).toEqual([]);
  });

  test("handles empty string", () => {
    expect(extractInlineCode("")).toEqual([]);
  });

  test("extracts between backticks including nested", () => {
    // Regex matches content between any backticks
    const text = "Use `single` not ``double``";
    const codes = extractInlineCode(text);

    // The regex matches both `single` and `double`
    expect(codes.length).toBe(2);
    expect(codes[0]).toBe("single");
  });

  test("handles inline code with special characters", () => {
    const text = "The pattern is `[a-z]+` and `\\d+`";
    const codes = extractInlineCode(text);

    expect(codes).toEqual(["[a-z]+", "\\d+"]);
  });
});

// ============================================================================
// Type Tests
// ============================================================================

describe("CodeBlockProps interface", () => {
  test("allows minimal props", () => {
    const props: CodeBlockProps = {
      content: "const x = 1;",
    };

    expect(props.content).toBe("const x = 1;");
    expect(props.language).toBeUndefined();
    expect(props.streaming).toBeUndefined();
  });

  test("allows all optional props", () => {
    const props: CodeBlockProps = {
      content: "code here",
      language: "typescript",
      streaming: true,
      showLineNumbers: true,
      title: "Example",
    };

    expect(props.language).toBe("typescript");
    expect(props.streaming).toBe(true);
    expect(props.showLineNumbers).toBe(true);
    expect(props.title).toBe("Example");
  });
});

describe("ParsedCodeBlock interface", () => {
  test("has required fields", () => {
    const block: ParsedCodeBlock = {
      content: "const x = 1;",
      language: "javascript",
      startIndex: 0,
      endIndex: 20,
    };

    expect(block.content).toBe("const x = 1;");
    expect(block.language).toBe("javascript");
    expect(block.startIndex).toBe(0);
    expect(block.endIndex).toBe(20);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Code block parsing integration", () => {
  test("parses realistic markdown with mixed content", () => {
    const markdown = `
# Getting Started

First, install the dependencies:

\`\`\`bash
npm install
\`\`\`

Then run the dev server:

\`\`\`typescript
import { startServer } from './server';

startServer({ port: 3000 });
\`\`\`

You can also use inline code like \`npm start\` or \`yarn dev\`.
`;

    const blocks = extractCodeBlocks(markdown);
    expect(blocks.length).toBe(2);

    expect(blocks[0]?.language).toBe("bash");
    expect(blocks[0]?.content).toBe("npm install");

    expect(blocks[1]?.language).toBe("typescript");
    expect(blocks[1]?.content).toContain("import { startServer }");

    // Note: extractInlineCode uses simple regex and may not work well with
    // markdown that contains code blocks (backticks interfere)
    // For proper inline code extraction, you'd need to first remove code blocks
    expect(hasCodeBlocks(markdown)).toBe(true);
  });

  test("handles code block with JSON", () => {
    const markdown = `\`\`\`json
{
  "name": "test",
  "version": "1.0.0"
}
\`\`\``;

    const blocks = extractCodeBlocks(markdown);
    expect(blocks[0]?.language).toBe("json");
    expect(blocks[0]?.content).toContain('"name": "test"');
  });

  test("handles code block with special characters", () => {
    const markdown = `\`\`\`regex
^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$
\`\`\``;

    const blocks = extractCodeBlocks(markdown);
    expect(blocks[0]?.content).toContain("@[a-zA-Z0-9.-]");
  });
});
