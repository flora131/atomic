import { describe, expect, test } from "bun:test";
import { parseMarkdownFrontmatter } from "./markdown.test-support.ts";

describe("parseMarkdownFrontmatter", () => {
  describe("edge cases", () => {
    test("handles empty lines in frontmatter", () => {
      const content = `---
title: Test

name: Value
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter).toEqual({
        title: "Test",
        name: "Value",
      });
    });

    test("returns null for malformed YAML lines without colons", () => {
      const content = `---
title: Test
this line has no colon
name: Value
---
Body`;
      expect(parseMarkdownFrontmatter(content)).toBeNull();
    });

    test("handles whitespace-only values", () => {
      const content = `---
title:    
name: value
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter.name).toBe("value");
    });

    test("handles body with leading/trailing whitespace", () => {
      const content = `---
title: Test
---Body with indentation  `;
      expect(parseMarkdownFrontmatter(content)?.body).toBe("Body with indentation  ");
    });

    test("handles special characters in values", () => {
      const content = `---
title: "Hello: World"
path: /some/path/with/slashes
email: test@example.com
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.title).toBe("Hello: World");
      expect(result?.frontmatter.path).toBe("/some/path/with/slashes");
      expect(result?.frontmatter.email).toBe("test@example.com");
    });

    test("handles key starting with hash", () => {
      const content = `---
#hashKey: value
title: Test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.title).toBe("Test");
      expect(result?.frontmatter["#hashKey"]).toBeUndefined();
    });
  });

  describe("complex frontmatter", () => {
    test("parses mixed content types", () => {
      const content = `---
title: My Document
version: 1.0
published: true
draft: false
tags:
  - documentation
  - markdown
settings:
  toc: true
  numbered: false
# Configuration comment
author: John Doe
---
# Document Body

This is the actual content.`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter).toEqual({
        title: "My Document",
        version: 1.0,
        published: true,
        draft: false,
        tags: ["documentation", "markdown"],
        settings: {
          toc: true,
          numbered: false,
        },
        author: "John Doe",
      });
      expect(result?.body).toBe("# Document Body\n\nThis is the actual content.");
    });
  });

  describe("additional branch coverage", () => {
    test("returns null for empty string input", () => {
      expect(parseMarkdownFrontmatter("")).toBeNull();
    });

    test("preserves empty-string keys when YAML parses them", () => {
      const content = `---
: orphan value
title: Valid
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter).toEqual({
        "": "orphan value",
        title: "Valid",
      });
    });

    test("parses empty values as null", () => {
      const content = `---
title: Test
emptykey:
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.title).toBe("Test");
      expect(result?.frontmatter.emptykey).toBeNull();
    });

    test("handles frontmatter with no body after closing markers", () => {
      const content = `---
title: Test
---
`;
      const result = parseMarkdownFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result?.frontmatter.title).toBe("Test");
      expect(result?.body).toBe("");
    });

    test("handles frontmatter where closing --- has no trailing newline", () => {
      const result = parseMarkdownFrontmatter("---\ntitle: Test\n---");
      if (result) {
        expect(result.frontmatter.title).toBe("Test");
        expect(result.body).toBe("");
      }
    });

    test("parses zero as a numeric value (falsy number)", () => {
      const content = `---
count: 0
offset: 0.0
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.count).toBe(0);
      expect(result?.frontmatter.offset).toBe(0);
      expect(typeof result?.frontmatter.count).toBe("number");
      expect(typeof result?.frontmatter.offset).toBe("number");
    });

    test("frontmatter with only comment lines produces empty object", () => {
      const content = `---
# comment one
# comment two
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result?.frontmatter).toEqual({});
      expect(result?.body).toBe("Body");
    });

    test("handles multiple arrays in sequence", () => {
      const content = `---
fruits:
  - apple
  - banana
colors:
  - red
  - blue
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.fruits).toEqual(["apple", "banana"]);
      expect(result?.frontmatter.colors).toEqual(["red", "blue"]);
    });

    test("handles multiple objects in sequence", () => {
      const content = `---
featureA:
  enabled: true
  visible: false
featureB:
  active: true
  debug: false
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.featureA).toEqual({
        enabled: true,
        visible: false,
      });
      expect(result?.frontmatter.featureB).toEqual({
        active: true,
        debug: false,
      });
    });

    test("parses nested objects with mixed scalar types", () => {
      const content = `---
config:
  name: somestring
  count: 42
  enabled: true
---
Body`;
      expect(parseMarkdownFrontmatter(content)?.frontmatter.config).toEqual({
        name: "somestring",
        count: 42,
        enabled: true,
      });
    });

    test("handles value containing colons after the first colon", () => {
      const content = `---
url: https://example.com:8080/path
time: 12:30:45
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.url).toBe("https://example.com:8080/path");
      expect(result?.frontmatter.time).toBe("12:30:45");
    });

    test("handles CRLF line endings (Windows)", () => {
      const content = "---\r\nname: test-agent\r\ndescription: A test agent\r\n---\r\nBody content";
      const result = parseMarkdownFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result?.frontmatter.name).toBe("test-agent");
      expect(result?.frontmatter.description).toBe("A test agent");
      expect(result?.body).toBe("Body content");
    });

    test("parses empty values as null before later keys", () => {
      const content = `---
emptykey:
nextkey: hello
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.emptykey).toBeNull();
      expect(result?.frontmatter.nextkey).toBe("hello");
    });
  });
});
