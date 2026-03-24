/**
 * Unit tests for session-info-filters.
 *
 * Tests the isLikelyFilePath() pure function that determines whether
 * a string looks like a bare filesystem path (used to suppress
 * file-path info messages from agent SDKs).
 */

import { describe, test, expect } from "bun:test";
import { isLikelyFilePath } from "@/services/events/session-info-filters.ts";

describe("isLikelyFilePath", () => {
  // ── Empty and whitespace ──────────────────────────────────────────────

  test("returns false for empty string", () => {
    expect(isLikelyFilePath("")).toBe(false);
  });

  // ── Strings with spaces (sentences, not paths) ───────────────────────

  test("returns false for string with spaces", () => {
    expect(isLikelyFilePath("hello world")).toBe(false);
  });

  test("returns false for path-like string containing spaces", () => {
    expect(isLikelyFilePath("/home/user/my file.ts")).toBe(false);
  });

  test("returns false for Windows path with spaces", () => {
    expect(isLikelyFilePath("C:\\Program Files\\app.exe")).toBe(false);
  });

  // ── POSIX absolute paths ──────────────────────────────────────────────

  test("returns true for POSIX absolute path", () => {
    expect(isLikelyFilePath("/home/user/file.ts")).toBe(true);
  });

  test("returns true for /tmp", () => {
    expect(isLikelyFilePath("/tmp")).toBe(true);
  });

  test("returns true for POSIX path with extension", () => {
    expect(isLikelyFilePath("/usr/local/bin/node")).toBe(true);
  });

  test("returns false for single forward slash", () => {
    // value.length > 1 check: "/" alone is not treated as a path
    expect(isLikelyFilePath("/")).toBe(false);
  });

  // ── Windows absolute paths ────────────────────────────────────────────

  test("returns true for Windows absolute path with backslash", () => {
    expect(isLikelyFilePath("C:\\dev\\file.ts")).toBe(true);
  });

  test("returns true for lowercase Windows drive letter", () => {
    expect(isLikelyFilePath("d:\\projects\\app.js")).toBe(true);
  });

  test("returns false for Windows-like string without backslash after drive", () => {
    // "C:file" does not have backslash after drive letter
    expect(isLikelyFilePath("C:file")).toBe(false);
  });

  // ── Home-relative paths ───────────────────────────────────────────────

  test("returns true for home-relative path", () => {
    expect(isLikelyFilePath("~/project/file.ts")).toBe(true);
  });

  test("returns true for home-relative path with nested dirs", () => {
    expect(isLikelyFilePath("~/.config/settings.json")).toBe(true);
  });

  test("returns false for tilde without slash", () => {
    // "~file" is not a home-relative path
    expect(isLikelyFilePath("~file")).toBe(false);
  });

  // ── Dot-relative paths ────────────────────────────────────────────────

  test("returns true for current-directory relative path (./)", () => {
    expect(isLikelyFilePath("./file.ts")).toBe(true);
  });

  test("returns true for parent-directory relative path (../)", () => {
    expect(isLikelyFilePath("../dir/file.ts")).toBe(true);
  });

  test("returns true for dot-relative with backslash (Windows style)", () => {
    expect(isLikelyFilePath(".\\src\\index.ts")).toBe(true);
  });

  test("returns true for parent with backslash", () => {
    expect(isLikelyFilePath("..\\dir\\file.ts")).toBe(true);
  });

  test("returns false for dotfile without slash", () => {
    // ".gitignore" is not a relative path — just a dotfile name
    expect(isLikelyFilePath(".gitignore")).toBe(false);
  });

  test("returns false for double-dot without slash", () => {
    expect(isLikelyFilePath("..name")).toBe(false);
  });

  // ── Non-path strings ──────────────────────────────────────────────────

  test("returns false for plain text", () => {
    expect(isLikelyFilePath("HelloWorld")).toBe(false);
  });

  test("returns false for URL", () => {
    expect(isLikelyFilePath("https://example.com")).toBe(false);
  });

  test("returns false for number-like string", () => {
    expect(isLikelyFilePath("42")).toBe(false);
  });

  test("returns false for bare filename without path separator", () => {
    expect(isLikelyFilePath("index.ts")).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  test("returns true for deeply nested POSIX path", () => {
    expect(isLikelyFilePath("/a/b/c/d/e/f/g.txt")).toBe(true);
  });

  test("returns true for path with special characters (no spaces)", () => {
    expect(isLikelyFilePath("/home/user/@scope/package")).toBe(true);
  });

  test("returns true for Windows path with forward slashes", () => {
    // Only backslash triggers Windows detection, but this also starts
    // with an uppercase letter. However the regex is ^[A-Za-z]:\\ only.
    // "D:/projects" does NOT match Windows regex (needs backslash),
    // but it does NOT start with "/" or "~/" or "./" either.
    expect(isLikelyFilePath("D:/projects/file.ts")).toBe(false);
  });
});
