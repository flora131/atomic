import { describe, expect, test } from "bun:test";
import {
  isPathSafe,
  normalizePath,
  shouldExclude,
} from "./copy.test-support.ts";

describe("normalizePath", () => {
  test("should convert backslashes to forward slashes", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
  });

  test("should handle mixed slashes", () => {
    expect(normalizePath("a/b\\c/d")).toBe("a/b/c/d");
  });

  test("should handle paths with no backslashes", () => {
    expect(normalizePath("a/b/c")).toBe("a/b/c");
  });

  test("should handle paths with only backslashes", () => {
    expect(normalizePath("\\\\a\\\\b\\\\c")).toBe("//a//b//c");
  });

  test("should handle empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  test("should handle root path", () => {
    expect(normalizePath("/")).toBe("/");
  });

  test("should handle Windows drive letter paths", () => {
    expect(normalizePath("C:\\Users\\test")).toBe("C:/Users/test");
  });

  test("should handle UNC paths", () => {
    expect(normalizePath("\\\\server\\share\\path")).toBe("//server/share/path");
  });
});

describe("isPathSafe", () => {
  test("should return true for safe relative paths", () => {
    expect(isPathSafe("/base", "subdir")).toBe(true);
  });

  test("should return true for nested safe paths", () => {
    expect(isPathSafe("/base", "subdir/nested/file.txt")).toBe(true);
  });

  test("should return false for path traversal with ..", () => {
    expect(isPathSafe("/base", "../escape")).toBe(false);
  });

  test("should return false for nested path traversal", () => {
    expect(isPathSafe("/base", "subdir/../../escape")).toBe(false);
  });

  test("should return true for current directory", () => {
    expect(isPathSafe("/base", ".")).toBe(true);
  });

  test("should return true for simple filename", () => {
    expect(isPathSafe("/base", "file.txt")).toBe(true);
  });

  test("should return false for path starting with ..", () => {
    expect(isPathSafe("/base", "..")).toBe(false);
  });

  test("should return false for hidden traversal attempts", () => {
    expect(isPathSafe("/base", "foo/../../../etc/passwd")).toBe(false);
  });
});

describe("shouldExclude", () => {
  test("should return true when name exactly matches an exclusion", () => {
    expect(shouldExclude("node_modules", "node_modules", ["node_modules"])).toBe(true);
  });

  test("should return false when name does not match any exclusion", () => {
    expect(shouldExclude("src/index.ts", "index.ts", ["node_modules", ".git"])).toBe(false);
  });

  test("should return true when relative path exactly matches an exclusion", () => {
    expect(shouldExclude("src/config", "config", ["src/config"])).toBe(true);
  });

  test("should return true when relative path starts with an exclusion prefix", () => {
    expect(shouldExclude("src/services/config/settings.ts", "settings.ts", ["src/services/config"])).toBe(true);
  });

  test("should return false when relative path partially overlaps but is not a child", () => {
    expect(shouldExclude("src/configs", "configs", ["src/config"])).toBe(false);
  });

  test("should handle empty exclusion list", () => {
    expect(shouldExclude("any/path", "path", [])).toBe(false);
  });

  test("should handle Windows-style backslashes in relative path", () => {
    expect(shouldExclude("src\\config\\file.ts", "file.ts", ["src/config"])).toBe(true);
  });

  test("should handle Windows-style backslashes in exclusion patterns", () => {
    expect(shouldExclude("src/services/config/file.ts", "file.ts", ["src\\services\\config"])).toBe(true);
  });

  test("should match name even when relative path differs", () => {
    expect(shouldExclude("deeply/nested/.git", ".git", [".git"])).toBe(true);
  });

  test("should support multiple exclusion patterns", () => {
    expect(shouldExclude("dist/bundle.js", "bundle.js", ["node_modules", "dist", ".git"])).toBe(true);
  });

  test("should not match when name is a substring of exclusion", () => {
    expect(shouldExclude("git-stuff", "git-stuff", [".git"])).toBe(false);
  });

  test("should return false for empty relative path and name with no matching exclusion", () => {
    expect(shouldExclude("", "", ["node_modules"])).toBe(false);
  });
});
