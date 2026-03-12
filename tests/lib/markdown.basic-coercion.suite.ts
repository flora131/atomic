import { describe, expect, test } from "bun:test";
import { parseMarkdownFrontmatter } from "./markdown.test-support.ts";

describe("parseMarkdownFrontmatter", () => {
  describe("basic parsing", () => {
    test("returns null when no frontmatter markers", () => {
      expect(parseMarkdownFrontmatter("# Just a title\n\nSome content")).toBeNull();
    });

    test("returns null when missing closing marker", () => {
      expect(parseMarkdownFrontmatter("---\ntitle: Test\n")).toBeNull();
    });

    test("parses empty frontmatter (whitespace only)", () => {
      const result = parseMarkdownFrontmatter("---\n \n---\nBody content here");
      expect(result).not.toBeNull();
      expect(result?.frontmatter).toEqual({});
      expect(result?.body).toBe("Body content here");
    });

    test("parses simple string values", () => {
      const result = parseMarkdownFrontmatter("---\ntitle: My Title\nname: Test\n---\nBody");
      expect(result?.frontmatter).toEqual({
        title: "My Title",
        name: "Test",
      });
    });
  });

  describe("boolean coercion", () => {
    test("parses 'true' string as boolean true", () => {
      const result = parseMarkdownFrontmatter("---\nenabled: true\n---\nBody");
      expect(result?.frontmatter.enabled).toBe(true);
      expect(typeof result?.frontmatter.enabled).toBe("boolean");
    });

    test("parses 'false' string as boolean false", () => {
      const result = parseMarkdownFrontmatter("---\ndisabled: false\n---\nBody");
      expect(result?.frontmatter.disabled).toBe(false);
      expect(typeof result?.frontmatter.disabled).toBe("boolean");
    });

    test("parses YAML boolean aliases like 'True' and 'False'", () => {
      const result = parseMarkdownFrontmatter("---\nvalue1: True\nvalue2: False\n---\nBody");
      expect(result?.frontmatter.value1).toBe(true);
      expect(result?.frontmatter.value2).toBe(false);
    });
  });

  describe("numeric coercion", () => {
    test("parses integer strings as numbers", () => {
      const result = parseMarkdownFrontmatter("---\ncount: 42\nage: 25\n---\nBody");
      expect(result?.frontmatter.count).toBe(42);
      expect(result?.frontmatter.age).toBe(25);
      expect(typeof result?.frontmatter.count).toBe("number");
    });

    test("parses float strings as numbers", () => {
      const result = parseMarkdownFrontmatter("---\nprice: 19.99\nratio: 3.14159\n---\nBody");
      expect(result?.frontmatter.price).toBe(19.99);
      expect(result?.frontmatter.ratio).toBe(3.14159);
    });

    test("parses negative numbers", () => {
      const result = parseMarkdownFrontmatter("---\ntemp: -10\nbalance: -99.99\n---\nBody");
      expect(result?.frontmatter.temp).toBe(-10);
      expect(result?.frontmatter.balance).toBe(-99.99);
    });

    test("does not parse numeric-looking strings with non-numeric chars", () => {
      const result = parseMarkdownFrontmatter("---\nversion: 1.2.3\nid: abc123\n---\nBody");
      expect(result?.frontmatter.version).toBe("1.2.3");
      expect(result?.frontmatter.id).toBe("abc123");
    });
  });
});
