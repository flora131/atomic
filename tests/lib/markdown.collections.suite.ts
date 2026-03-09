import { describe, expect, test } from "bun:test";
import { parseMarkdownFrontmatter } from "./markdown.test-support.ts";

describe("parseMarkdownFrontmatter", () => {
  describe("array values", () => {
    test("parses array values with dash prefix", () => {
      const content = `---
tags:
  - javascript
  - typescript
  - bun
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter.tags).toEqual([
        "javascript",
        "typescript",
        "bun",
      ]);
    });

    test("parses single-item array", () => {
      const content = `---
authors:
  - alice
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter.authors).toEqual(["alice"]);
    });

    test("handles array followed by another key", () => {
      const content = `---
tags:
  - one
  - two
title: Test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.tags).toEqual(["one", "two"]);
      expect(result?.frontmatter.title).toBe("Test");
    });

    test("stops array parsing at empty line", () => {
      const content = `---
tags:
  - one
  - two

title: Test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.tags).toEqual(["one", "two"]);
      expect(result?.frontmatter.title).toBe("Test");
    });

    test("stops array parsing at non-indented content", () => {
      const content = `---
items:
  - first
  - second
nextKey: value
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.items).toEqual(["first", "second"]);
      expect(result?.frontmatter.nextKey).toBe("value");
    });

    test("handles array at end of frontmatter", () => {
      const content = `---
title: Test
tags:
  - one
  - two
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.title).toBe("Test");
      expect(result?.frontmatter.tags).toEqual(["one", "two"]);
    });

    test("parses flow-sequence arrays with quoted items", () => {
      const content = `---
tools: ["execute", "read", "web"]
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter.tools).toEqual([
        "execute",
        "read",
        "web",
      ]);
    });

    test("preserves commas and numeric-like strings in quoted flow-sequence items", () => {
      const content = `---
values: ["one, two", "42", "true"]
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter.values).toEqual([
        "one, two",
        "42",
        "true",
      ]);
    });

    test("preserves multiline array items using YAML folding", () => {
      const content = `---
items:
  - first
    indented but not array
  - second
title: Test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.items).toEqual([
        "first indented but not array",
        "second",
      ]);
      expect(result?.frontmatter.title).toBe("Test");
    });
  });

  describe("object/nested values", () => {
    test("parses nested object with boolean values", () => {
      const content = `---
options:
  enabled: true
  visible: false
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter.options).toEqual({
        enabled: true,
        visible: false,
      });
    });

    test("parses object followed by another key", () => {
      const content = `---
settings:
  debug: true
  verbose: false
name: test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.settings).toEqual({
        debug: true,
        verbose: false,
      });
      expect(result?.frontmatter.name).toBe("test");
    });

    test("stops object parsing at empty line", () => {
      const content = `---
settings:
  debug: true

title: Test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.settings).toEqual({ debug: true });
      expect(result?.frontmatter.title).toBe("Test");
    });

    test("stops object parsing at non-indented content", () => {
      const content = `---
options:
  enabled: true
nextKey: value
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.options).toEqual({ enabled: true });
      expect(result?.frontmatter.nextKey).toBe("value");
    });

    test("handles object at end of frontmatter", () => {
      const content = `---
title: Test
settings:
  debug: true
  verbose: false
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.title).toBe("Test");
      expect(result?.frontmatter.settings).toEqual({
        debug: true,
        verbose: false,
      });
    });

    test("preserves multiline object scalars using YAML folding", () => {
      const content = `---
options:
  enabled: true
    indented but not boolean
  disabled: false
title: Test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.options).toEqual({
        enabled: "true indented but not boolean",
        disabled: false,
      });
      expect(result?.frontmatter.title).toBe("Test");
    });
  });

  describe("comment handling", () => {
    test("skips comment lines starting with #", () => {
      const content = `---
# This is a comment
title: Real Title
# Another comment
name: Test
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter).toEqual({
        title: "Real Title",
        name: "Test",
      });
    });

    test("skips comments with various formats", () => {
      const content = `---
# Single line comment
  # Indented comment (not standard but should still work after trim)
key: value
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter).toEqual({
        key: "value",
      });
    });
  });
});
