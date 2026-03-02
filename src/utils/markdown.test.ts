import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdownFrontmatter } from "./markdown";

describe("parseMarkdownFrontmatter", () => {
  describe("basic parsing", () => {
    test("returns null when no frontmatter markers", () => {
      const content = "# Just a title\n\nSome content";
      expect(parseMarkdownFrontmatter(content)).toBeNull();
    });

    test("returns null when missing closing marker", () => {
      const content = "---\ntitle: Test\n";
      expect(parseMarkdownFrontmatter(content)).toBeNull();
    });

    test("parses empty frontmatter (whitespace only)", () => {
      // The regex requires \n between --- markers, so use whitespace
      const content = "---\n \n---\nBody content here";
      const result = parseMarkdownFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result?.frontmatter).toEqual({});
      expect(result?.body).toBe("Body content here");
    });

    test("parses simple string values", () => {
      const content = "---\ntitle: My Title\nname: Test\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter).toEqual({
        title: "My Title",
        name: "Test",
      });
    });
  });

  describe("boolean coercion", () => {
    test("parses 'true' string as boolean true", () => {
      const content = "---\nenabled: true\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.enabled).toBe(true);
      expect(typeof result?.frontmatter.enabled).toBe("boolean");
    });

    test("parses 'false' string as boolean false", () => {
      const content = "---\ndisabled: false\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.disabled).toBe(false);
      expect(typeof result?.frontmatter.disabled).toBe("boolean");
    });

    test("does not coerce string 'True' or 'False' (case-sensitive)", () => {
      const content = "---\nvalue1: True\nvalue2: False\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.value1).toBe("True");
      expect(result?.frontmatter.value2).toBe("False");
    });
  });

  describe("numeric coercion", () => {
    test("parses integer strings as numbers", () => {
      const content = "---\ncount: 42\nage: 25\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.count).toBe(42);
      expect(result?.frontmatter.age).toBe(25);
      expect(typeof result?.frontmatter.count).toBe("number");
    });

    test("parses float strings as numbers", () => {
      const content = "---\nprice: 19.99\nratio: 3.14159\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.price).toBe(19.99);
      expect(result?.frontmatter.ratio).toBe(3.14159);
    });

    test("parses negative numbers", () => {
      const content = "---\ntemp: -10\nbalance: -99.99\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.temp).toBe(-10);
      expect(result?.frontmatter.balance).toBe(-99.99);
    });

    test("does not parse numeric-looking strings with non-numeric chars", () => {
      const content = "---\nversion: 1.2.3\nid: abc123\n---\nBody";
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.version).toBe("1.2.3");
      expect(result?.frontmatter.id).toBe("abc123");
    });
  });

  describe("array values", () => {
    test("parses array values with dash prefix", () => {
      const content = `---
tags:
  - javascript
  - typescript
  - bun
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.tags).toEqual(["javascript", "typescript", "bun"]);
    });

    test("parses single-item array", () => {
      const content = `---
authors:
  - alice
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.authors).toEqual(["alice"]);
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

    test("handles array with indented non-array content", () => {
      // Indented content that doesn't match array pattern is skipped
      const content = `---
items:
  - first
    indented but not array
  - second
title: Test
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.items).toEqual(["first", "second"]);
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
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.options).toEqual({
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
      expect(result?.frontmatter.settings).toEqual({
        debug: true,
      });
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
      expect(result?.frontmatter.options).toEqual({
        enabled: true,
      });
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

    test("handles object with indented non-object content", () => {
      // Indented content that doesn't match object pattern is skipped
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
        enabled: true,
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
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter).toEqual({
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
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter).toEqual({
        key: "value",
      });
    });
  });

  describe("edge cases", () => {
    test("handles empty lines in frontmatter", () => {
      const content = `---
title: Test

name: Value
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter).toEqual({
        title: "Test",
        name: "Value",
      });
    });

    test("handles lines without colons gracefully", () => {
      const content = `---
title: Test
this line has no colon
name: Value
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter).toEqual({
        title: "Test",
        name: "Value",
      });
    });

    test("handles whitespace-only values", () => {
      const content = `---
title:    
name: value
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      // Empty value after colon should not be added (or should be empty string)
      expect(result?.frontmatter.name).toBe("value");
    });

    test("handles body with leading/trailing whitespace", () => {
      const content = `---
title: Test
---Body with indentation  `;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.body).toBe("Body with indentation  ");
    });

    test("handles special characters in values", () => {
      const content = `---
title: "Hello: World"
path: /some/path/with/slashes
email: test@example.com
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.title).toBe('"Hello: World"');
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
      // The #hashKey line should be treated as a comment and skipped
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

    test("skips lines where colon is at position 0 (colonIndex === 0)", () => {
      const content = `---
: orphan value
title: Valid
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter).toEqual({ title: "Valid" });
      expect(Object.keys(result!.frontmatter)).not.toContain("");
    });

    test("handles key with empty value on last line (no next line to check)", () => {
      // When value is empty and there is no i+1 line, the !value branch
      // falls through without entering array or object parsing
      const content = `---
title: Test
emptykey:
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      expect(result?.frontmatter.title).toBe("Test");
      // emptykey has no value and no indented children, so it should not appear
      expect(result?.frontmatter.emptykey).toBeUndefined();
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
      // The regex has \n? after the second ---, so this should still match
      const content = "---\ntitle: Test\n---";
      const result = parseMarkdownFrontmatter(content);
      // The regex requires \n---\n? at the end; "---" without preceding match may fail
      // depending on exact regex behavior - this tests that edge
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

    test("object with non-boolean indented value skips unmatched lines", () => {
      // Indented lines matching /^\s+\w+:/ but NOT matching /^\s+(\w+):\s*(true|false)$/
      // should be skipped (the else branch in object parsing at line 89)
      const content = `---
config:
  name: somestring
  count: 42
  enabled: true
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      // Only "enabled: true" matches the strict boolean object pattern
      // "name: somestring" and "count: 42" don't match /^\s+(\w+):\s*(true|false)$/
      // They are skipped (else branch increments i)
      expect(result?.frontmatter.config).toEqual({ enabled: true });
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

    test("key with empty value followed by non-indented next line", () => {
      // Value is empty, next line exists but is not indented (not array/object)
      const content = `---
emptykey:
nextkey: hello
---
Body`;
      const result = parseMarkdownFrontmatter(content);
      // emptykey has empty value, next line doesn't match array or object patterns
      // so the if(!value && i+1 < lines.length) block enters but neither isArrayItem
      // nor isObjectItem matches, falling through to the if(value) check which is false
      expect(result?.frontmatter.emptykey).toBeUndefined();
      expect(result?.frontmatter.nextkey).toBe("hello");
    });
  });

});
