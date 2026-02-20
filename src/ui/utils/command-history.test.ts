import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import {
  loadCommandHistory,
  appendCommandHistory,
  clearCommandHistory,
  getCommandHistoryPath,
} from "./command-history.ts";

// Use a temp directory for isolation via the ATOMIC_SETTINGS_HOME env var
const TEST_HOME = join(tmpdir(), `atomic-cmd-history-test-${process.pid}`);
const HISTORY_FILE = join(TEST_HOME, ".atomic", ".command_history");
const HISTORY_DIR = dirname(HISTORY_FILE);

beforeEach(() => {
  process.env.ATOMIC_SETTINGS_HOME = TEST_HOME;
  mkdirSync(HISTORY_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.ATOMIC_SETTINGS_HOME;
  try {
    rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("command-history", () => {
  describe("getCommandHistoryPath", () => {
    test("returns path under ATOMIC_SETTINGS_HOME when set", () => {
      const path = getCommandHistoryPath();
      expect(path).toBe(HISTORY_FILE);
    });
  });

  describe("loadCommandHistory", () => {
    test("returns [] when file doesn't exist", () => {
      // Remove the dir so the file definitely doesn't exist
      rmSync(TEST_HOME, { recursive: true, force: true });
      const result = loadCommandHistory();
      expect(result).toEqual([]);
    });

    test("correctly parses single-line entries", () => {
      writeFileSync(HISTORY_FILE, "hello\nworld\n", "utf-8");
      const result = loadCommandHistory();
      expect(result).toEqual(["hello", "world"]);
    });

    test("handles empty lines gracefully (skips them)", () => {
      writeFileSync(HISTORY_FILE, "hello\n\nworld\n\n", "utf-8");
      const result = loadCommandHistory();
      expect(result).toEqual(["hello", "world"]);
    });

    test("joins backslash continuation lines into multi-line entries", () => {
      // "fix the bug\\\nand add error handling\n" on disk
      // means: "fix the bug" + continuation + "and add error handling"
      writeFileSync(HISTORY_FILE, "fix the bug\\\nand add error handling\n", "utf-8");
      const result = loadCommandHistory();
      expect(result).toEqual(["fix the bug\nand add error handling"]);
    });

    test("returns [] for empty file", () => {
      writeFileSync(HISTORY_FILE, "", "utf-8");
      const result = loadCommandHistory();
      expect(result).toEqual([]);
    });

    test("returns [] for whitespace-only file", () => {
      writeFileSync(HISTORY_FILE, "   \n  \n", "utf-8");
      // The parser treats lines with only spaces as non-empty entries,
      // but the outer trim check filters the entire file if it's only whitespace
      const result = loadCommandHistory();
      expect(result).toEqual([]);
    });
  });

  describe("appendCommandHistory", () => {
    test("creates directory and file if missing", () => {
      rmSync(TEST_HOME, { recursive: true, force: true });
      appendCommandHistory("first command");
      expect(existsSync(HISTORY_FILE)).toBe(true);
      const content = readFileSync(HISTORY_FILE, "utf-8");
      expect(content).toBe("first command\n");
    });

    test("appends text line to existing file", () => {
      writeFileSync(HISTORY_FILE, "existing\n", "utf-8");
      appendCommandHistory("new command");
      const content = readFileSync(HISTORY_FILE, "utf-8");
      expect(content).toBe("existing\nnew command\n");
    });

    test("skips empty strings", () => {
      appendCommandHistory("");
      appendCommandHistory("   ");
      // Neither empty nor whitespace-only strings should produce a file
      const fileExists = existsSync(HISTORY_FILE);
      const content = fileExists ? readFileSync(HISTORY_FILE, "utf-8") : "";
      expect(content).toBe("");
    });

    test("persists slash commands (e.g., /help, /clear)", () => {
      appendCommandHistory("/help");
      appendCommandHistory("/clear");
      const result = loadCommandHistory();
      expect(result).toEqual(["/help", "/clear"]);
    });

    test("writes multi-line strings with backslash continuation", () => {
      appendCommandHistory("line one\nline two\nline three");
      const content = readFileSync(HISTORY_FILE, "utf-8");
      // Internal newlines are replaced with backslash + newline
      expect(content).toBe("line one\\\nline two\\\nline three\n");
    });
  });

  describe("round-trip", () => {
    test("prompts with trailing backslashes are escaped and restored correctly", () => {
      const prompt = "path\\to\\file\\";
      appendCommandHistory(prompt);
      const result = loadCommandHistory();
      expect(result).toEqual([prompt]);
    });

    test("multi-line prompts round-trip correctly", () => {
      const prompt = "fix the bug\nand add proper error handling";
      appendCommandHistory(prompt);
      const result = loadCommandHistory();
      expect(result).toEqual([prompt]);
    });

    test("mixed single-line and multi-line prompts round-trip correctly", () => {
      appendCommandHistory("simple command");
      appendCommandHistory("multi\nline\ncommand");
      appendCommandHistory("another simple one");
      const result = loadCommandHistory();
      expect(result).toEqual([
        "simple command",
        "multi\nline\ncommand",
        "another simple one",
      ]);
    });
  });

  describe("clearCommandHistory", () => {
    test("empties the file", () => {
      appendCommandHistory("command one");
      appendCommandHistory("command two");
      clearCommandHistory();
      const result = loadCommandHistory();
      expect(result).toEqual([]);
    });
  });

  describe("truncation", () => {
    test("when file exceeds max entries, loadCommandHistory returns only the last N and rewrites file", () => {
      // Write 1005 entries directly to the file
      const entries: string[] = [];
      for (let i = 1; i <= 1005; i++) {
        entries.push(`command ${i}`);
      }
      const content = entries.map((e) => e + "\n").join("");
      writeFileSync(HISTORY_FILE, content, "utf-8");

      const result = loadCommandHistory();

      // Should return only the last 1000
      expect(result).toHaveLength(1000);
      expect(result[0]).toBe("command 6");
      expect(result[999]).toBe("command 1005");

      // File should be rewritten with only 1000 entries
      const rewritten = readFileSync(HISTORY_FILE, "utf-8");
      const rewrittenLines = rewritten.split("\n").filter(Boolean);
      expect(rewrittenLines).toHaveLength(1000);
    });
  });
});
